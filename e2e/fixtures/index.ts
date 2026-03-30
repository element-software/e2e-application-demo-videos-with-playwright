/**
 * Playwright test fixtures for the SyntaxRush game simulation.
 *
 * Provides:
 *   - `seedGame`      – seeds the mock Supabase server with fixture data
 *   - `hostPage`      – browser page logged in as Alice (host, Team A)
 *   - `bobPage`       – browser page logged in as Bob (Team A, non-describer)
 *   - `carolPage`     – browser page logged in as Carol (Team B)
 *   - `davePage`      – browser page logged in as Dave (Team B)
 *
 * Each "player page" stores the correct player ID in localStorage so the app
 * identifies the player without a real auth session.
 */

import { test as base, type Page, type BrowserContext } from "@playwright/test";
import { SEED_DATA, ROOM_ID, PLAYER_IDS } from "./gameData";

const MOCK_URL = "http://localhost:54321";

/** Reset the mock Supabase store to the canonical fixture state. */
async function seedMockServer() {
  const response = await fetch(`${MOCK_URL}/test/seed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(SEED_DATA),
  });
  if (!response.ok) {
    throw new Error(`Failed to seed mock server: ${response.status}`);
  }
}

/** Inject player session into a browser context's localStorage. */
async function injectPlayerSession(
  context: BrowserContext,
  playerId: string,
): Promise<void> {
  await context.addInitScript(
    ({ roomId, pid }) => {
      window.localStorage.setItem("sr_room_id", roomId);
      window.localStorage.setItem("sr_player_id", pid);
    },
    { roomId: ROOM_ID, pid: playerId },
  );
}

type GameFixtures = {
  seedGame: void;
  hostPage: Page;
  bobPage: Page;
  carolPage: Page;
  davePage: Page;
};

export const test = base.extend<GameFixtures>({
  // Seed the mock server before each test that uses it
  seedGame: [
    async ({}, use) => {
      await seedMockServer();
      await use();
    },
    { auto: false },
  ],

  hostPage: async ({ browser, seedGame: _ }, use) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    await injectPlayerSession(context, PLAYER_IDS.alice);
    const page = await context.newPage();
    await use(page);
    await context.close();
  },

  bobPage: async ({ browser, seedGame: _ }, use) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    await injectPlayerSession(context, PLAYER_IDS.bob);
    const page = await context.newPage();
    await use(page);
    await context.close();
  },

  carolPage: async ({ browser, seedGame: _ }, use) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    await injectPlayerSession(context, PLAYER_IDS.carol);
    const page = await context.newPage();
    await use(page);
    await context.close();
  },

  davePage: async ({ browser, seedGame: _ }, use) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    await injectPlayerSession(context, PLAYER_IDS.dave);
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});

export { expect } from "@playwright/test";
export { ROOM_ID, PLAYER_IDS, GAME_RULES } from "./gameData";
/** AppFlow demo video: profile JSON served via route in `tests/demo-tour.spec.ts` */
export { CAPTURE_DEMO_PROFILE, type DemoProfile } from "./appflowProfile";
