/**
 * In-memory mock Supabase server for E2E testing.
 *
 * Implements a minimal subset of the Supabase REST API (PostgREST) and the
 * Supabase Realtime WebSocket protocol so the Next.js app can connect without
 * any real Supabase project.
 *
 * REST endpoints handled:
 *   GET    /rest/v1/:table?select=...&col=op.val&order=col.dir
 *   POST   /rest/v1/:table
 *   PATCH  /rest/v1/:table?col=op.val
 *   DELETE /rest/v1/:table?col=op.val
 *
 * WebSocket (Phoenix channel protocol v1.0.0):
 *   Accepts channel joins, heartbeats, postgres_changes subscriptions, and
 *   presence track/untrack.  Broadcasts state changes to subscribers.
 *
 * Management endpoints (for test fixtures):
 *   POST /test/seed   – reset store and load fixture data
 *   GET  /test/state  – dump current in-memory state
 */

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { WebSocketServer, WebSocket } from "ws";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DbRow {
  [key: string]: unknown;
}

export interface SeedData {
  rooms?: DbRow[];
  players?: DbRow[];
  scores?: DbRow[];
}

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

const tables: Record<string, Map<string, DbRow>> = {
  rooms: new Map(),
  players: new Map(),
  scores: new Map(),
};

const rowKey = (table: string, row: DbRow): string => {
  if (table === "scores") return `${row.room_id}-${row.team}`;
  return String(row.id);
};

export function seedStore(data: SeedData) {
  for (const t of ["rooms", "players", "scores"] as const) {
    tables[t].clear();
  }
  for (const [t, rows] of Object.entries(data) as [keyof SeedData, DbRow[]][]) {
    for (const row of rows ?? []) {
      tables[t as string].set(rowKey(t as string, row), { ...row });
    }
  }
}

export function getStore(): Record<string, DbRow[]> {
  const result: Record<string, DbRow[]> = {};
  for (const [t, map] of Object.entries(tables)) {
    result[t] = [...map.values()];
  }
  return result;
}

// ---------------------------------------------------------------------------
// Filter helpers (PostgREST syntax)
// ---------------------------------------------------------------------------

function parseQs(search: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(search)) {
    params[k] = v;
  }
  return params;
}

function matchesFilter(
  row: DbRow,
  col: string,
  op: string,
  val: string,
): boolean {
  const rv = row[col];
  switch (op) {
    case "eq":
      return String(rv) === val;
    case "neq":
      return String(rv) !== val;
    case "lt":
      return new Date(String(rv)) < new Date(val);
    case "gt":
      return new Date(String(rv)) > new Date(val);
    case "lte":
      return new Date(String(rv)) <= new Date(val);
    case "gte":
      return new Date(String(rv)) >= new Date(val);
    case "is":
      if (val === "null") return rv === null || rv === undefined;
      if (val === "not.null") return rv !== null && rv !== undefined;
      return false;
    default:
      return true;
  }
}

function applyFilters(rows: DbRow[], params: Record<string, string>): DbRow[] {
  const reservedKeys = new Set([
    "select",
    "order",
    "limit",
    "offset",
    "or",
    "count",
  ]);
  let filtered = rows;

  for (const [key, value] of Object.entries(params)) {
    if (reservedKeys.has(key)) continue;
    const m = value.match(/^(eq|neq|lt|gt|lte|gte|is)\.(.*)$/);
    if (m) {
      filtered = filtered.filter((r) => matchesFilter(r, key, m[1], m[2]));
    }
  }

  // Handle OR filter: or=(col1.op1.val1,col2.op2.val2)
  if (params.or) {
    const orClause = params.or.replace(/^\(|\)$/g, "");
    const parts = orClause.split(",");
    filtered = filtered.filter((r) =>
      parts.some((part) => {
        const pm = part.match(/^(\w+)\.(eq|neq|lt|gt|lte|gte|is)\.(.*)$/);
        if (!pm) return false;
        return matchesFilter(r, pm[1], pm[2], pm[3]);
      }),
    );
  }

  return filtered;
}

function applySelect(rows: DbRow[], select?: string): DbRow[] {
  if (!select || select === "*") return rows;
  const fields = select.split(",").map((f) => f.trim().split(":")[0]);
  return rows.map((r) => {
    const out: DbRow = {};
    for (const f of fields) if (f in r) out[f] = r[f];
    return out;
  });
}

function applyOrder(rows: DbRow[], order?: string): DbRow[] {
  if (!order) return rows;
  const parts = order.split(",");
  return [...rows].sort((a, b) => {
    for (const part of parts) {
      const [col, dir] = part.split(".");
      const av = a[col],
        bv = b[col];
      if (av == null || bv == null) continue;
      const avStr = String(av);
      const bvStr = String(bv);
      if (avStr < bvStr) return dir === "desc" ? 1 : -1;
      if (avStr > bvStr) return dir === "desc" ? -1 : 1;
    }
    return 0;
  });
}

// ---------------------------------------------------------------------------
// WebSocket realtime (Phoenix channel protocol)
// ---------------------------------------------------------------------------

interface PgChangeSpec {
  id: number;
  event: string;
  schema: string;
  table: string;
  filter?: string;
}

interface ChannelSub {
  isPresence: boolean;
  pgChanges: PgChangeSpec[];
  presenceKey?: string;
}

const wsClients = new Map<
  WebSocket,
  { channels: Map<string, ChannelSub> }
>();

// Presence state: channelTopic -> presenceKey -> metadata
const channelPresence = new Map<string, Map<string, DbRow>>();

let pgSubIdCounter = 1;

function sendWs(ws: WebSocket, msg: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcastChange(
  table: string,
  type: string,
  record: DbRow,
  oldRecord: DbRow = {},
) {
  for (const [ws, state] of wsClients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    for (const [topic, sub] of state.channels) {
      if (sub.isPresence) continue;
      const matchingIds: number[] = [];
      for (const pg of sub.pgChanges) {
        if (pg.table !== table) continue;
        if (
          pg.event !== "*" &&
          pg.event.toLowerCase() !== type.toLowerCase()
        )
          continue;
        // Check filter
        if (pg.filter) {
          const fm = pg.filter.match(
            /^(\w+)=(eq|neq|lt|gt|is)\.(.+)$/,
          );
          if (fm && !matchesFilter(record, fm[1], fm[2], fm[3])) continue;
        }
        matchingIds.push(pg.id);
      }
      if (matchingIds.length > 0) {
        sendWs(ws, {
          ref: null,
          join_ref: null,
          topic,
          event: "postgres_changes",
          payload: {
            data: {
              type,
              schema: "public",
              table,
              record,
              old_record: oldRecord,
              errors: null,
              commit_timestamp: new Date().toISOString(),
              columns: Object.keys(record).map((k) => ({
                name: k,
                type: "text",
              })),
            },
            ids: matchingIds,
          },
        });
      }
    }
  }
}

function handleWsMessage(ws: WebSocket, raw: string) {
  let msg: {
    ref?: string;
    join_ref?: string;
    topic?: string;
    event?: string;
    payload?: Record<string, unknown>;
  };
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }

  const { ref, join_ref, topic, event, payload = {} } = msg;

  // Heartbeat
  if (topic === "phoenix" && event === "heartbeat") {
    sendWs(ws, {
      ref,
      join_ref,
      topic: "phoenix",
      event: "phx_reply",
      payload: { status: "ok", response: {} },
    });
    return;
  }

  if (!topic) return;

  const clientState = wsClients.get(ws);
  if (!clientState) return;

  if (event === "phx_join") {
    const config = (payload.config ?? {}) as {
      presence?: { key?: string };
      postgres_changes?: Array<{
        event: string;
        schema: string;
        table: string;
        filter?: string;
      }>;
    };

    const isPresence =
      !!config.presence &&
      (!config.postgres_changes || config.postgres_changes.length === 0);

    const pgChanges: PgChangeSpec[] = [];
    for (const pg of config.postgres_changes ?? []) {
      pgChanges.push({
        id: pgSubIdCounter++,
        event: pg.event,
        schema: pg.schema,
        table: pg.table,
        filter: pg.filter,
      });
    }

    const sub: ChannelSub = {
      isPresence,
      pgChanges,
      presenceKey: config.presence?.key,
    };
    clientState.channels.set(topic, sub);

    // Reply with subscription IDs
    sendWs(ws, {
      ref,
      join_ref,
      topic,
      event: "phx_reply",
      payload: {
        status: "ok",
        response: {
          postgres_changes: pgChanges.map((p) => ({
            id: p.id,
            event: p.event,
            schema: p.schema,
            table: p.table,
            filter: p.filter ?? "",
          })),
        },
      },
    });

    if (isPresence) {
      // Send current presence state for this channel
      const presMap = channelPresence.get(topic) ?? new Map<string, DbRow>();
      channelPresence.set(topic, presMap);

      const stateObj: Record<string, DbRow[]> = {};
      for (const [key, meta] of presMap) {
        stateObj[key] = [{ phx_ref: `ref-${key}`, phx_ref_prev: null, ...meta }];
      }

      sendWs(ws, {
        ref: null,
        join_ref,
        topic,
        event: "presence_state",
        payload: stateObj,
      });
    }
    return;
  }

  if (event === "phx_leave") {
    const sub = clientState.channels.get(topic);
    if (sub?.isPresence && sub.presenceKey) {
      const presMap = channelPresence.get(topic);
      if (presMap) {
        presMap.delete(sub.presenceKey);
        broadcastPresenceDiff(topic, {}, { [sub.presenceKey]: {} });
      }
    }
    clientState.channels.delete(topic);
    sendWs(ws, {
      ref,
      join_ref,
      topic,
      event: "phx_reply",
      payload: { status: "ok", response: {} },
    });
    return;
  }

  // Presence track
  if (event === "presence" && payload.event === "track") {
    const sub = clientState.channels.get(topic);
    const key =
      sub?.presenceKey ??
      (payload.payload as Record<string, string> | undefined)?.id ??
      ref ??
      "anon";
    const meta = (payload.payload ?? {}) as DbRow;

    const presMap = channelPresence.get(topic) ?? new Map<string, DbRow>();
    channelPresence.set(topic, presMap);
    presMap.set(key, meta);

    broadcastPresenceDiff(topic, { [key]: meta }, {});
    return;
  }

  // Presence untrack
  if (event === "presence" && payload.event === "untrack") {
    const sub = clientState.channels.get(topic);
    const key = sub?.presenceKey ?? "anon";
    const presMap = channelPresence.get(topic);
    if (presMap) {
      presMap.delete(key);
      broadcastPresenceDiff(topic, {}, { [key]: {} });
    }
    return;
  }

  // Client-side broadcast: relay the message to all other subscribers on the
  // same channel topic so the host's browser can act as the WebSocket relay
  // for all players in the room.
  if (event === "broadcast") {
    for (const [otherWs, otherState] of wsClients) {
      if (otherWs === ws) continue; // self: false (default Supabase behaviour)
      if (otherWs.readyState !== WebSocket.OPEN) continue;
      if (otherState.channels.has(topic)) {
        sendWs(otherWs, { ref: null, join_ref: null, topic, event: "broadcast", payload });
      }
    }
    return;
  }
}

function broadcastPresenceDiff(
  topic: string,
  joins: Record<string, DbRow>,
  leaves: Record<string, DbRow>,
) {
  const joinsPayload: Record<string, unknown[]> = {};
  for (const [k, v] of Object.entries(joins)) {
    joinsPayload[k] = [{ phx_ref: `ref-${k}`, phx_ref_prev: null, ...v }];
  }
  const leavesPayload: Record<string, unknown[]> = {};
  for (const [k, v] of Object.entries(leaves)) {
    leavesPayload[k] = [{ phx_ref: `ref-${k}`, phx_ref_prev: null, ...v }];
  }

  const msg = {
    ref: null,
    join_ref: null,
    topic,
    event: "presence_diff",
    payload: { joins: joinsPayload, leaves: leavesPayload },
  };

  for (const [ws, state] of wsClients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    if (state.channels.has(topic)) {
      sendWs(ws, msg);
    }
  }
}

// ---------------------------------------------------------------------------
// HTTP REST handler
// ---------------------------------------------------------------------------

let idSeq = 1000;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

/**
 * Delivers a broadcast event (sent via HTTP Broadcast API) to all WebSocket
 * clients that are subscribed to the given channel topic.
 */
function deliverBroadcast(topic: string, event: string, payload: unknown) {
  for (const [ws, state] of wsClients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    if (state.channels.has(topic)) {
      sendWs(ws, {
        ref: null,
        join_ref: null,
        topic,
        event: "broadcast",
        payload: { type: "broadcast", event, payload },
      });
    }
  }
}

async function handleRest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const urlObj = new URL(req.url ?? "/", "http://localhost");
  const path = urlObj.pathname; // e.g. /rest/v1/rooms
  const params = parseQs(urlObj.search.slice(1));

  // Management endpoints for test setup
  if (path === "/test/seed" && req.method === "POST") {
    const body = await readBody(req);
    const data = JSON.parse(body) as SeedData;
    seedStore(data);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (path === "/test/state" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(getStore()));
    return;
  }

  // Supabase Realtime HTTP Broadcast API
  if (path === "/realtime/v1/api/broadcast" && req.method === "POST") {
    const body = await readBody(req);
    let data: { messages: Array<{ topic: string; event: string; payload: unknown }> };
    try {
      data = JSON.parse(body);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "Invalid JSON body" }));
      return;
    }
    for (const msg of data.messages ?? []) {
      deliverBroadcast(msg.topic, msg.event, msg.payload);
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // REST API
  const m = path.match(/^\/rest\/v1\/(\w+)$/);
  if (!m) {
    res.writeHead(404);
    res.end();
    return;
  }

  const tableName = m[1];
  const table = tables[tableName];
  if (!table) {
    res.writeHead(404);
    res.end(JSON.stringify({ message: `Table ${tableName} not found` }));
    return;
  }

  const acceptSingle = (req.headers["accept"] ?? "").includes(
    "application/vnd.pgrst.object+json",
  );
  const prefer = (req.headers["prefer"] ?? "") as string;
  const returnRepresentation = prefer.includes("return=representation");
  const countExact = prefer.includes("count=exact");

  if (req.method === "GET") {
    let rows = [...table.values()];
    rows = applyFilters(rows, params);
    rows = applyOrder(rows, params.order);
    rows = applySelect(rows, params.select);

    if (acceptSingle) {
      if (rows.length === 0) {
        // 406 = maybeSingle with no rows → supabase-js returns null
        res.writeHead(406, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            code: "PGRST116",
            details: "The result contains 0 rows",
            hint: null,
            message:
              "JSON object requested, multiple (or no) rows returned",
          }),
        );
        return;
      }
      res.writeHead(200, {
        "Content-Type": "application/vnd.pgrst.object+json",
      });
      res.end(JSON.stringify(rows[0]));
      return;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (countExact) {
      headers["Content-Range"] = `0-${Math.max(rows.length - 1, 0)}/${rows.length}`;
    }
    res.writeHead(200, headers);
    res.end(JSON.stringify(rows));
    return;
  }

  if (req.method === "POST") {
    const body = await readBody(req);
    const payload = JSON.parse(body) as DbRow | DbRow[];
    const items: DbRow[] = Array.isArray(payload) ? payload : [payload];
    const inserted: DbRow[] = [];

    for (const item of items) {
      const row: DbRow = {
        id: `gen-${Date.now()}-${idSeq++}`,
        ...item,
        last_seen_at: item.last_seen_at ?? new Date().toISOString(),
      };
      // Remove auto-added last_seen_at for tables that don't have it
      if (tableName === "rooms") delete row.last_seen_at;
      if (tableName === "scores") delete row.last_seen_at;

      const key = rowKey(tableName, row);
      table.set(key, row);
      inserted.push(row);
      broadcastChange(tableName, "INSERT", row);
    }

    const selected = applySelect(inserted, params.select);

    if (!returnRepresentation) {
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify(selected));
      return;
    }

    res.writeHead(201, { "Content-Type": "application/json" });
    if (acceptSingle) {
      res.end(JSON.stringify(selected[0] ?? {}));
    } else {
      res.end(JSON.stringify(selected));
    }
    return;
  }

  if (req.method === "PATCH") {
    const body = await readBody(req);
    const updates = JSON.parse(body) as DbRow;
    let rows = [...table.values()];
    rows = applyFilters(rows, params);

    const updated: DbRow[] = [];
    for (const existing of rows) {
      const oldRow = { ...existing };
      const newRow = { ...existing, ...updates };
      table.set(rowKey(tableName, newRow), newRow);
      updated.push(newRow);
      broadcastChange(tableName, "UPDATE", newRow, oldRow);
    }

    const selected = applySelect(updated, params.select);

    if (selected.length === 0) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify([]));
      return;
    }

    if (acceptSingle) {
      res.writeHead(200, {
        "Content-Type": "application/vnd.pgrst.object+json",
      });
      res.end(JSON.stringify(selected[0]));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(selected));
    return;
  }

  if (req.method === "DELETE") {
    let rows = [...table.values()];
    rows = applyFilters(rows, params);

    let count = 0;
    for (const row of rows) {
      table.delete(rowKey(tableName, row));
      broadcastChange(tableName, "DELETE", row);
      count++;
    }

    if (countExact) {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Range": `0-${Math.max(count - 1, 0)}/${count}`,
      });
      res.end(JSON.stringify([]));
      return;
    }

    res.writeHead(204);
    res.end();
    return;
  }

  res.writeHead(405);
  res.end();
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

let httpServer: ReturnType<typeof createServer> | null = null;

export function startMockSupabase(port = 54321): Promise<void> {
  return new Promise((resolve, reject) => {
    httpServer = createServer((req, res) => {
      // CORS headers
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PATCH, DELETE, OPTIONS",
      );
      res.setHeader(
        "Access-Control-Allow-Headers",
        "*",
      );

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      handleRest(req, res).catch((err) => {
        console.error("[mockSupabase] Error handling REST:", err);
        res.writeHead(500);
        res.end(JSON.stringify({ message: String(err) }));
      });
    });

    const wss = new WebSocketServer({ server: httpServer });

    wss.on("connection", (ws, req) => {
      const url = req.url ?? "";
      // Only handle realtime endpoint
      if (!url.startsWith("/realtime/v1/websocket")) {
        ws.close();
        return;
      }

      wsClients.set(ws, { channels: new Map() });

      ws.on("message", (data: Buffer) => {
        handleWsMessage(ws, data.toString());
      });

      ws.on("close", () => {
        // Clean up presence for closed connections
        const state = wsClients.get(ws);
        if (state) {
          for (const [topic, sub] of state.channels) {
            if (sub.isPresence && sub.presenceKey) {
              const presMap = channelPresence.get(topic);
              if (presMap) {
                presMap.delete(sub.presenceKey);
                broadcastPresenceDiff(topic, {}, { [sub.presenceKey]: {} });
              }
            }
          }
        }
        wsClients.delete(ws);
      });

      ws.on("error", () => {
        wsClients.delete(ws);
      });
    });

    httpServer.on("error", reject);
    httpServer.listen(port, () => {
      console.log(`[mockSupabase] Listening on http://localhost:${port}`);
      resolve();
    });
  });
}

export function stopMockSupabase(): Promise<void> {
  return new Promise((resolve) => {
    if (!httpServer) {
      resolve();
      return;
    }
    httpServer.close(() => {
      httpServer = null;
      tables.rooms.clear();
      tables.players.clear();
      tables.scores.clear();
      wsClients.clear();
      channelPresence.clear();
      resolve();
    });
  });
}
