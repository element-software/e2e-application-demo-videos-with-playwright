/**
 * demo-tour.spec.ts
 *
 * Scripted walk-through of the AppFlow demo app.
 *
 * For every "slide" this test:
 *  1. Opens a fresh browser context with viewport video recording
 *  2. Injects a high-contrast pointer + click pulse (visible in compressed video)
 *  3. Records one page or feature (direct navigation — no repeated journey from home)
 *  4. Saves a WebM clip under demo/slides/
 *
 * Concat order still walks the app end-to-end when all clips are stitched together.
 *
 * After all slides are captured, writes demo/manifest.txt for ffmpeg concat + branding (see demo.config.mjs).
 */

import { test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import * as os from 'os';
import * as path from 'path';
import { CAPTURE_DEMO_PROFILE } from '../e2e/fixtures/appflowProfile';
import {
  addForceDarkFirstPaintInitScript,
  asDataUri,
  overrideChromiumCaptureBackground,
  padClipToMs,
  primeEmbeddedDemoVideos,
  recordVideoForViewport,
  withLocalClipServer,
} from './support/demoVideo';

// ── Config ────────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..');
const SLIDES_DIR = path.join(REPO_ROOT, 'demo', 'slides');
const MANIFEST_PATH = path.join(REPO_ROOT, 'demo', 'manifest.txt');
const BASE_URL = process.env.DEMO_BASE_URL ?? 'http://localhost:3000';

const VIEWPORT = { width: 1280, height: 720 };

const DEMO_TMP_DIR = path.join(REPO_ROOT, 'demo', '.tmp');
const STILLS_DIR = path.join(DEMO_TMP_DIR, 'stills');

const SLIDE_SECONDS = 4.0;
const CLIP_MS = Math.round(SLIDE_SECONDS * 1000);

const APPFLOW_LOGO_PATH = path.join(REPO_ROOT, 'demo', 'branding', 'logo.png');

/**
 * Injected into every recorded page — follows real mouse events from Playwright.
 * Large yellow halo + dark-outlined core so the cursor stays obvious after H.264 encode.
 */
function installDemoPointer(): void {
  const w = window as Window & { __demoPointer?: boolean };
  if (w.__demoPointer) return;
  w.__demoPointer = true;

  if (!document.getElementById('__demoPointerStyles')) {
    const st = document.createElement('style');
    st.id = '__demoPointerStyles';
    st.textContent = `
      @keyframes __demoPointerIdle {
        0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.95; }
        50% { transform: translate(-50%, -50%) scale(1.12); opacity: 1; }
      }
      @keyframes __demoClickRipple {
        0% { opacity: 0.95; transform: translate(-50%, -50%) scale(0.35); }
        100% { opacity: 0; transform: translate(-50%, -50%) scale(2.1); }
      }
    `;
    document.head.appendChild(st);
  }

  const wrap = document.createElement('div');
  wrap.setAttribute('data-demo-pointer', '');
  Object.assign(wrap.style, {
    position: 'fixed',
    left: '0px',
    top: '0px',
    pointerEvents: 'none',
    zIndex: '2147483647',
    transform: 'translate(-50%, -50%)',
    transition: 'transform 0.08s ease-out',
  });

  const halo = document.createElement('div');
  Object.assign(halo.style, {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: '76px',
    height: '76px',
    margin: '0',
    borderRadius: '50%',
    transform: 'translate(-50%, -50%)',
    background: 'radial-gradient(circle, rgba(255,235,59,0.55) 0%, rgba(255,152,0,0.3) 55%, transparent 72%)',
    boxShadow:
      '0 0 0 3px rgba(255,255,255,0.95), 0 0 28px 10px rgba(255,235,59,0.9), 0 0 52px 20px rgba(255,87,34,0.5)',
    animation: '__demoPointerIdle 1.05s ease-in-out infinite',
  });

  const core = document.createElement('div');
  Object.assign(core.style, {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: '26px',
    height: '26px',
    margin: '0',
    borderRadius: '50%',
    transform: 'translate(-50%, -50%)',
    background: 'linear-gradient(155deg, #ffffff 0%, #ffeb3b 42%, #ff9800 100%)',
    border: '3px solid #0d0d0d',
    boxShadow: '0 0 0 2px #ffffff, 0 3px 12px rgba(0,0,0,0.6)',
  });

  wrap.appendChild(halo);
  wrap.appendChild(core);
  document.documentElement.appendChild(wrap);

  const moveTo = (clientX: number, clientY: number) => {
    wrap.style.left = `${clientX}px`;
    wrap.style.top = `${clientY}px`;
  };

  document.addEventListener('mousemove', (e) => moveTo(e.clientX, e.clientY), true);

  document.addEventListener(
    'mousedown',
    (e) => {
      wrap.style.transform = 'translate(-50%, -50%) scale(0.88)';
      const pulse = document.createElement('div');
      pulse.style.cssText = [
        'position:fixed',
        `left:${e.clientX}px`,
        `top:${e.clientY}px`,
        'width:64px',
        'height:64px',
        'border-radius:50%',
        'border:4px solid rgba(255,235,59,1)',
        'box-shadow:0 0 24px 8px rgba(255,152,0,0.9)',
        'transform:translate(-50%,-50%)',
        'pointer-events:none',
        'z-index:2147483646',
        'animation:__demoClickRipple 0.6s ease-out forwards',
      ].join(';');
      document.documentElement.appendChild(pulse);
      setTimeout(() => pulse.remove(), 650);
    },
    true
  );

  document.addEventListener(
    'mouseup',
    () => {
      wrap.style.transform = 'translate(-50%, -50%) scale(1)';
    },
    true
  );
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Park the pointer over the main content area before scrolling so wheel events hit the page. */
async function movePointerOverMainContent(page: Page): Promise<void> {
  const main = page.locator('main').first();
  await main.waitFor({ state: 'visible' });
  const box = await main.boundingBox();
  if (!box) {
    await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height * 0.55, { steps: 18 });
    return;
  }
  const x = Math.min(
    Math.max(box.x + box.width * 0.5, 24),
    VIEWPORT.width - 24
  );
  const y = Math.min(
    Math.max(box.y + Math.min(box.height * 0.42, 280), 120),
    VIEWPORT.height - 80
  );
  await page.mouse.move(x, y, { steps: 22 });
  await delay(160);
}

/**
 * Read scroll metrics from the page (call after layout is stable).
 */
async function getScrollMetrics(page: Page): Promise<{ scrollY: number; scrollMax: number; viewH: number }> {
  return page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement;
    const scrollH = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    const viewH = window.innerHeight;
    const scrollMax = Math.max(0, scrollH - viewH);
    return { scrollY: el.scrollTop, scrollMax, viewH };
  });
}

const SCROLL_MOVE_EPS = 1.5;

/**
 * Scrolls with small wheel deltas (visible on video). Stops each direction as soon as the document
 * no longer moves, so we do not hammer the top/bottom edge (avoids jerky rubber-band feel).
 */
async function scrollExplorePage(page: Page): Promise<void> {
  await movePointerOverMainContent(page);

  const { scrollMax, viewH } = await getScrollMetrics(page);

  // Nothing meaningful to scroll — hold frame instead of useless wheel events
  if (scrollMax <= 8) {
    await delay(450);
    return;
  }

  const maxSteps = 28;
  const baseDelta = Math.min(100, Math.max(52, Math.round(viewH * 0.085)));

  // ── Down: stop when scroll position stops increasing ─────────────────────
  let prevY = (await getScrollMetrics(page)).scrollY;
  for (let i = 0; i < maxSteps; i++) {
    await page.mouse.wheel(0, baseDelta);
    await delay(78);
    const y = (await getScrollMetrics(page)).scrollY;
    if (y - prevY < SCROLL_MOVE_EPS) break;
    prevY = y;
  }
  await delay(420);

  // ── Up: stop when scroll position stops decreasing ───────────────────────
  prevY = (await getScrollMetrics(page)).scrollY;
  for (let i = 0; i < maxSteps; i++) {
    await page.mouse.wheel(0, -baseDelta);
    await delay(68);
    const y = (await getScrollMetrics(page)).scrollY;
    if (prevY - y < SCROLL_MOVE_EPS) break;
    prevY = y;
    if (y <= SCROLL_MOVE_EPS) break;
  }
  await delay(240);
}

async function moveAndClick(page: Page, selector: string): Promise<void> {
  const loc = page.locator(selector).first();
  await loc.waitFor({ state: 'visible' });
  const box = await loc.boundingBox();
  if (!box) throw new Error(`No bounding box for selector: ${selector}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps: 32 });
  await delay(160);
  await page.mouse.down();
  await delay(55);
  await page.mouse.up();
  await delay(110);
}

async function moveAndType(page: Page, selector: string, text: string): Promise<void> {
  await moveAndClick(page, selector);
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.press('Backspace');
  await page.keyboard.type(text, { delay: 42 });
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
}

async function recordSlide(
  browser: Browser,
  name: string,
  run: (page: Page) => Promise<void>
): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pw-demo-slide-'));
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: VIEWPORT,
    reducedMotion: 'no-preference',
    ...recordVideoForViewport(tmpDir, VIEWPORT),
  });
  await routeDemoProfileFixture(context);
  const page = await context.newPage();
  await overrideChromiumCaptureBackground(page);
  await addForceDarkFirstPaintInitScript(page);
  await page.addInitScript(installDemoPointer);

  const clipStart = Date.now();
  await run(page);
  await settle(page);
  await padClipToMs(page, clipStart, CLIP_MS);

  const video = page.video();
  await page.close({ runBeforeUnload: true });
  if (!video) throw new Error('recordVideo did not produce a page video');
  await context.close();
  const tmpVideoPath = await video.path();
  const outPath = path.join(STILLS_DIR, `${name}.webm`);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.rename(tmpVideoPath, outPath);
  await fs.rm(tmpDir, { recursive: true, force: true });
  return outPath;
}

async function writeVideoConcatManifest(videoPaths: string[], manifestPath: string): Promise<void> {
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  const lines = videoPaths.map((p) => `file '${p.split(path.sep).join('/')}'`);
  await fs.writeFile(manifestPath, `${lines.join('\n')}\n`, 'utf8');
  console.log(`\nManifest written → ${manifestPath}\n  Clips : ${videoPaths.length}\n`);
}

// ── Tour segments: one URL + test id per clip (concat order = full-app story) ─

async function landOnPage(page: Page, urlPath: string, testId: string): Promise<void> {
  await page.goto(urlPath);
  await page.waitForSelector(`[data-testid="${testId}"]`);
  await delay(280);
  await scrollExplorePage(page);
}

async function landProfile(page: Page): Promise<void> {
  await page.goto('/profile');
  await page.waitForSelector('[data-testid="page-profile"]');
  await page.waitForSelector('[data-testid="profile-loaded"]');
  await delay(280);
  await scrollExplorePage(page);
}

async function landGetStarted(page: Page): Promise<void> {
  await page.goto('/get-started');
  await page.waitForSelector('[data-testid="page-get-started"]');
  await delay(280);
  await scrollExplorePage(page);
}

type SlideDefinition = {
  key: string;
  title: string;
  subtitle: string;
  bullets: string[];
  capture: (page: Page) => Promise<void>;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function renderCompositeSlide(
  browser: Browser,
  def: SlideDefinition,
  pageClipPath: string,
  outputPath: string
): Promise<void> {
  const logoPng = await fs.readFile(APPFLOW_LOGO_PATH);
  const logoData = asDataUri(logoPng);

  const bulletsHtml = def.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('');

  const slideDir = path.dirname(outputPath);
  await fs.mkdir(slideDir, { recursive: true });

  const clipStart = Date.now();
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    reducedMotion: 'no-preference',
    ...recordVideoForViewport(slideDir, { width: 1920, height: 1080 }),
  });
  const page = await context.newPage();
  await overrideChromiumCaptureBackground(page);

  await withLocalClipServer({ '/clip.webm': pageClipPath }, async (origin) => {
    await page.setContent(
      `<!DOCTYPE html>
<html style="background:#0b1220;color-scheme:dark">
  <head>
    <meta charset="utf-8" />
    <style>
      *{box-sizing:border-box}
      html{background:#0b1220}
      body{
        margin:0;width:1920px;height:1080px;overflow:hidden;
        background:
          radial-gradient(circle at 14% 18%, rgba(108,99,255,0.35) 0%, transparent 48%),
          radial-gradient(circle at 82% 78%, rgba(0,217,163,0.22) 0%, transparent 52%),
          linear-gradient(140deg, #0b1220 0%, #0f172a 55%, #0b1220 100%);
        color:#f8fafc;
        font-family: system-ui, -apple-system, Segoe UI, Inter, sans-serif;
      }
      /* Leave space for the header so the video frame can be sized predictably. */
      .wrap{
        position:absolute;
        left:64px; right:64px;
        top:260px; bottom:72px;
        display:flex;
        gap:48px;
        align-items:flex-start;
        justify-content:space-between;
      }
      .card{
        border:1px solid rgba(148,163,184,0.16);
        background: rgba(2,6,23,0.55);
        border-radius: 22px;
        box-shadow: 0 35px 90px rgba(0,0,0,0.55);
        overflow:hidden;
      }
      .video{
        position:relative;
        /* Match the captured clip (1280×720 = 16:9) and avoid letterbox bars. */
        height: 690px;
        aspect-ratio: 16 / 9;
        flex: 0 0 auto;
      }
      .video video{
        width:100%;height:100%;display:block;
        background:#0f1117;
        object-fit:cover;
        opacity:0;
      }
      .video video.sr-demo-video-visible{opacity:1}
      .header{
        position:absolute;left:64px;top:56px;right:64px;
        display:flex;align-items:flex-start;justify-content:space-between;gap:32px
      }
      .brand{
        display:flex;align-items:center;gap:14px;
        padding:10px 14px;border-radius:999px;
        border:1px solid rgba(148,163,184,0.22);
        background: rgba(2,6,23,0.35);
        color: rgba(226,232,240,0.92);
        font-weight:700;letter-spacing:0.02em;
      }
      .brand img{width:34px;height:34px;border-radius:10px;display:block}
      .title{margin-top:18px;font-size:54px;line-height:1.08;font-weight:900;letter-spacing:-0.03em}
      .subtitle{margin-top:18px;font-size:26px;line-height:1.35;color:#cbd5e1;font-weight:500}
      .panel{
        padding:28px 30px;
        height: 690px;
        width: 480px;
        flex: 0 0 auto;
      }
      .bullets{margin:22px 0 0 0;padding-left:1.1em}
      .bullets li{font-size:22px;line-height:1.5;margin:10px 0;color:#e2e8f0}
      .bullets li::marker{color:#22d3ee}
    </style>
  </head>
  <body>
    <div class="header">
      <div>
        <div class="brand"><img src="${logoData}" alt="AppFlow" /> AppFlow demo</div>
        <div class="title">${escapeHtml(def.title)}</div>
        <div class="subtitle">${escapeHtml(def.subtitle)}</div>
      </div>
    </div>

    <div class="wrap">
      <div class="card video">
        <video class="screen-video" src="${origin}/clip.webm" muted playsinline preload="auto"></video>
      </div>
      <div class="card panel">
        <div class="brand" style="display:inline-flex"><img src="${logoData}" alt=\"\" /> Highlights</div>
        <ul class="bullets">${bulletsHtml}</ul>
      </div>
    </div>
  </body>
</html>`,
      { waitUntil: 'load' }
    );

    await page.waitForTimeout(80);
    await primeEmbeddedDemoVideos(page);
    await padClipToMs(page, clipStart, CLIP_MS);
  });

  const vid = page.video();
  await context.close();
  const tmp = vid ? await vid.path() : null;
  if (!tmp) throw new Error('Playwright did not produce a composite slide recording.');
  await fs.rename(tmp, outputPath);
}

/** Install deterministic profile API for capture (see e2e/fixtures/appflowProfile.ts). */
async function routeDemoProfileFixture(context: BrowserContext): Promise<void> {
  await context.route('**/api/demo-profile', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(CAPTURE_DEMO_PROFILE),
    });
  });
}

// ── Test ──────────────────────────────────────────────────────────────────────

test('capture AppFlow demo tour', async ({ browser }) => {
  await fs.mkdir(SLIDES_DIR, { recursive: true });
  await fs.mkdir(STILLS_DIR, { recursive: true });

  /** One raw page-capture clip + one composited slide output per definition. */
  const slides: SlideDefinition[] = [
    {
      key: '01-home',
      title: 'A clean landing experience',
      subtitle: 'Start with a simple message, crisp CTAs, and modern layout.',
      bullets: ['Fast first paint and simple navigation', 'Hero + stats block for quick scanning', 'Built for consistent demo capture'],
      capture: async (page) => landOnPage(page, '/', 'page-home'),
    },
    {
      key: '02-features',
      title: 'Feature overview at a glance',
      subtitle: 'A grid of capabilities that reads well on video.',
      bullets: ['Cards keep focus and pacing', 'Readable contrast and spacing', 'Easy to extend with new sections'],
      capture: async (page) => landOnPage(page, '/features', 'page-features'),
    },
    {
      key: '03-dashboard',
      title: 'Metrics + trends',
      subtitle: 'A dashboard layout with KPI cards and a small chart.',
      bullets: ['Clear KPI deltas', 'Simple chart for movement', 'Great for scroll-based exploration'],
      capture: async (page) => landOnPage(page, '/dashboard', 'page-dashboard'),
    },
    {
      key: '04-profile',
      title: 'Dynamic profile data',
      subtitle: 'This page loads from an API that Playwright can fixture.',
      bullets: ['Fixture-driven demo content', 'Consistent test IDs for automation', 'Profile cards and skill tags'],
      capture: async (page) => landProfile(page),
    },
    {
      key: '05-get-started',
      title: 'Conversion-friendly signup',
      subtitle: 'A clean form layout with validation + success state.',
      bullets: ['Simple fields and spacing', 'Clear success banner', 'Great for scripted typing demos'],
      capture: async (page) => landGetStarted(page),
    },
    {
      key: '06-signup-filled',
      title: 'Scripted input capture',
      subtitle: 'Playwright types and scrolls smoothly for a demo-ready clip.',
      bullets: ['Visible cursor + clicks', 'Human-like typing speed', 'No jitter at scroll bounds'],
      capture: async (page) => {
        await page.goto('/get-started');
        await page.waitForSelector('[data-testid="page-get-started"]');
        await delay(180);
        await moveAndType(page, '[data-testid="input-name"]', 'Jane Smith');
        await delay(120);
        await moveAndType(page, '[data-testid="input-email"]', 'jane@company.com');
        await delay(120);
        await moveAndType(page, '[data-testid="input-password"]', 'super-secret-pw');
        await delay(180);
        await scrollExplorePage(page);
      },
    },
    {
      key: '07-signup-success',
      title: 'Success state',
      subtitle: 'A final clip showing the submit + confirmation message.',
      bullets: ['Clickable submit button', 'Instant feedback on success', 'Stitches cleanly into a final MP4'],
      capture: async (page) => {
        await page.goto('/get-started');
        await page.waitForSelector('[data-testid="page-get-started"]');
        await delay(160);
        await moveAndType(page, '[data-testid="input-name"]', 'Jane Smith');
        await delay(110);
        await moveAndType(page, '[data-testid="input-email"]', 'jane@company.com');
        await delay(110);
        await moveAndType(page, '[data-testid="input-password"]', 'super-secret-pw');
        await delay(180);
        await moveAndClick(page, '[data-testid="btn-submit"]');
        await page.waitForSelector('[data-testid="success-banner"]');
        await delay(220);
        await scrollExplorePage(page);
      },
    },
  ];

  const slidePaths: string[] = [];

  for (const def of slides) {
    const rawPath = await recordSlide(browser, def.key, def.capture);
    const slidePath = path.join(SLIDES_DIR, `${def.key}.webm`);
    await renderCompositeSlide(browser, def, rawPath, slidePath);
    slidePaths.push(slidePath);
    console.log(`  ✓ ${path.basename(slidePath)}`);
  }

  await writeVideoConcatManifest(slidePaths, MANIFEST_PATH);
});
