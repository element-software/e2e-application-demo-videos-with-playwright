import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { expect } from "@playwright/test";
import type { Page, ViewportSize } from "@playwright/test";
import { PLAYER_IDS, ROOM_ID } from "../fixtures/gameData";

export const MOCK_URL = "http://localhost:54321";

/**
 * Demo mobile aspect: portrait **20:9** class (height : width = 20 : 9), i.e. **width : height = 9 : 20**.
 * Used for capture viewport and phone-frame inner screen so they stay matched.
 */
export const DEMO_MOBILE_ASPECT = { width: 9, height: 20 } as const;

/** CSS pixels; width/height exactly 9:20 (480×960). */
export const DEMO_MOBILE_VIEWPORT = {
  width: 480,
  height: Math.round((480 * DEMO_MOBILE_ASPECT.height) / DEMO_MOBILE_ASPECT.width),
} as const;

export type RoomSeed = {
  status: "lobby" | "playing" | "ended";
  round_index: number;
  current_card_index: number;
  active_team: "A" | "B" | null;
  passes_used_team_a: number;
  passes_used_team_b: number;
  round_started_at: string | null;
};

export type SeedInput = {
  room?: RoomSeed;
  scores?: { a: number; b: number };
};

export function buildPlayers() {
  const now = new Date().toISOString();
  return [
    {
      id: PLAYER_IDS.alice,
      room_id: ROOM_ID,
      name: "Alice",
      team: "A",
      is_host: true,
      last_seen_at: now,
    },
    {
      id: PLAYER_IDS.bob,
      room_id: ROOM_ID,
      name: "Bob",
      team: "A",
      is_host: false,
      last_seen_at: now,
    },
    {
      id: PLAYER_IDS.carol,
      room_id: ROOM_ID,
      name: "Carol",
      team: "B",
      is_host: false,
      last_seen_at: now,
    },
    {
      id: PLAYER_IDS.dave,
      room_id: ROOM_ID,
      name: "Dave",
      team: "B",
      is_host: false,
      last_seen_at: now,
    },
  ];
}

export function buildSeed(input: SeedInput) {
  return {
    rooms: [
      {
        id: ROOM_ID,
        status: input.room?.status ?? "lobby",
        deck_seed: 42,
        timer_seconds: 60,
        current_card_index: input.room?.current_card_index ?? 0,
        round_index: input.room?.round_index ?? 0,
        passes_used: 0,
        passes_used_team_a: input.room?.passes_used_team_a ?? 0,
        passes_used_team_b: input.room?.passes_used_team_b ?? 0,
        active_team: input.room?.active_team ?? null,
        round_started_at: input.room?.round_started_at ?? null,
      },
    ],
    players: buildPlayers(),
    scores: [
      { room_id: ROOM_ID, team: "A", points: input.scores?.a ?? 0 },
      { room_id: ROOM_ID, team: "B", points: input.scores?.b ?? 0 },
    ],
  };
}

export async function seedState(payload: unknown) {
  const response = await fetch(`${MOCK_URL}/test/seed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  expect(response.ok).toBe(true);
}

export async function injectSession(
  page: import("@playwright/test").Page,
  playerId: string,
) {
  await page.evaluate(
    ({ roomId, pid }) => {
      window.localStorage.setItem("sr_room_id", roomId);
      window.localStorage.setItem("sr_player_id", pid);
    },
    { roomId: ROOM_ID, pid: playerId },
  );
}

export function asDataUri(buffer: Buffer) {
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

/** PNG IHDR stores width/height as big-endian 32-bit ints at bytes 16..23. */
export function readPngDimensions(buffer: Buffer): { width: number; height: number } {
  if (buffer.length < 24) {
    throw new Error("Invalid PNG buffer (too short).");
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width <= 0 || height <= 0) {
    throw new Error("Invalid PNG dimensions.");
  }
  return { width, height };
}

export type PhoneFrameLayout = {
  frameWidth: number;
  frameHeight: number;
  frameRadius: number;
  screenRadius: number;
};

/**
 * Size the phone chrome for the demo **9:20 (portrait 20:9)** screen aspect.
 * `screenshotBuffer` is kept for call-site compatibility; layout does not read PNG dimensions.
 * Caps keep the outer frame within max width/height (including bezel padding and border).
 */
export function computePhoneFrameLayout(
  _screenshotBuffer: Buffer,
  maxFrameWidth: number,
  maxFrameHeight: number,
): PhoneFrameLayout {
  const screenAspect =
    DEMO_MOBILE_ASPECT.width / DEMO_MOBILE_ASPECT.height;
  const framePadding = 18;
  const frameBorder = 3;
  const frameInsets = 2 * (framePadding + frameBorder);
  const maxScreenWidth = maxFrameWidth - frameInsets;
  const maxScreenHeight = maxFrameHeight - frameInsets;

  let screenWidth = maxScreenWidth;
  let screenHeight = screenWidth / screenAspect;
  if (screenHeight > maxScreenHeight) {
    screenHeight = maxScreenHeight;
    screenWidth = screenHeight * screenAspect;
  }

  const frameWidth = screenWidth + frameInsets;
  const frameHeight = screenHeight + frameInsets;
  /** Flatter corners so the inner screenshot clip looks less aggressively rounded. */
  const frameRadius = Math.max(36, frameWidth * 0.065);
  const screenRadius = Math.max(26, frameRadius - 10);

  return { frameWidth, frameHeight, frameRadius, screenRadius };
}

/**
 * Injected on demo capture pages: visible cursor, click rings, and touch ripples.
 * Exposes `window.__srDemoPulse(clientX, clientY, isTouch?)` for highlight-only taps.
 */
export function getDemoInteractionOverlayScript(): string {
  return `
(() => {
  if (window.__srDemoOverlayInstalled) return;
  window.__srDemoOverlayInstalled = true;
  const w = window;
  const ring = (x, y, isTouch) => {
    const r = document.createElement("div");
    const size = isTouch ? 56 : 44;
    Object.assign(r.style, {
      position: "fixed",
      left: x + "px",
      top: y + "px",
      width: size + "px",
      height: size + "px",
      marginLeft: -size / 2 + "px",
      marginTop: -size / 2 + "px",
      borderRadius: "50%",
      border: isTouch ? "3px solid rgba(34,211,238,0.9)" : "2px solid rgba(96,165,250,0.95)",
      pointerEvents: "none",
      zIndex: "2147483646",
      animation: "sr-demo-ring 0.55s ease-out forwards",
    });
    document.body.appendChild(r);
    setTimeout(() => r.remove(), 600);
  };
  w.__srDemoPulse = (x, y, isTouch) => ring(x, y, !!isTouch);
  const cursor = document.createElement("div");
  Object.assign(cursor.style, {
    position: "fixed",
    left: "0px",
    top: "0px",
    width: "28px",
    height: "28px",
    marginLeft: "-14px",
    marginTop: "-14px",
    borderRadius: "50%",
    border: "2.5px solid rgba(255,255,255,0.95)",
    boxShadow: "0 0 0 1px rgba(0,0,0,0.35), 0 2px 12px rgba(0,0,0,0.45)",
    pointerEvents: "none",
    zIndex: "2147483647",
    opacity: "0",
    transition: "opacity 0.15s ease, transform 0.08s ease",
  });
  const style = document.createElement("style");
  style.textContent =
    "@keyframes sr-demo-ring { 0% { transform: scale(0.35); opacity: 1; } 100% { transform: scale(1.35); opacity: 0; } }";
  document.documentElement.appendChild(style);
  document.documentElement.appendChild(cursor);
  const showCursor = () => {
    cursor.style.opacity = "1";
  };
  document.addEventListener(
    "mousemove",
    (e) => {
      showCursor();
      cursor.style.left = e.clientX + "px";
      cursor.style.top = e.clientY + "px";
    },
    true,
  );
  document.addEventListener(
    "mousedown",
    (e) => {
      ring(e.clientX, e.clientY, false);
      cursor.style.transform = "scale(0.88)";
    },
    true,
  );
  document.addEventListener(
    "mouseup",
    () => {
      cursor.style.transform = "scale(1)";
    },
    true,
  );
  document.addEventListener(
    "touchstart",
    (e) => {
      if (!e.touches.length) return;
      const t = e.touches[0];
      showCursor();
      cursor.style.left = t.clientX + "px";
      cursor.style.top = t.clientY + "px";
      ring(t.clientX, t.clientY, true);
    },
    { passive: true, capture: true },
  );
})();
`;
}

export function recordVideoForViewport(videoDir: string, size: ViewportSize) {
  return {
    recordVideo: {
      dir: videoDir,
      size: { width: size.width, height: size.height },
    },
  };
}

/** Wait until `clipMs` have passed since `clipStart` (Date.now()). */
export async function padClipToMs(page: Page, clipStart: number, clipMs: number) {
  const elapsed = Date.now() - clipStart;
  const rest = clipMs - elapsed;
  if (rest > 0) {
    await page.waitForTimeout(rest);
  }
}

/**
 * Serves WebM clips from disk at `origin` + path (e.g. /desktop.webm).
 * Used so composite slide pages can load `<video src="http://127.0.0.1:port/...">`.
 */
export async function withLocalClipServer(
  pathToFile: Record<string, string>,
  fn: (origin: string) => Promise<void>,
): Promise<void> {
  const server = createServer((req, res) => {
    const pathname = (req.url ?? "/").split("?")[0] ?? "/";
    const file = pathToFile[pathname];
    if (!file) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": "video/webm",
      "Cache-Control": "no-store",
    });
    const stream = createReadStream(file);
    stream.on("error", () => {
      if (!res.writableEnded) {
        res.end();
      }
    });
    stream.pipe(res);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const addr = server.address();
  const port = addr && typeof addr === "object" ? addr.port : 0;
  const origin = `http://127.0.0.1:${port}`;

  try {
    await fn(origin);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

/** RGBA for `Emulation.setDefaultBackgroundColorOverride` (alpha 0–1). */
const DEMO_CAPTURE_PAGE_BG = { r: 2, g: 6, b: 23, a: 1 } as const;

/**
 * Chromium records white for the blank document until the first navigation/paint. Set a dark
 * compositor background before `goto` / `setContent` on every page used for demo video capture.
 */
export async function overrideChromiumCaptureBackground(page: Page) {
  try {
    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setDefaultBackgroundColorOverride", {
      color: DEMO_CAPTURE_PAGE_BG,
    });
  } catch {
    /* Chromium-only; ignore if CDP is unavailable. */
  }
}

/**
 * Composite slides use `<video>` for WebM embeds; Chromium often paints white until the first
 * frame decodes. Keep videos opacity:0 (and dark background) until canplay + first frame, then
 * add class `sr-demo-video-visible` (paired CSS in the slide HTML).
 */
export async function primeEmbeddedDemoVideos(page: Page) {
  await page.evaluate(async () => {
    const videos = [
      ...document.querySelectorAll("video.desk-v, video.mob-v, video.screen-video"),
    ] as HTMLVideoElement[];

    const waitCanPlay = (v: HTMLVideoElement) =>
      v.readyState >= 3
        ? Promise.resolve()
        : new Promise<void>((r) => v.addEventListener("canplay", () => r(), { once: true }));

    /** Do not use `playing` alone — it can fire before the first decoded pixel (still white). */
    const waitFirstPaintedFrame = (v: HTMLVideoElement) =>
      new Promise<void>((resolve) => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        const maxWait = window.setTimeout(done, 3000);
        const finish = () => {
          window.clearTimeout(maxWait);
          done();
        };
        v.addEventListener(
          "timeupdate",
          () => {
            if (v.currentTime > 0.02) finish();
          },
          { passive: true },
        );
        type V = HTMLVideoElement & {
          requestVideoFrameCallback?: (cb: () => void) => void;
        };
        const rvfc = (v as V).requestVideoFrameCallback;
        if (typeof rvfc === "function") {
          rvfc.call(v, () => finish());
        }
      });

    await Promise.all(
      videos.map(async (v) => {
        v.muted = true;
        await waitCanPlay(v);
        await v.play().catch(() => undefined);
        await waitFirstPaintedFrame(v);
        v.classList.add("sr-demo-video-visible");
      }),
    );
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

declare global {
  interface Window {
    __srDemoOverlayInstalled?: boolean;
    __srDemoPulse?: (x: number, y: number, isTouch?: boolean) => void;
  }
}
