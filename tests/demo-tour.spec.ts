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
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CAPTURE_DEMO_PROFILE } from '../e2e/fixtures/appflowProfile';

// ── Config ────────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..');
const SLIDES_DIR = path.join(REPO_ROOT, 'demo', 'slides');
const MANIFEST_PATH = path.join(REPO_ROOT, 'demo', 'manifest.txt');
const BASE_URL = process.env.DEMO_BASE_URL ?? 'http://localhost:3000';

const VIEWPORT = { width: 1280, height: 720 };

/** RGBA for `Emulation.setDefaultBackgroundColorOverride` (alpha 0–1). */
const CAPTURE_PAGE_BG = { r: 15, g: 17, b: 23, a: 1 } as const;

/**
 * Chromium video capture can paint white between blank document → first navigation.
 * Set a dark compositor background before any `goto` to avoid white flashes at clip boundaries.
 */
async function overrideChromiumCaptureBackground(page: Page) {
  try {
    const session = await page.context().newCDPSession(page);
    await session.send('Emulation.setDefaultBackgroundColorOverride', {
      color: CAPTURE_PAGE_BG,
    });
  } catch {
    /* Chromium-only; ignore if CDP is unavailable. */
  }
}

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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-demo-slide-'));
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: VIEWPORT,
    reducedMotion: 'no-preference',
    recordVideo: {
      dir: tmpDir,
      size: VIEWPORT,
    },
  });
  await routeDemoProfileFixture(context);
  const page = await context.newPage();
  await overrideChromiumCaptureBackground(page);
  await page.addInitScript(() => {
    // Ensure the very first paints are dark (CSS may not be loaded yet).
    const st = document.createElement('style');
    st.textContent = `
      html, body { background: #0f1117 !important; color-scheme: dark; }
    `;
    document.head.appendChild(st);
  });
  await page.addInitScript(installDemoPointer);

  await run(page);
  await settle(page);
  await delay(750);

  const video = page.video();
  await page.close();
  if (!video) throw new Error('recordVideo did not produce a page video');
  const outPath = path.join(SLIDES_DIR, `${name}.webm`);
  await video.saveAs(outPath);
  await context.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  return outPath;
}

function writeVideoConcatManifest(videoPaths: string[], manifestPath: string): void {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  const lines = videoPaths.map((p) => `file '${p.split(path.sep).join('/')}'`);
  fs.writeFileSync(manifestPath, `${lines.join('\n')}\n`);
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
  fs.mkdirSync(SLIDES_DIR, { recursive: true });

  const clips: string[] = [];

  clips.push(
    await recordSlide(browser, '01-home', async (page) => {
      await landOnPage(page, '/', 'page-home');
    })
  );

  clips.push(
    await recordSlide(browser, '02-features', async (page) => {
      await landOnPage(page, '/features', 'page-features');
    })
  );

  clips.push(
    await recordSlide(browser, '03-dashboard', async (page) => {
      await landOnPage(page, '/dashboard', 'page-dashboard');
    })
  );

  clips.push(
    await recordSlide(browser, '04-profile', async (page) => {
      await landProfile(page);
    })
  );

  clips.push(
    await recordSlide(browser, '05-get-started', async (page) => {
      await landGetStarted(page);
    })
  );

  clips.push(
    await recordSlide(browser, '06-signup-filled', async (page) => {
      await page.goto('/get-started');
      await page.waitForSelector('[data-testid="page-get-started"]');
      await delay(220);
      await moveAndType(page, '[data-testid="input-name"]', 'Jane Smith');
      await delay(140);
      await moveAndType(page, '[data-testid="input-email"]', 'jane@company.com');
      await delay(140);
      await moveAndType(page, '[data-testid="input-password"]', 'super-secret-pw');
      await delay(200);
      await scrollExplorePage(page);
    })
  );

  clips.push(
    await recordSlide(browser, '07-signup-success', async (page) => {
      await page.goto('/get-started');
      await page.waitForSelector('[data-testid="page-get-started"]');
      await delay(180);
      await moveAndType(page, '[data-testid="input-name"]', 'Jane Smith');
      await delay(110);
      await moveAndType(page, '[data-testid="input-email"]', 'jane@company.com');
      await delay(110);
      await moveAndType(page, '[data-testid="input-password"]', 'super-secret-pw');
      await delay(200);
      await moveAndClick(page, '[data-testid="btn-submit"]');
      await page.waitForSelector('[data-testid="success-banner"]');
      await delay(280);
      await scrollExplorePage(page);
    })
  );

  for (const c of clips) {
    console.log(`  ✓ ${path.basename(c)}`);
  }

  writeVideoConcatManifest(clips, MANIFEST_PATH);
});
