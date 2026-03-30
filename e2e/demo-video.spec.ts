import { test, expect, devices, type Browser, type Page } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { PLAYER_IDS, ROOM_ID } from "./fixtures/gameData";
import {
  type RoomSeed,
  buildSeed,
  seedState,
  injectSession,
  asDataUri,
  computePhoneFrameLayout,
  DEMO_MOBILE_VIEWPORT,
  getDemoInteractionOverlayScript,
  recordVideoForViewport,
  padClipToMs,
  withLocalClipServer,
  primeEmbeddedDemoVideos,
  overrideChromiumCaptureBackground,
} from "./support/demoVideo";

const DEMO_TMP_DIR = path.join(process.cwd(), "demo", ".tmp");
const STILLS_DIR = path.join(DEMO_TMP_DIR, "stills");
const SLIDES_DIR = path.join(DEMO_TMP_DIR, "slides");
const MANIFEST_PATH = path.join(SLIDES_DIR, "manifest.txt");
const SLIDE_DURATION_SECONDS = 7.5;
const CLIP_MS = Math.round(SLIDE_DURATION_SECONDS * 1000);

/** Must match desktop `captureRoomShot` viewport so the frame inner aspect = screenshot (no side bars). */
const DESKTOP_CAPTURE_VIEWPORT = { width: 1440, height: 900 } as const;
const DESKTOP_FRAME_BEZEL = 16;
const DESKTOP_FRAME_BORDER = 2;
/** Inner screen height; width derived from 1440:900 aspect. Smaller = more slide padding below. */
const DESKTOP_INNER_HEIGHT = 580;

/**
 * Outer phone bounds in the 1920×1080 composite. Inner 9:20; lower caps shorten the handset for bottom padding.
 */
const COMPOSITE_PHONE_MAX_W = 400;
const COMPOSITE_PHONE_MAX_H = 620;

const SYNTAX_RUSH_LOGO_PATH = path.join(
  process.cwd(),
  "public/images/new-logo.png",
);
const ELEMENT_SOFTWARE_LOGO_PATH = path.join(
  process.cwd(),
  "public/images/es-logo-white.png",
);

test.setTimeout(300_000);

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type StartSlideDefinition = {
  mode: "start";
  key: string;
  title: string;
  subtitle: string;
  features: string[];
};

type RoomSlideDefinition = {
  mode: "room";
  key: string;
  title: string;
  subtitle: string;
  features: string[];
  playerId: string;
  scores: { a: number; b: number };
  room: RoomSeed;
};

type StateDefinition = StartSlideDefinition | RoomSlideDefinition;

async function moveMouseTo(page: Page, locator: ReturnType<Page["locator"]>) {
  try {
    await locator.first().scrollIntoViewIfNeeded({ timeout: 5000 });
  } catch {
    return;
  }
  const box = await locator.first().boundingBox();
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 36 });
  await page.waitForTimeout(420);
}

async function pulseMouseHighlight(page: Page, locator: ReturnType<Page["locator"]>) {
  try {
    await locator.first().scrollIntoViewIfNeeded({ timeout: 5000 });
  } catch {
    return;
  }
  const box = await locator.first().boundingBox();
  if (!box) return;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps: 22 });
  await page.waitForTimeout(160);
  await page.evaluate(
    ({ cx, cy }) => {
      window.__srDemoPulse?.(cx, cy, false);
    },
    { cx: x, cy: y },
  );
  await page.waitForTimeout(340);
}

async function runDesktopStartInteractions(page: Page) {
  const hostNameInput = page.locator('input[name="hostName"]');
  await hostNameInput.scrollIntoViewIfNeeded({ timeout: 8000 });
  await hostNameInput.click();
  await page.waitForTimeout(120);
  await hostNameInput.pressSequentially("Priya", { delay: 95 });
  await page.waitForTimeout(300);
  await moveMouseTo(page, page.getByText(/pick your lane/i));
  await pulseMouseHighlight(page, page.getByRole("button", { name: /^create room$/i }));
  await pulseMouseHighlight(page, page.getByRole("button", { name: /join room/i }));
}

async function runMobileStartInteractions(page: Page) {
  const hostNameInput = page.locator('input[name="hostName"]');
  await hostNameInput.scrollIntoViewIfNeeded({ timeout: 8000 });
  await hostNameInput.click();
  await page.waitForTimeout(120);
  await hostNameInput.pressSequentially("Priya", { delay: 95 });
  await page.waitForTimeout(300);
  await tapForMotionRoom(page, page.getByText(/pick your lane/i));
  await pulseTapHighlightRoom(
    page,
    page.getByRole("button", { name: /^create room$/i }),
  );
  await pulseTapHighlightRoom(page, page.getByRole("button", { name: /join room/i }));
}

async function runDesktopRoomInteractions(page: Page, state: RoomSlideDefinition) {
  const status = state.room.status;
  if (status === "lobby") {
    await moveMouseTo(page, page.getByText(/scoreboard|Team A/i).first());
    await pulseMouseHighlight(page, page.getByRole("button", { name: /start game/i }));
    return;
  }
  if (status === "playing") {
    await moveMouseTo(page, page.getByText(/round|describe|concept|card/i).first());
    await pulseMouseHighlight(page, page.getByRole("button", { name: /correct/i }));
    await pulseMouseHighlight(
      page,
      page.getByRole("button", { name: /next card|no passes left/i }),
    );
    return;
  }
  if (status === "ended") {
    await moveMouseTo(page, page.getByText(/winner|game statistics|tie game|final/i).first());
  }
}

async function captureDesktopRoomVideo(
  browser: Browser,
  state: StateDefinition,
  outputPath: string,
) {
  const clipStart = Date.now();
  const outDir = path.dirname(outputPath);
  const context = await browser.newContext({
    viewport: { ...DESKTOP_CAPTURE_VIEWPORT },
    ...recordVideoForViewport(outDir, DESKTOP_CAPTURE_VIEWPORT),
  });
  await context.addInitScript({ content: getDemoInteractionOverlayScript() });
  const page = await context.newPage();
  await overrideChromiumCaptureBackground(page);
  if (state.mode === "start") {
    await page.goto("/start", { waitUntil: "networkidle" });
    await page.waitForTimeout(900);
    await runDesktopStartInteractions(page);
  } else {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await injectSession(page, state.playerId);
    await page.goto(`/room/${ROOM_ID}`, { waitUntil: "networkidle" });
    await expect(page).toHaveURL(new RegExp(`/room/${ROOM_ID}`));
    await page.waitForTimeout(900);
    await runDesktopRoomInteractions(page, state);
  }
  await padClipToMs(page, clipStart, CLIP_MS);
  const vid = page.video();
  await context.close();
  const tmp = vid ? await vid.path() : null;
  if (!tmp) {
    throw new Error("Playwright did not produce a desktop room recording.");
  }
  await fs.rename(tmp, outputPath);
}

async function pulseTapHighlightRoom(page: Page, locator: ReturnType<Page["locator"]>) {
  try {
    await locator.first().scrollIntoViewIfNeeded({ timeout: 5000 });
  } catch {
    return;
  }
  const box = await locator.first().boundingBox();
  if (!box) return;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.evaluate(
    ({ cx, cy }) => {
      window.__srDemoPulse?.(cx, cy, true);
    },
    { cx: x, cy: y },
  );
  await page.waitForTimeout(320);
}

async function tapForMotionRoom(page: Page, locator: ReturnType<Page["locator"]>) {
  try {
    await locator.first().scrollIntoViewIfNeeded({ timeout: 5000 });
  } catch {
    return;
  }
  const box = await locator.first().boundingBox();
  if (!box) return;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(380);
}

async function runMobileRoomInteractions(page: Page, state: RoomSlideDefinition) {
  const status = state.room.status;
  if (status === "lobby") {
    await tapForMotionRoom(page, page.getByText(/Alice|Team A|scoreboard/i).first());
    await pulseTapHighlightRoom(page, page.getByRole("button", { name: /start game/i }));
    return;
  }
  if (status === "playing") {
    await tapForMotionRoom(page, page.getByText(/round|describe|concept|card/i).first());
    await pulseTapHighlightRoom(page, page.getByRole("button", { name: /correct/i }));
    await pulseTapHighlightRoom(
      page,
      page.getByRole("button", { name: /next card|no passes left/i }),
    );
    return;
  }
  if (status === "ended") {
    await tapForMotionRoom(page, page.getByText(/winner|game statistics|tie game|final/i).first());
  }
}

async function captureMobileRoomVideo(
  browser: Browser,
  state: StateDefinition,
  outputPath: string,
) {
  const clipStart = Date.now();
  const outDir = path.dirname(outputPath);
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    viewport: { ...DEMO_MOBILE_VIEWPORT },
    ...recordVideoForViewport(outDir, DEMO_MOBILE_VIEWPORT),
  });
  await context.addInitScript({ content: getDemoInteractionOverlayScript() });
  const page = await context.newPage();
  await overrideChromiumCaptureBackground(page);
  if (state.mode === "start") {
    await page.goto("/start", { waitUntil: "networkidle" });
    await page.waitForTimeout(900);
    await runMobileStartInteractions(page);
  } else {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await injectSession(page, state.playerId);
    await page.goto(`/room/${ROOM_ID}`, { waitUntil: "networkidle" });
    await expect(page).toHaveURL(new RegExp(`/room/${ROOM_ID}`));
    await page.waitForTimeout(900);
    await runMobileRoomInteractions(page, state);
  }
  await padClipToMs(page, clipStart, CLIP_MS);
  const vid = page.video();
  await context.close();
  const tmp = vid ? await vid.path() : null;
  if (!tmp) {
    throw new Error("Playwright did not produce a mobile room recording.");
  }
  await fs.rename(tmp, outputPath);
}

async function renderSlideVideo(
  browser: Browser,
  title: string,
  subtitle: string,
  features: string[],
  desktopWebmPath: string,
  mobileWebmPath: string,
  outputPath: string,
) {
  const layoutSeed = await fs.readFile(SYNTAX_RUSH_LOGO_PATH);
  const phone = computePhoneFrameLayout(
    layoutSeed,
    COMPOSITE_PHONE_MAX_W,
    COMPOSITE_PHONE_MAX_H,
  );

  const desktopAspect =
    DESKTOP_CAPTURE_VIEWPORT.width / DESKTOP_CAPTURE_VIEWPORT.height;
  const desktopInset = 2 * (DESKTOP_FRAME_BEZEL + DESKTOP_FRAME_BORDER);
  const desktopInnerWidth = Math.round(DESKTOP_INNER_HEIGHT * desktopAspect);
  const desktopOuterWidth = desktopInnerWidth + desktopInset;
  const desktopOuterHeight = DESKTOP_INNER_HEIGHT + desktopInset;

  const syntaxLogoData = asDataUri(await fs.readFile(SYNTAX_RUSH_LOGO_PATH));
  const elementLogoData = asDataUri(await fs.readFile(ELEMENT_SOFTWARE_LOGO_PATH));

  const featuresListHtml = features
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join("");

  const slideDir = path.dirname(outputPath);
  await fs.mkdir(slideDir, { recursive: true });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ...recordVideoForViewport(slideDir, { width: 1920, height: 1080 }),
  });
  const page = await context.newPage();
  await overrideChromiumCaptureBackground(page);

  await withLocalClipServer(
    {
      "/desktop.webm": desktopWebmPath,
      "/mobile.webm": mobileWebmPath,
    },
    async (origin) => {
      const clipStart = Date.now();
      await page.setContent(
    `<!DOCTYPE html>
    <html style="background-color:#020617;color-scheme:dark">
      <head>
        <meta charset="utf-8" />
        <style>
          * { box-sizing: border-box; }
          html { background-color: #020617; }
          body {
            margin: 0;
            width: 1920px;
            height: 1080px;
            background:
              radial-gradient(circle at 15% 20%, #1e3a8a 0%, rgba(30, 58, 138, 0.25) 35%, transparent 55%),
              radial-gradient(circle at 85% 80%, #0f766e 0%, rgba(15, 118, 110, 0.2) 30%, transparent 52%),
              linear-gradient(140deg, #020617 0%, #0f172a 50%, #111827 100%);
            color: #f8fafc;
            font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            overflow: hidden;
          }
          .header {
            position: absolute;
            left: 96px;
            top: 96px;
            right: 96px;
            display: flex;
            flex-direction: row;
            justify-content: space-between;
            align-items: flex-start;
            gap: 48px;
          }
          .header-text {
            flex: 1;
            min-width: 0;
          }
          .header-logos {
            display: flex;
            flex-direction: row;
            align-items: center;
            gap: 24px;
            flex-shrink: 0;
            padding-top: 0;
          }
          .header-logos img {
            display: block;
            height: 225px;
            width: auto;
            max-width: 340px;
            object-fit: contain;
            object-position: center;
          }
          .header-logos .logo-element {
            height: 125px;
            max-width: 340px;
          }
          .kicker-wrap {
            display: flex;
            flex-direction: row;
            align-items: center;
            justify-content: flex-start;
            gap: 48px;
          }
          .kicker {
            display: inline-flex;
            align-items: center;
            border-radius: 999px;
            padding: 8px 14px;
            font-size: 15px;
            letter-spacing: 0.04em;
            text-transform: uppercase;
            font-weight: 600;
            background: rgba(59, 130, 246, 0.16);
            border: 1px solid rgba(147, 197, 253, 0.45);
            color: #bfdbfe;
          }
          .title {
            margin-top: 32px;
            font-size: 48px;
            line-height: 1.12;
            font-weight: 800;
          }
          .subtitle {
            margin-top: 28px;
            font-size: 28px;
            color: #cbd5e1;
            font-weight: 500;
          }
          .devices {
            position: absolute;
            left: 96px;
            right: 96px;
            bottom: 112px;
            top: 344px;
            display: flex;
            align-items: flex-start;
            justify-content: flex-start;
            gap: 40px;
          }
          .slide-features {
            flex: 1;
            flex-direction: column;
            align-items: flex-start;
            justify-content: flex-start;
            gap: 24px;
            min-width: 200px;
            max-width: 420px;
            align-self: flex-start;
            padding: 20px 8px 0 0;
          }
          .slide-features img {
            display: block;
            height: 150px;
            width: auto;
            max-width: 420px;
            object-fit: contain;
            object-position: center;
            margin-bottom: 96px
          }
          .slide-features h3 {
            margin: 0 0 14px 0;
            font-size: 40px;
            font-weight: 700;
            letter-spacing: 0.22em;
            text-transform: uppercase;
            color: rgba(148, 163, 184, 0.95);
          }
          .slide-features ul {
            margin: 0;
            padding-left: 1.15em;
          }
          .slide-features li {
            font-size: 28px;
            line-height: 1.45;
            color: #e2e8f0;
            margin-bottom: 10px;
          }
          .slide-features li::marker {
            color: #22d3ee;
          }
          .desktop-wrap {
            width: ${desktopOuterWidth}px;
            display: flex;
            flex-direction: column;
            align-items: center;
          }
          .desktop-frame {
            width: ${desktopOuterWidth}px;
            height: ${desktopOuterHeight}px;
            border-radius: 28px;
            background: linear-gradient(180deg, #374151 0%, #111827 100%);
            box-shadow: 0 35px 70px rgba(0, 0, 0, 0.55);
            padding: ${DESKTOP_FRAME_BEZEL}px;
            border: ${DESKTOP_FRAME_BORDER}px solid rgba(255, 255, 255, 0.08);
          }
          .desktop-screen {
            width: 100%;
            height: 100%;
            border-radius: 14px;
            overflow: hidden;
            background: #000;
          }
          .desktop-screen video {
            width: 100%;
            height: 100%;
            object-fit: contain;
            display: block;
            background: #020617;
            opacity: 0;
          }
          .desktop-screen video.sr-demo-video-visible {
            opacity: 1;
          }
          .desktop-stand {
            margin-top: 12px;
            width: 260px;
            height: 18px;
            border-radius: 999px;
            background: linear-gradient(180deg, #475569 0%, #1e293b 100%);
          }
          .phone-wrap {
            width: ${phone.frameWidth.toFixed(2)}px;
            flex-shrink: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: flex-start;
          }
          .phone-frame {
            width: ${phone.frameWidth.toFixed(2)}px;
            height: ${phone.frameHeight.toFixed(2)}px;
            border-radius: ${phone.frameRadius.toFixed(2)}px;
            background: linear-gradient(180deg, #475569 0%, #1e293b 100%);
            border: 3px solid rgba(255, 255, 255, 0.1);
            padding: 18px;
            box-shadow: 0 45px 90px rgba(0, 0, 0, 0.58);
            position: relative;
          }
          .phone-screen {
            width: 100%;
            height: 100%;
            border-radius: ${phone.screenRadius.toFixed(2)}px;
            overflow: hidden;
            background: #020617;
          }
          .phone-screen video {
            width: 100%;
            height: 100%;
            object-fit: contain;
            display: block;
            background: #020617;
            opacity: 0;
          }
          .phone-screen video.sr-demo-video-visible {
            opacity: 1;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="header-text">
          <div class="kicker-wrap">
            <div class="kicker">Syntax Rush Demo</div>
            <div class="kicker">syntaxrush.com</div>
          </div>

            <div class="title">${escapeHtml(title)}</div>
            <div class="subtitle">${escapeHtml(subtitle)}</div>
          </div>
          <div class="header-logos">
            <img class="logo-element" src="${elementLogoData}" alt="Element Software" />
          </div>
        </div>

        <div class="devices">
          <div class="desktop-wrap">
            <div class="desktop-frame">
              <div class="desktop-screen">
                <video class="desk-v" src="${origin}/desktop.webm" muted playsinline preload="auto"></video>
              </div>
            </div>
            <div class="desktop-stand"></div>
          </div>

          <div class="slide-features">
            <img src="${syntaxLogoData}" alt="Syntax Rush" />
            <h3>Highlights</h3>
            <ul>${featuresListHtml}</ul>
          </div>

          <div class="phone-wrap">
            <div class="phone-frame">
              <div class="phone-screen">
                <video class="mob-v" src="${origin}/mobile.webm" muted playsinline preload="auto"></video>
              </div>
            </div>
          </div>
        </div>
      </body>
    </html>`,
        { waitUntil: "load" },
      );

      await page.waitForTimeout(80);
      await primeEmbeddedDemoVideos(page);
      await padClipToMs(page, clipStart, CLIP_MS);
    },
  );

  const vid = page.video();
  await context.close();
  const tmp = vid ? await vid.path() : null;
  if (!tmp) {
    throw new Error("Playwright did not produce a composite desktop slide recording.");
  }
  await fs.rename(tmp, outputPath);
}

test("capture state-based demo clips with desktop and mobile frames (video)", async ({ browser }) => {
  await fs.mkdir(STILLS_DIR, { recursive: true });
  await fs.mkdir(SLIDES_DIR, { recursive: true });

  const roundStartedAt = new Date().toISOString();
  const states: StateDefinition[] = [
    {
      mode: "start",
      key: "01-start",
      title: "Start or join in seconds",
      subtitle: "Create a room or enter a code to jump straight into play.",
      features: [
        "Type your name and create a room in one flow",
        "Share the code or link so friends can join fast",
        "Works great on desktop and phone side by side",
      ],
    },
    {
      mode: "room",
      key: "02-lobby",
      title: "Lobby setup in seconds",
      subtitle: "Host and players join fast with teams and room status visible immediately.",
      features: [
        "Room code and share link for quick joins",
        "Team A & B rosters with live presence",
        "Host controls when the game starts",
      ],
      playerId: PLAYER_IDS.alice,
      scores: { a: 0, b: 0 },
      room: {
        status: "lobby",
        round_index: 0,
        current_card_index: 0,
        active_team: null,
        passes_used_team_a: 0,
        passes_used_team_b: 0,
        round_started_at: null,
      },
    },
    {
      mode: "room",
      key: "03-round1-active",
      title: "Round 1 starts instantly",
      subtitle: "Team A becomes active with a describer panel and live card prompts.",
      features: [
        "60-second rounds keep momentum high",
        "Describer sees the card; teammates guess",
        "Everyone else follows along in real time",
      ],
      playerId: PLAYER_IDS.alice,
      scores: { a: 0, b: 0 },
      room: {
        status: "playing",
        round_index: 1,
        current_card_index: 1,
        active_team: "A",
        passes_used_team_a: 0,
        passes_used_team_b: 0,
        round_started_at: roundStartedAt,
      },
    },
    {
      mode: "room",
      key: "04-live-scoring",
      title: "Realtime score updates",
      subtitle: "Correct answers update the scoreboard immediately for everyone.",
      features: [
        "Tap Correct when your team nails it",
        "Scores sync instantly for every player",
        "Head-to-head Team A vs Team B",
      ],
      playerId: PLAYER_IDS.alice,
      scores: { a: 1, b: 0 },
      room: {
        status: "playing",
        round_index: 1,
        current_card_index: 4,
        active_team: "A",
        passes_used_team_a: 1,
        passes_used_team_b: 0,
        round_started_at: roundStartedAt,
      },
    },
    {
      mode: "room",
      key: "05-pass-limit",
      title: "Smart pass limits keep pace",
      subtitle: "Teams can skip strategically, but limits preserve the competitive flow.",
      features: [
        "Skip tough cards with Next card",
        "Passes capped per team each round",
        "Stops stalled rounds and keeps play fair",
      ],
      playerId: PLAYER_IDS.alice,
      scores: { a: 2, b: 0 },
      room: {
        status: "playing",
        round_index: 1,
        current_card_index: 8,
        active_team: "A",
        passes_used_team_a: 3,
        passes_used_team_b: 0,
        round_started_at: roundStartedAt,
      },
    },
    {
      mode: "room",
      key: "06-round2-rotation",
      title: "Round rotation across teams",
      subtitle: "Round 2 shifts active play to Team B with a different describer.",
      features: [
        "Active team switches each round",
        "New describer keeps roles fresh",
        "Same room—updated board for everyone",
      ],
      playerId: PLAYER_IDS.dave,
      scores: { a: 2, b: 1 },
      room: {
        status: "playing",
        round_index: 2,
        current_card_index: 2,
        active_team: "B",
        passes_used_team_a: 0,
        passes_used_team_b: 1,
        round_started_at: roundStartedAt,
      },
    },
    {
      mode: "room",
      key: "07-game-ended",
      title: "Clean game-end summary",
      subtitle: "Hosts can end the session and everyone sees a clear final state.",
      features: [
        "Winner, final score, and game stats",
        "Rounds played and passes used at a glance",
        "Clear ending for streams, classes, or meetups",
      ],
      playerId: PLAYER_IDS.alice,
      scores: { a: 3, b: 2 },
      room: {
        status: "ended",
        round_index: 2,
        current_card_index: 5,
        active_team: "B",
        passes_used_team_a: 3,
        passes_used_team_b: 2,
        round_started_at: null,
      },
    },
  ];

  const slidePaths: string[] = [];

  for (const state of states) {
    if (state.mode === "room") {
      await seedState(buildSeed(state));
    }

    const desktopClipPath = path.join(STILLS_DIR, `${state.key}-desktop.webm`);
    const mobileClipPath = path.join(STILLS_DIR, `${state.key}-mobile.webm`);
    const slidePath = path.join(SLIDES_DIR, `${state.key}.webm`);

    await captureDesktopRoomVideo(browser, state, desktopClipPath);
    await captureMobileRoomVideo(browser, state, mobileClipPath);

    await renderSlideVideo(
      browser,
      state.title,
      state.subtitle,
      state.features,
      desktopClipPath,
      mobileClipPath,
      slidePath,
    );

    slidePaths.push(slidePath);
  }

  expect(slidePaths.length).toBeGreaterThan(0);

  const manifestLines: string[] = [];
  for (const slidePath of slidePaths) {
    manifestLines.push(`file '${slidePath}'`);
    manifestLines.push(`duration ${SLIDE_DURATION_SECONDS}`);
  }

  // Concat demuxer uses the duration of all entries except the final one,
  // so we repeat the final file path once to keep the last slide duration.
  manifestLines.push(`file '${slidePaths[slidePaths.length - 1]}'`);
  await fs.writeFile(MANIFEST_PATH, `${manifestLines.join("\n")}\n`, "utf8");
});
