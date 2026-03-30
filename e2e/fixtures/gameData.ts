/**
 * Static test fixture data.
 *
 * Describes the game state used across all E2E tests:
 *   - Room "TEST" in lobby state
 *   - Team A: Alice (host, describer in round 1) + Bob
 *   - Team B: Carol + Dave (describer in round 2)
 *
 * Player IDs are deterministic strings so the tests can hard-code
 * localStorage values without relying on the server to return them first.
 *
 * Game-dynamic constants duplicated here (e.g. PASSES_PER_TEAM) are
 * intentionally kept in sync with the application so that if the game rules
 * change the E2E tests will fail, alerting that they need to be updated.
 */

export const ROOM_ID = "TEST";
export const DECK_SEED = 42;
export const TIMER_SECONDS = 60;

// Player IDs – stable, predictable for localStorage injection
export const PLAYER_IDS = {
  alice: "player-alice-001",
  bob: "player-bob-002",
  carol: "player-carol-003",
  dave: "player-dave-004",
} as const;

/** Game rules mirrored from the application source.
 * If these change in the app the E2E tests should fail. */
export const GAME_RULES = {
  /** Maximum card passes allowed per team per round */
  PASSES_PER_TEAM: 3,
  /** Teams alternate each round: odd rounds → Team A, even rounds → Team B */
  ROUND_1_ACTIVE_TEAM: "A" as const,
  ROUND_2_ACTIVE_TEAM: "B" as const,
  /** Describer index: (roundIndex - 1) % teamPlayers.length */
  ROUND_1_DESCRIBER: "alice" as keyof typeof PLAYER_IDS,
  ROUND_2_DESCRIBER: "dave" as keyof typeof PLAYER_IDS,
} as const;

/** Initial seed data – matches the shape the mock Supabase server expects */
export const SEED_DATA = {
  rooms: [
    {
      id: ROOM_ID,
      status: "lobby",
      deck_seed: DECK_SEED,
      timer_seconds: TIMER_SECONDS,
      current_card_index: 0,
      round_index: 0,
      passes_used: 0,
      passes_used_team_a: 0,
      passes_used_team_b: 0,
      active_team: null,
      round_started_at: null,
    },
  ],
  players: [
    {
      id: PLAYER_IDS.alice,
      room_id: ROOM_ID,
      name: "Alice",
      team: "A",
      is_host: true,
      last_seen_at: new Date().toISOString(),
    },
    {
      id: PLAYER_IDS.bob,
      room_id: ROOM_ID,
      name: "Bob",
      team: "A",
      is_host: false,
      last_seen_at: new Date().toISOString(),
    },
    {
      id: PLAYER_IDS.carol,
      room_id: ROOM_ID,
      name: "Carol",
      team: "B",
      is_host: false,
      last_seen_at: new Date().toISOString(),
    },
    {
      id: PLAYER_IDS.dave,
      room_id: ROOM_ID,
      name: "Dave",
      team: "B",
      is_host: false,
      last_seen_at: new Date().toISOString(),
    },
  ],
  scores: [
    { room_id: ROOM_ID, team: "A", points: 0 },
    { room_id: ROOM_ID, team: "B", points: 0 },
  ],
};
