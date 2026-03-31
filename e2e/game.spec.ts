/**
 * SyntaxRush – Full end-to-end game simulation
 *
 * Simulates a complete game session with four players (2 per team):
 *   Team A: Alice (host) + Bob
 *   Team B: Carol + Dave
 *
 * Test coverage:
 *   1. Lobby – all players visible, Start Game button available for host
 *   2. Start Round 1 – Team A becomes active, Alice is the describer
 *   3. Non-describer views – Bob (same team) and Carol/Dave (other team) see correct UI
 *   4. Scoring – describer awards a point, scoreboard updates
 *   5. Passing – describer skips cards, pass counter decrements
 *   6. Pass limit – after 3 passes the Skip button is disabled
 *   7. Round 2 – host starts a second round, Team B becomes active, Dave is the describer
 *   8. Game end – host ends the game, ended state is shown
 *
 * Each test step takes a screenshot so game dynamics are visually documented.
 * If core game rules change (pass limit, team rotation, describer order) these
 * tests will fail, signalling that the test suite must be updated.
 */

import { test, expect, ROOM_ID, GAME_RULES } from "./fixtures/index";
import { PLAYER_IDS } from "./fixtures/gameData";

const ROOM_URL = `/room/${ROOM_ID}`;

// ---------------------------------------------------------------------------
// Helper – wait for the page to show the room in the desired status
// ---------------------------------------------------------------------------
async function waitForRoomStatus(page: import("@playwright/test").Page, status: string) {
  if (status === "playing") {
    // The describer panel or the "Round in progress" label confirms playing status
    await expect(
      page.getByText(/round in progress|Describe the concept to your team|The describer is sharing/i).first()
    ).toBeVisible({ timeout: 10_000 });
  } else if (status === "ended") {
    await expect(page.getByTestId("game-ended")).toBeVisible({
      timeout: 10_000,
    });
  }
}

// ---------------------------------------------------------------------------
// 1. Lobby – all four players are visible before the game starts
// ---------------------------------------------------------------------------
test("1 – lobby: all four players are shown and Start Game is available to host", async ({
  hostPage,
  bobPage,
  carolPage,
  davePage,
  seedGame: _,
}) => {
  await hostPage.goto(ROOM_URL);
  await expect(hostPage).toHaveURL(ROOM_URL);

  // Host panel present
  await expect(hostPage.getByText(/ready when you are/i)).toBeVisible({
    timeout: 10_000,
  });

  // Scoreboard shows 0–0
  const scoreboardSection = hostPage.locator("section").filter({ hasText: /scoreboard/i });
  await expect(scoreboardSection).toBeVisible();

  // All four player names visible in Game Stats panel
  const gameStatsPanel = hostPage.locator("section").filter({ hasText: /game stats/i });
  await expect(gameStatsPanel.getByText("Alice")).toBeVisible();
  await expect(gameStatsPanel.getByText("Bob")).toBeVisible();
  await expect(gameStatsPanel.getByText("Carol")).toBeVisible();
  await expect(gameStatsPanel.getByText("Dave")).toBeVisible();

  // Start Game button is enabled (both teams have players)
  const startBtn = hostPage.getByRole("button", { name: /start game/i });
  await expect(startBtn).toBeEnabled({ timeout: 8_000 });

  await hostPage.screenshot({ path: "e2e/screenshots/01-lobby-host.png" });

  // Bob's view (Team A, non-host)
  await bobPage.goto(ROOM_URL);
  await expect(bobPage.locator("section").filter({ hasText: /game stats/i }).getByText("Alice")).toBeVisible({ timeout: 8_000 });
  await bobPage.screenshot({ path: "e2e/screenshots/01-lobby-bob.png" });

  // Carol's view (Team B)
  await carolPage.goto(ROOM_URL);
  await expect(carolPage.getByText("Carol")).toBeVisible({ timeout: 8_000 });
  await carolPage.screenshot({ path: "e2e/screenshots/01-lobby-carol.png" });

  // Dave's view (Team B)
  await davePage.goto(ROOM_URL);
  await expect(davePage.getByText("Dave")).toBeVisible({ timeout: 8_000 });
  await davePage.screenshot({ path: "e2e/screenshots/01-lobby-dave.png" });
});

// ---------------------------------------------------------------------------
// 2. Start Round 1 – host starts game, Team A becomes active
// ---------------------------------------------------------------------------
test(`2 – round 1 start: active team is ${GAME_RULES.ROUND_1_ACTIVE_TEAM} and Alice is the describer`, async ({
  hostPage,
  bobPage,
  carolPage,
  seedGame: _,
}) => {
  await hostPage.goto(ROOM_URL);
  await expect(hostPage.getByRole("button", { name: /start game/i })).toBeEnabled({
    timeout: 10_000,
  });

  // Click Start Game
  await hostPage.getByRole("button", { name: /start game/i }).click();

  // Alice is the describer – she should see her describer panel
  await expect(hostPage.getByText(/describe the concept to your team/i)).toBeVisible({
    timeout: 10_000,
  });

  // Verify Team A is active (scoreboard shows "Active" badge)
  await expect(hostPage.getByText(/Team A/i).first()).toBeVisible();

  await hostPage.screenshot({ path: "e2e/screenshots/02-round1-host-describer.png" });

  // Bob (same team, non-describer) should see the watcher message
  await bobPage.goto(ROOM_URL);
  await expect(
    bobPage.getByText(/The describer is sharing the concept/i)
  ).toBeVisible({ timeout: 10_000 });
  await bobPage.screenshot({ path: "e2e/screenshots/02-round1-bob-watcher.png" });

  // Carol (Team B) should see waiting/in-progress status
  await carolPage.goto(ROOM_URL);
  await expect(carolPage.getByText(/round in progress/i).first()).toBeVisible({
    timeout: 10_000,
  });
  await carolPage.screenshot({ path: "e2e/screenshots/02-round1-carol-opponent.png" });
});

// ---------------------------------------------------------------------------
// 3. Scoring – describer awards a point, Team A score increments
// ---------------------------------------------------------------------------
test("3 – scoring: describer clicks Correct, Team A score increases to 1", async ({
  hostPage,
  seedGame: _,
}) => {
  await hostPage.goto(ROOM_URL);

  // Start game
  await expect(hostPage.getByRole("button", { name: /start game/i })).toBeEnabled({
    timeout: 10_000,
  });
  await hostPage.getByRole("button", { name: /start game/i }).click();
  await expect(hostPage.getByText(/describe the concept to your team/i)).toBeVisible({
    timeout: 10_000,
  });

  // Score a point
  await hostPage.getByRole("button", { name: /correct/i }).click();

  // Team A score should now be 1
  await expect(hostPage.getByTestId("score-a")).toHaveText("1", {
    timeout: 8_000,
  });

  await hostPage.screenshot({ path: "e2e/screenshots/03-scoring-point.png" });
});

// ---------------------------------------------------------------------------
// 4. Passing – skip cards up to the limit
// ---------------------------------------------------------------------------
test(`4 – passing: can skip up to ${GAME_RULES.PASSES_PER_TEAM} cards, then button is disabled`, async ({
  hostPage,
  seedGame: _,
}) => {
  await hostPage.goto(ROOM_URL);

  // Start game
  await expect(hostPage.getByRole("button", { name: /start game/i })).toBeEnabled({
    timeout: 10_000,
  });
  await hostPage.getByRole("button", { name: /start game/i }).click();
  await expect(hostPage.getByText(/describe the concept to your team/i)).toBeVisible({
    timeout: 10_000,
  });

  const nextBtn = hostPage.getByRole("button", { name: /next card|no passes left/i });

  // Use all passes one by one
  for (let i = 0; i < GAME_RULES.PASSES_PER_TEAM; i++) {
    await expect(nextBtn).toBeEnabled({ timeout: 5_000 });
    await nextBtn.click();
    await hostPage.waitForTimeout(300); // wait for action to resolve
  }

  await hostPage.screenshot({ path: "e2e/screenshots/04-passes-exhausted.png" });

  // After 3 passes, the button should be disabled / show "No passes left"
  await expect(nextBtn).toBeDisabled({ timeout: 5_000 });
  await expect(hostPage.getByText(/no passes left/i)).toBeVisible({ timeout: 5_000 });
});

// ---------------------------------------------------------------------------
// 5. Pass limit enforcement – server rejects a 4th pass attempt
// ---------------------------------------------------------------------------
test("5 – pass limit: warning shown after all passes are exhausted", async ({
  hostPage,
  seedGame: _,
}) => {
  await hostPage.goto(ROOM_URL);

  await expect(hostPage.getByRole("button", { name: /start game/i })).toBeEnabled({
    timeout: 10_000,
  });
  await hostPage.getByRole("button", { name: /start game/i }).click();
  await expect(hostPage.getByText(/describe the concept to your team/i)).toBeVisible({
    timeout: 10_000,
  });

  // Exhaust all passes
  for (let i = 0; i < GAME_RULES.PASSES_PER_TEAM; i++) {
    await hostPage.getByRole("button", { name: /next card/i }).click();
    await hostPage.waitForTimeout(300);
  }

  // UI disables further passes (button disabled / label changes)
  const passButton = hostPage.getByRole("button", { name: /no passes left/i });
  await expect(passButton).toBeDisabled({ timeout: 5_000 });

  await hostPage.screenshot({ path: "e2e/screenshots/05-pass-limit.png" });
});

// ---------------------------------------------------------------------------
// 6. Round 2 – Team B becomes active, Dave is the describer
// ---------------------------------------------------------------------------
test(`6 – round 2: active team switches to ${GAME_RULES.ROUND_2_ACTIVE_TEAM} and Dave is the describer`, async ({
  hostPage,
  davePage,
  carolPage,
  seedGame: _,
}) => {
  await hostPage.goto(ROOM_URL);

  // Start round 1 (Team A)
  await expect(hostPage.getByRole("button", { name: /start game/i })).toBeEnabled({
    timeout: 10_000,
  });
  await hostPage.getByRole("button", { name: /start game/i }).click();
  await expect(hostPage.getByText(/describe the concept to your team/i)).toBeVisible({
    timeout: 10_000,
  });

  // End round 1 by ending game, then start again (which begins round 2)
  // The host uses "End game" when the round is active
  await hostPage.getByRole("button", { name: /end game/i }).click();

  // Wait for ended state on host page
  await waitForRoomStatus(hostPage, "ended");

  await hostPage.screenshot({
    path: "e2e/screenshots/06-round1-ended-before-round2.png",
  });

  // Re-seed so we can start a fresh round 2 scenario cleanly
  // (seed the room as if round 1 already ran once: round_index=1 → round 2 will be index 2 = Team B)
  const seedRes = await fetch("http://localhost:54321/test/seed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rooms: [
        {
          id: "TEST",
          status: "lobby",
          deck_seed: 42,
          timer_seconds: 60,
          current_card_index: 0,
          round_index: 1, // round 1 already played → next will be 2 = Team B
          passes_used: 0,
          passes_used_team_a: 0,
          passes_used_team_b: 0,
          active_team: "A",
          round_started_at: null,
        },
      ],
      players: [
        {
          id: PLAYER_IDS.alice,
          room_id: "TEST",
          name: "Alice",
          team: "A",
          is_host: true,
          last_seen_at: new Date().toISOString(),
        },
        {
          id: PLAYER_IDS.bob,
          room_id: "TEST",
          name: "Bob",
          team: "A",
          is_host: false,
          last_seen_at: new Date().toISOString(),
        },
        {
          id: PLAYER_IDS.carol,
          room_id: "TEST",
          name: "Carol",
          team: "B",
          is_host: false,
          last_seen_at: new Date().toISOString(),
        },
        {
          id: PLAYER_IDS.dave,
          room_id: "TEST",
          name: "Dave",
          team: "B",
          is_host: false,
          last_seen_at: new Date().toISOString(),
        },
      ],
      scores: [
        { room_id: "TEST", team: "A", points: 2 },
        { room_id: "TEST", team: "B", points: 0 },
      ],
    }),
  });
  expect(seedRes.ok).toBe(true);

  // Host navigates back to the room (now lobby for round 2)
  await hostPage.goto(ROOM_URL);
  await expect(hostPage.getByRole("button", { name: /start game/i })).toBeEnabled({
    timeout: 10_000,
  });

  // Start round 2 – should activate Team B
  await hostPage.getByRole("button", { name: /start game/i }).click();

  // Host is on Team A – they should see the non-describer panel now
  await expect(hostPage.getByText(/round in progress/i).first()).toBeVisible({
    timeout: 10_000,
  });

  await hostPage.screenshot({ path: "e2e/screenshots/06-round2-host-watcher.png" });

  // Dave (Team B, index 1 in sorted order) is the describer in round 2
  // describer index = (round_index - 1) % numTeamBPlayers = (2 - 1) % 2 = 1
  // Team B sorted by ID: carol < dave alphabetically? Let's check IDs:
  // carol: "player-carol-003", dave: "player-dave-004" → carol has lower ID
  // describer index = 1 → Dave (second player on Team B)
  await davePage.goto(ROOM_URL);
  await expect(davePage.getByText(/describe the concept to your team/i)).toBeVisible({
    timeout: 10_000,
  });
  await davePage.screenshot({ path: "e2e/screenshots/06-round2-dave-describer.png" });

  // Carol (Team B, non-describer) sees the watcher panel
  await carolPage.goto(ROOM_URL);
  await expect(
    carolPage.getByText(/The describer is sharing the concept/i)
  ).toBeVisible({ timeout: 10_000 });
  await carolPage.screenshot({ path: "e2e/screenshots/06-round2-carol-watcher.png" });
});

// ---------------------------------------------------------------------------
// 7. Team B scoring in round 2
// ---------------------------------------------------------------------------
test("7 – round 2 scoring: Team B describer scores a point", async ({
  hostPage,
  davePage,
  seedGame: _,
}) => {
  // Seed with round_index=1 so next start = round 2 (Team B active)
  const seedRes = await fetch("http://localhost:54321/test/seed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rooms: [
        {
          id: "TEST",
          status: "lobby",
          deck_seed: 42,
          timer_seconds: 60,
          current_card_index: 0,
          round_index: 1,
          passes_used: 0,
          passes_used_team_a: 0,
          passes_used_team_b: 0,
          active_team: "A",
          round_started_at: null,
        },
      ],
      players: [
        { id: PLAYER_IDS.alice, room_id: "TEST", name: "Alice", team: "A", is_host: true, last_seen_at: new Date().toISOString() },
        { id: PLAYER_IDS.bob, room_id: "TEST", name: "Bob", team: "A", is_host: false, last_seen_at: new Date().toISOString() },
        { id: PLAYER_IDS.carol, room_id: "TEST", name: "Carol", team: "B", is_host: false, last_seen_at: new Date().toISOString() },
        { id: PLAYER_IDS.dave, room_id: "TEST", name: "Dave", team: "B", is_host: false, last_seen_at: new Date().toISOString() },
      ],
      scores: [
        { room_id: "TEST", team: "A", points: 3 },
        { room_id: "TEST", team: "B", points: 0 },
      ],
    }),
  });
  expect(seedRes.ok).toBe(true);

  // Host starts round 2
  await hostPage.goto(ROOM_URL);
  await expect(hostPage.getByRole("button", { name: /start game/i })).toBeEnabled({
    timeout: 10_000,
  });
  await hostPage.getByRole("button", { name: /start game/i }).click();

  // Dave is the describer in round 2
  await davePage.goto(ROOM_URL);
  await expect(davePage.getByText(/describe the concept to your team/i)).toBeVisible({
    timeout: 10_000,
  });

  // Dave scores a point for Team B
  await davePage.getByRole("button", { name: /correct/i }).click();

  // Team B score should be 1
  await expect(davePage.getByTestId("score-b")).toHaveText("1", {
    timeout: 8_000,
  });

  await davePage.screenshot({ path: "e2e/screenshots/07-round2-teamb-score.png" });
});

// ---------------------------------------------------------------------------
// 8. End game – host ends the game, game-ended state shown
// ---------------------------------------------------------------------------
test("8 – game end: host ends the game and ended state is displayed", async ({
  hostPage,
  bobPage,
  seedGame: _,
}) => {
  await hostPage.goto(ROOM_URL);
  await expect(hostPage.getByRole("button", { name: /start game/i })).toBeEnabled({
    timeout: 10_000,
  });
  await hostPage.getByRole("button", { name: /start game/i }).click();
  await expect(hostPage.getByText(/describe the concept to your team/i)).toBeVisible({
    timeout: 10_000,
  });

  // End the game while round is active
  await hostPage.getByRole("button", { name: /end game/i }).click();

  await waitForRoomStatus(hostPage, "ended");
  await expect(hostPage.getByText(/tie game/i)).toBeVisible({ timeout: 8_000 });
  await expect(hostPage.getByText(/game statistics/i)).toBeVisible({
    timeout: 8_000,
  });

  await hostPage.screenshot({ path: "e2e/screenshots/08-game-ended-host.png" });

  // Bob's view should also show ended
  await bobPage.goto(ROOM_URL);
  await waitForRoomStatus(bobPage, "ended");
  await bobPage.screenshot({ path: "e2e/screenshots/08-game-ended-bob.png" });
});

// ---------------------------------------------------------------------------
// 9. Access control – non-host cannot start the game
// ---------------------------------------------------------------------------
test("9 – access control: non-host players do not see the Start Game button", async ({
  bobPage,
  carolPage,
  davePage,
  seedGame: _,
}) => {
  await bobPage.goto(ROOM_URL);
  // Bob is not the host – the HostPanel should not be visible
  await expect(bobPage.getByText(/ready when you are/i)).not.toBeVisible({
    timeout: 5_000,
  });
  await bobPage.screenshot({ path: "e2e/screenshots/09-access-bob-no-hostpanel.png" });

  await carolPage.goto(ROOM_URL);
  await expect(carolPage.getByText(/ready when you are/i)).not.toBeVisible({
    timeout: 5_000,
  });
  await carolPage.screenshot({ path: "e2e/screenshots/09-access-carol-no-hostpanel.png" });

  await davePage.goto(ROOM_URL);
  await expect(davePage.getByText(/ready when you are/i)).not.toBeVisible({
    timeout: 5_000,
  });
  await davePage.screenshot({ path: "e2e/screenshots/09-access-dave-no-hostpanel.png" });
});

// ---------------------------------------------------------------------------
// 10. Scoreboard presence – correct initial scores are displayed
// ---------------------------------------------------------------------------
test("10 – scoreboard: initial scores are 0-0 and pass counts are shown", async ({
  hostPage,
  seedGame: _,
}) => {
  await hostPage.goto(ROOM_URL);
  await expect(hostPage.getByText(/scoreboard/i)).toBeVisible({ timeout: 8_000 });

  // Both team scores show 0
  const teamAScore = hostPage.getByTestId("score-a");
  const teamBScore = hostPage.getByTestId("score-b");

  await expect(teamAScore).toHaveText("0", { timeout: 5_000 });
  await expect(teamBScore).toHaveText("0", { timeout: 5_000 });

  // Pass counts should show "3 of 3 passes left" for both teams
  await expect(
    hostPage.getByText(new RegExp(`${GAME_RULES.PASSES_PER_TEAM} of ${GAME_RULES.PASSES_PER_TEAM} passes left`)).first()
  ).toBeVisible({ timeout: 5_000 });

  await hostPage.screenshot({ path: "e2e/screenshots/10-scoreboard-initial.png" });
});
