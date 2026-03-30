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

const DEMO_TMP_DIR = path.join(process.cwd(), "demo", ".tmp-mobile");
const STILLS_DIR = path.join(DEMO_TMP_DIR, "stills");
const SLIDES_DIR = path.join(DEMO_TMP_DIR, "slides");
const MANIFEST_PATH = path.join(SLIDES_DIR, "manifest.txt");
const SLIDE_DURATION_SECONDS = 5.5;
const CLIP_MS = Math.round(SLIDE_DURATION_SECONDS * 1000);

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

type SlideDefinition = {
  key: string;
  title: string;
  subtitle: string;
  mode: "start" | "room";
  playerId?: string;
  scores?: { a: number; b: number };
  room?: RoomSeed;
};

async function pulseTapHighlight(page: Page, locator: ReturnType<Page["locator"]>) {
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

async function tapForMotion(page: Page, locator: ReturnType<Page["locator"]>) {
  try {
    await locator.first().scrollIntoViewIfNeeded({ timeout: 5000 });
  } catch {
    return;
  }
  const box = await locator.first().boundingBox();
  if (!box) return;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.touchscreen.tap(x, y);
  await page.waitForTimeout(380);
}

async function runMobileSlideInteractions(page: Page, slide: SlideDefinition) {
  if (slide.mode === "start") {
    const hostNameInput = page.locator('input[name="hostName"]');
    await hostNameInput.scrollIntoViewIfNeeded({ timeout: 8000 });
    await hostNameInput.click();
    await page.waitForTimeout(120);
    await hostNameInput.pressSequentially("Priya", { delay: 95 });
    await page.waitForTimeout(300);
    await tapForMotion(page, page.getByText(/pick your lane/i));
    await pulseTapHighlight(
      page,
      page.getByRole("button", { name: /^create room$/i }),
    );
    await pulseTapHighlight(page, page.getByRole("button", { name: /join room/i }));
    return;
  }

  const status = slide.room?.status;
  if (status === "lobby") {
    await tapForMotion(page, page.getByText(/Alice|Team A|scoreboard/i).first());
    await pulseTapHighlight(page, page.getByRole("button", { name: /start game/i }));
    return;
  }
  if (status === "playing") {
    await tapForMotion(page, page.getByText(/round|describe|concept|card/i).first());
    await pulseTapHighlight(page, page.getByRole("button", { name: /correct/i }));
    await pulseTapHighlight(page, page.getByRole("button", { name: /next card|no passes left/i }));
    return;
  }
  if (status === "ended") {
    await tapForMotion(page, page.getByText(/winner|game statistics|tie game|final/i).first());
  }
}

async function captureMobileScreenVideo(
  browser: Browser,
  slide: SlideDefinition,
  rawOutPath: string,
) {
  const clipStart = Date.now();
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    viewport: { ...DEMO_MOBILE_VIEWPORT },
    ...recordVideoForViewport(path.dirname(rawOutPath), DEMO_MOBILE_VIEWPORT),
  });
  await context.addInitScript({ content: getDemoInteractionOverlayScript() });
  const page = await context.newPage();
  await overrideChromiumCaptureBackground(page);

  if (slide.mode === "start") {
    await page.goto("/start", { waitUntil: "networkidle" });
  } else {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await injectSession(page, slide.playerId ?? PLAYER_IDS.alice);
    await page.goto(`/room/${ROOM_ID}`, { waitUntil: "networkidle" });
    await expect(page).toHaveURL(new RegExp(`/room/${ROOM_ID}`));
  }

  await page.waitForTimeout(900);
  await runMobileSlideInteractions(page, slide);
  await padClipToMs(page, clipStart, CLIP_MS);

  const vid = page.video();
  await context.close();
  const tmp = vid ? await vid.path() : null;
  if (!tmp) {
    throw new Error("Playwright did not produce a mobile screen recording.");
  }
  await fs.rename(tmp, rawOutPath);
}

async function renderMobileSlideVideo(
  browser: Browser,
  title: string,
  subtitle: string,
  screenWebmPath: string,
  outputPath: string,
) {
  const layoutSeed = await fs.readFile(SYNTAX_RUSH_LOGO_PATH);
  const syntaxLogoData = asDataUri(await fs.readFile(SYNTAX_RUSH_LOGO_PATH));
  const elementLogoData = asDataUri(await fs.readFile(ELEMENT_SOFTWARE_LOGO_PATH));
  const {
    frameWidth,
    frameHeight,
    frameRadius,
    screenRadius,
  } = computePhoneFrameLayout(layoutSeed, 640, 1320);

  const slideDir = path.dirname(outputPath);
  await fs.mkdir(slideDir, { recursive: true });

  const context = await browser.newContext({
    viewport: { width: 1080, height: 1920 },
    ...recordVideoForViewport(slideDir, { width: 1080, height: 1920 }),
  });
  const page = await context.newPage();
  await overrideChromiumCaptureBackground(page);

  await withLocalClipServer({ "/screen.webm": screenWebmPath }, async (origin) => {
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
            width: 1080px;
            height: 1920px;
            color: #f8fafc;
            font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            background:
              radial-gradient(circle at 12% 12%, #1e3a8a 0%, rgba(30,58,138,0.34) 28%, transparent 50%),
              radial-gradient(circle at 85% 88%, #0d9488 0%, rgba(13,148,136,0.3) 24%, transparent 52%),
              linear-gradient(160deg, #020617 0%, #0f172a 46%, #111827 100%);
            overflow: hidden;
            display: flex;
            flex-direction: column;
            padding: 120px 72px 72px;
          }
          .header {
            flex-shrink: 0;
            padding: 0 8px 8px;
            text-align: center;
          }
          .kicker-wrap {
            display: flex;
            flex-direction: row;
            align-items: center;
            justify-content: center;
            gap: 48px;
            width: 100%;
          }
          .kicker {
            display: inline-flex;
            padding: 12px 22px;
            border-radius: 999px;
            font-size: 20px;
            letter-spacing: 0.04em;
            text-transform: uppercase;
            font-weight: 700;
            color: #bae6fd;
            border: 1px solid rgba(56, 189, 248, 0.45);
            background: rgba(14, 116, 144, 0.2);
          }
          .title {
            margin-top: 28px;
            font-size: 56px;
            line-height: 1.08;
            font-weight: 800;
            letter-spacing: -0.01em;
          }
          .subtitle {
            margin-top: 22px;
            font-size: 30px;
            line-height: 1.35;
            color: #dbeafe;
            font-weight: 500;
            max-width: 920px;
            margin-left: auto;
            margin-right: auto;
          }
          .device-stage {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 88px 0 48px;
            min-height: 0;
          }
          .phone-wrap {
            width: ${frameWidth.toFixed(2)}px;
            flex-shrink: 0;
          }
          .phone-frame {
            width: ${frameWidth.toFixed(2)}px;
            height: ${frameHeight.toFixed(2)}px;
            border-radius: ${frameRadius.toFixed(2)}px;
            background: linear-gradient(180deg, #475569 0%, #1e293b 100%);
            border: 3px solid rgba(255, 255, 255, 0.1);
            padding: 18px;
            box-shadow: 0 45px 90px rgba(0, 0, 0, 0.58);
            position: relative;
          }
          .phone-screen {
            width: 100%;
            height: 100%;
            border-radius: ${screenRadius.toFixed(2)}px;
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
          .footer-logos {
            flex-shrink: 0;
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: center;
            gap: 64px 72px;
            padding: 40px 24px 8px;
            border-top: 1px solid rgba(148, 163, 184, 0.12);
          }
          .footer-logos img {
            display: block;
            height: 125px;
            width: auto;
            max-width: 440px;
            object-fit: contain;
            object-position: center;
          }
          .footer-logos .logo-element {
            height: 125px;
            max-width: 440px;
          }
        </style>
      </head>
      <body>
        <header class="header">
        <div class="kicker-wrap">
          <div class="kicker">Syntax Rush</div>
          <div class="kicker">syntaxrush.com</div>
        </div>
          <div class="title">${escapeHtml(title)}</div>
          <div class="subtitle">${escapeHtml(subtitle)}</div>
        </header>
        <div class="device-stage">
          <div class="phone-wrap">
            <div class="phone-frame">
              <div class="phone-screen">
                <video class="screen-video" src="${origin}/screen.webm" muted playsinline preload="auto"></video>
              </div>
            </div>
          </div>
        </div>
        <footer class="footer-logos">
          <img src="${syntaxLogoData}" alt="Syntax Rush" />
          <img class="logo-element" src="${elementLogoData}" alt="Element Software" />
        </footer>
      </body>
    </html>`,
      { waitUntil: "load" },
    );

    await page.waitForTimeout(80);
    await primeEmbeddedDemoVideos(page);
    await padClipToMs(page, clipStart, CLIP_MS);
  });

  const vid = page.video();
  await context.close();
  const tmp = vid ? await vid.path() : null;
  if (!tmp) {
    throw new Error("Playwright did not produce a composite mobile slide recording.");
  }
  await fs.rename(tmp, outputPath);
}

test.skip(!!process.env.CI, "Skip heavy demo-video-mobile spec in main CI E2E runs");
test("capture mobile-only reel clips with captions (video)", async ({ browser }) => {
  await fs.mkdir(STILLS_DIR, { recursive: true });
  await fs.mkdir(SLIDES_DIR, { recursive: true });

  const roundStartedAt = new Date().toISOString();
  const slides: SlideDefinition[] = [
    {
      key: "01-start",
      title: "Start or join in seconds",
      subtitle: "Create a room or enter a code to jump straight into play.",
      mode: "start",
    },
    {
      key: "02-lobby",
      title: "Split into Team A and Team B",
      subtitle: "Players appear live in the lobby while the host sets up the round.",
      mode: "room",
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
      key: "03-round1",
      title: "Host starts the game",
      subtitle: "A round begins instantly and one describer gets the active card.",
      mode: "room",
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
      key: "04-score",
      title: "Correct answers earn points",
      subtitle: "Tap Correct and the scoreboard updates live for everyone.",
      mode: "room",
      playerId: PLAYER_IDS.alice,
      scores: { a: 1, b: 0 },
      room: {
        status: "playing",
        round_index: 1,
        current_card_index: 3,
        active_team: "A",
        passes_used_team_a: 1,
        passes_used_team_b: 0,
        round_started_at: roundStartedAt,
      },
    },
    {
      key: "05-passes",
      title: "Skips are limited per team",
      subtitle: "Use passes strategically to keep rounds quick and competitive.",
      mode: "room",
      playerId: PLAYER_IDS.alice,
      scores: { a: 2, b: 0 },
      room: {
        status: "playing",
        round_index: 1,
        current_card_index: 7,
        active_team: "A",
        passes_used_team_a: 3,
        passes_used_team_b: 0,
        round_started_at: roundStartedAt,
      },
    },
    {
      key: "06-rotation",
      title: "Teams rotate each round",
      subtitle: "Round 2 hands play to Team B with a new describer.",
      mode: "room",
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
      key: "07-finish",
      title: "End game and show winner",
      subtitle: "Final scores and game stats appear clearly when the game ends.",
      mode: "room",
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
    {
      key: "08-outro",
      title: "Built for quick team play",
      subtitle: "Perfect for classrooms, meetups, and remote team warmups.",
      mode: "room",
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
  for (const slide of slides) {
    if (slide.mode === "room") {
      await seedState(buildSeed(slide));
    }

    const rawPath = path.join(STILLS_DIR, `${slide.key}-screen.webm`);
    const slidePath = path.join(SLIDES_DIR, `${slide.key}.webm`);

    await captureMobileScreenVideo(browser, slide, rawPath);
    await renderMobileSlideVideo(
      browser,
      slide.title,
      slide.subtitle,
      rawPath,
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
  manifestLines.push(`file '${slidePaths[slidePaths.length - 1]}'`);
  await fs.writeFile(MANIFEST_PATH, `${manifestLines.join("\n")}\n`, "utf8");
});
