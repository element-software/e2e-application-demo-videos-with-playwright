/**
 * prayertimes-demo.spec.ts
 *
 * Playwright demo-video spec for https://app.prayertimes.dev
 *
 * Journey covered:
 *   01 — Home / Today's Prayer Times
 *   02 — Built-in Product Tour
 *   03 — Location & City Search
 *   04 — Monthly Prayer Calendar
 *   05 — Calculation Settings
 *   06 — Qibla Compass
 *
 * For every slide:
 *   1. Captures a desktop clip at 1440×900
 *   2. Captures a mobile clip at 480×960 (9:20 portrait)
 *   3. Renders both into a branded 1920×1080 composite:
 *        desktop browser frame │ feature bullets │ phone frame
 *
 * After all slides are captured, writes a concat manifest for
 * `npm run prayertimes:demo:render` (→ demo/output/prayertimes-demo.mp4).
 */

import { test, devices, type Browser, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  computePhoneFrameLayout,
  DEMO_MOBILE_VIEWPORT,
  getDemoInteractionOverlayScript,
  recordVideoForViewport,
  padClipToMs,
  withLocalClipServer,
  primeEmbeddedDemoVideos,
  overrideChromiumCaptureBackground,
} from './support/demoVideo';

// ── Paths & timing ────────────────────────────────────────────────────────────

const DEMO_TMP_DIR = path.join(process.cwd(), 'demo', '.tmp-prayertimes');
const STILLS_DIR = path.join(DEMO_TMP_DIR, 'stills');
const SLIDES_DIR = path.join(DEMO_TMP_DIR, 'slides');
const MANIFEST_PATH = path.join(SLIDES_DIR, 'manifest.txt');

const SLIDE_DURATION_SECONDS = 7.5;
const CLIP_MS = Math.round(SLIDE_DURATION_SECONDS * 1000);

/** Desktop capture viewport — must match the composite frame dimensions. */
const DESKTOP_CAPTURE_VIEWPORT = { width: 1440, height: 900 } as const;
const DESKTOP_FRAME_BEZEL = 16;
const DESKTOP_FRAME_BORDER = 2;
/** Inner screen height in the 1920×1080 composite (width derived from 1440:900 aspect). */
const DESKTOP_INNER_HEIGHT = 580;

/** Phone frame bounds inside the 1920×1080 composite. */
const COMPOSITE_PHONE_MAX_W = 400;
const COMPOSITE_PHONE_MAX_H = 620;

// ── Branding ──────────────────────────────────────────────────────────────────

/**
 * Inline SVG crescent-moon + star logo for prayertimes.dev.
 * Encoded as a base64 SVG data URI so no external file or network fetch is needed.
 */
function getPrayerTimesLogoDataUri(): string {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">',
    '<rect width="64" height="64" rx="14" fill="#064e3b"/>',
    '<path d="M32 8a22 22 0 1 0 17 35 17 17 0 1 1-17-35z" fill="#34d399"/>',
    '<circle cx="48" cy="18" r="5" fill="#34d399"/>',
    '</svg>',
  ].join('');
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Interaction helpers ───────────────────────────────────────────────────────

/** Smooth scroll through the main content area and scroll back to top. */
async function scrollPage(page: Page): Promise<void> {
  await page.waitForTimeout(350);
  const main = page.locator('main, [role="main"], body').first();
  const box = await main.boundingBox().catch(() => null);
  const cx = box ? box.x + box.width * 0.5 : DESKTOP_CAPTURE_VIEWPORT.width / 2;
  const cy = box ? box.y + Math.min(box.height * 0.42, 320) : 380;
  await page.mouse.move(cx, cy, { steps: 18 });
  await page.waitForTimeout(120);
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, 80);
    await page.waitForTimeout(75);
  }
  await page.waitForTimeout(350);
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, -80);
    await page.waitForTimeout(65);
  }
  await page.waitForTimeout(220);
}

/**
 * Move the cursor to a matching element and fire the demo pulse animation.
 * Silently skips if the element is not found.
 */
async function pulseHighlight(page: Page, selector: string): Promise<void> {
  try {
    const loc = page.locator(selector).first();
    const box = await loc.boundingBox({ timeout: 2000 });
    if (!box) return;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y, { steps: 22 });
    await page.waitForTimeout(160);
    await page.evaluate(
      ({ cx, cy }) => { (window as Window & { __srDemoPulse?: (x: number, y: number, t: boolean) => void }).__srDemoPulse?.(cx, cy, false); },
      { cx: x, cy: y },
    );
    await page.waitForTimeout(340);
  } catch {
    /* element absent — skip gracefully */
  }
}

/**
 * Click the first visible element matching any of the given CSS selectors.
 * Returns true if a click was performed.
 */
async function tryClick(page: Page, ...selectors: string[]): Promise<boolean> {
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 1800 })) {
        const box = await loc.boundingBox();
        if (!box) continue;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 20 });
        await page.waitForTimeout(110);
        await page.mouse.down();
        await page.waitForTimeout(50);
        await page.mouse.up();
        await page.waitForTimeout(380);
        return true;
      }
    } catch {
      /* try next selector */
    }
  }
  return false;
}

/**
 * Try to start the app's built-in product tour.
 * Checks common tour-library triggers (Shepherd, Driver, Intro.js, Joyride, custom).
 */
async function tryStartTour(page: Page): Promise<void> {
  await tryClick(
    page,
    '[aria-label*="tour" i]',
    '[aria-label*="guide" i]',
    '[aria-label*="help" i]',
    'button:has-text("Tour")',
    'button:has-text("Start tour")',
    'button:has-text("Take a tour")',
    'button:has-text("Help")',
    'button:has-text("?")',
    '[class*="tour-btn"]',
    '[class*="help-btn"]',
    '[class*="walkthrough"]',
    '[data-tour-start]',
    '[data-action="start-tour"]',
    '.help-icon',
  );
}

/**
 * Advance one step in an active product tour.
 * Checks common tour-library next/continue buttons.
 */
async function tryAdvanceTour(page: Page): Promise<void> {
  await tryClick(
    page,
    '.shepherd-button-primary',
    '.shepherd-button:last-child',
    '[data-driver-action="next"]',
    '.driver-navigation-btns button:last-child',
    '[data-action="next-step"]',
    'button:has-text("Next")',
    'button:has-text("Got it")',
    'button:has-text("Continue")',
    'button:has-text("OK")',
    '.introjs-nextbutton',
    '.joyride-button--primary',
    '[class*="tour-next"]',
    '[class*="next-btn"]',
    '[aria-label="Next step"]',
  );
}

/**
 * Try to open the location / city-search panel.
 * Returns true if the panel was opened.
 */
async function tryOpenLocationSearch(page: Page): Promise<boolean> {
  return tryClick(
    page,
    '[aria-label*="location" i]',
    '[aria-label*="city" i]',
    '[aria-label*="change location" i]',
    '[class*="location-btn"]',
    '[class*="city-picker"]',
    '[class*="location-selector"]',
    '[class*="location-name"]',
    '[data-action="change-location"]',
    'button:has-text("Change location")',
    'button:has-text("Search city")',
    '.location-button',
  );
}

/**
 * Navigate to a named section of the app.
 * Tries URL paths first (works for multi-page and SPA apps with proper catch-all routes),
 * then falls back to clicking matching nav links and buttons.
 */
async function navigateToSection(
  page: Page,
  paths: string[],
  linkTexts: string[],
): Promise<void> {
  for (const p of paths) {
    try {
      await page.goto(p, { waitUntil: 'domcontentloaded', timeout: 10_000 });
      await page.waitForTimeout(900);
      return;
    } catch {
      /* try next path */
    }
  }
  // Fallback: return to home and look for nav links / buttons
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(500);
  for (const text of linkTexts) {
    try {
      const link = page.getByRole('link', { name: new RegExp(text, 'i') }).first();
      if (await link.isVisible({ timeout: 2000 })) {
        await link.click();
        await page.waitForTimeout(800);
        return;
      }
    } catch { /* try next */ }
  }
  for (const text of linkTexts) {
    try {
      const btn = page.getByRole('button', { name: new RegExp(text, 'i') }).first();
      if (await btn.isVisible({ timeout: 1500 })) {
        await btn.click();
        await page.waitForTimeout(800);
        return;
      }
    } catch { /* try next */ }
  }
}

// ── Per-slide capture functions ───────────────────────────────────────────────

type SlideCapture = (page: Page) => Promise<void>;

async function captureDesktopClip(
  browser: Browser,
  capture: SlideCapture,
  outputPath: string,
): Promise<void> {
  const clipStart = Date.now();
  const context = await browser.newContext({
    viewport: { ...DESKTOP_CAPTURE_VIEWPORT },
    ...recordVideoForViewport(path.dirname(outputPath), DESKTOP_CAPTURE_VIEWPORT),
  });
  await context.addInitScript({ content: getDemoInteractionOverlayScript() });
  const page = await context.newPage();
  await overrideChromiumCaptureBackground(page);
  await capture(page);
  await padClipToMs(page, clipStart, CLIP_MS);
  const vid = page.video();
  await context.close();
  const tmp = vid ? await vid.path() : null;
  if (!tmp) throw new Error('Playwright did not produce a desktop clip.');
  await fs.rename(tmp, outputPath);
}

async function captureMobileClip(
  browser: Browser,
  capture: SlideCapture,
  outputPath: string,
): Promise<void> {
  const clipStart = Date.now();
  const context = await browser.newContext({
    ...devices['iPhone 13'],
    viewport: { ...DEMO_MOBILE_VIEWPORT },
    ...recordVideoForViewport(path.dirname(outputPath), DEMO_MOBILE_VIEWPORT),
  });
  await context.addInitScript({ content: getDemoInteractionOverlayScript() });
  const page = await context.newPage();
  await overrideChromiumCaptureBackground(page);
  await capture(page);
  await padClipToMs(page, clipStart, CLIP_MS);
  const vid = page.video();
  await context.close();
  const tmp = vid ? await vid.path() : null;
  if (!tmp) throw new Error('Playwright did not produce a mobile clip.');
  await fs.rename(tmp, outputPath);
}

// ── Composite slide renderer ──────────────────────────────────────────────────

async function renderCompositeSlide(
  browser: Browser,
  title: string,
  subtitle: string,
  features: string[],
  desktopWebmPath: string,
  mobileWebmPath: string,
  outputPath: string,
): Promise<void> {
  const logoDataUri = getPrayerTimesLogoDataUri();

  // Phone frame layout (screenshotBuffer arg is ignored by the function)
  const phone = computePhoneFrameLayout(Buffer.alloc(0), COMPOSITE_PHONE_MAX_W, COMPOSITE_PHONE_MAX_H);

  const desktopAspect = DESKTOP_CAPTURE_VIEWPORT.width / DESKTOP_CAPTURE_VIEWPORT.height;
  const desktopInset = 2 * (DESKTOP_FRAME_BEZEL + DESKTOP_FRAME_BORDER);
  const desktopInnerWidth = Math.round(DESKTOP_INNER_HEIGHT * desktopAspect);
  const desktopOuterWidth = desktopInnerWidth + desktopInset;
  const desktopOuterHeight = DESKTOP_INNER_HEIGHT + desktopInset;

  const featuresHtml = features.map((f) => `<li>${escapeHtml(f)}</li>`).join('');

  const slideDir = path.dirname(outputPath);
  await fs.mkdir(slideDir, { recursive: true });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ...recordVideoForViewport(slideDir, { width: 1920, height: 1080 }),
  });
  const page = await context.newPage();
  await overrideChromiumCaptureBackground(page);

  await withLocalClipServer(
    { '/desktop.webm': desktopWebmPath, '/mobile.webm': mobileWebmPath },
    async (origin) => {
      const clipStart = Date.now();

      await page.setContent(
        `<!DOCTYPE html>
<html style="background-color:#060d1a;color-scheme:dark">
  <head>
    <meta charset="utf-8" />
    <style>
      * { box-sizing: border-box; }
      html { background-color: #060d1a; }
      body {
        margin: 0;
        width: 1920px;
        height: 1080px;
        background:
          radial-gradient(circle at 14% 18%, #064e3b 0%, rgba(6,78,59,0.28) 32%, transparent 54%),
          radial-gradient(circle at 84% 82%, #0e7490 0%, rgba(14,116,144,0.22) 28%, transparent 52%),
          linear-gradient(140deg, #060d1a 0%, #0a1f2e 50%, #0c1b2a 100%);
        color: #f0fdf4;
        font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        overflow: hidden;
      }

      /* ── Header ─────────────────────────────────────────────── */
      .header {
        position: absolute;
        left: 96px; top: 88px; right: 96px;
        display: flex;
        flex-direction: row;
        justify-content: space-between;
        align-items: flex-start;
        gap: 48px;
      }
      .header-text { flex: 1; min-width: 0; }
      .kicker-wrap {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 20px;
      }
      .kicker {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        padding: 8px 16px;
        font-size: 15px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        font-weight: 700;
        background: rgba(6,78,59,0.32);
        border: 1px solid rgba(52,211,153,0.45);
        color: #a7f3d0;
      }
      .title {
        margin-top: 28px;
        font-size: 46px;
        line-height: 1.12;
        font-weight: 800;
        color: #ecfdf5;
      }
      .subtitle {
        margin-top: 14px;
        font-size: 25px;
        color: #a7f3d0;
        font-weight: 500;
        line-height: 1.38;
      }
      .header-brand {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 18px;
        border-radius: 999px;
        border: 1px solid rgba(52,211,153,0.3);
        background: rgba(6,78,59,0.25);
        color: #a7f3d0;
        font-size: 17px;
        font-weight: 700;
        letter-spacing: 0.02em;
        white-space: nowrap;
      }
      .header-brand img {
        width: 32px; height: 32px;
        border-radius: 8px;
        display: block;
      }

      /* ── Devices stage ───────────────────────────────────────── */
      .devices {
        position: absolute;
        left: 96px; right: 96px;
        top: 328px; bottom: 72px;
        display: flex;
        align-items: flex-start;
        justify-content: flex-start;
        gap: 36px;
      }

      /* Desktop device */
      .desktop-wrap {
        width: ${desktopOuterWidth}px;
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
      }
      .desktop-frame {
        width: ${desktopOuterWidth}px;
        height: ${desktopOuterHeight}px;
        border-radius: 26px;
        background: linear-gradient(180deg, #374151 0%, #111827 100%);
        box-shadow: 0 32px 68px rgba(0,0,0,0.58);
        padding: ${DESKTOP_FRAME_BEZEL}px;
        border: ${DESKTOP_FRAME_BORDER}px solid rgba(255,255,255,0.08);
      }
      .desktop-screen {
        width: 100%; height: 100%;
        border-radius: 13px;
        overflow: hidden;
        background: #000;
      }
      .desktop-screen video {
        width: 100%; height: 100%;
        object-fit: contain;
        display: block;
        background: #060d1a;
        opacity: 0;
      }
      .desktop-screen video.sr-demo-video-visible { opacity: 1; }
      .desktop-stand {
        margin-top: 10px;
        width: 230px; height: 15px;
        border-radius: 999px;
        background: linear-gradient(180deg, #4b5563 0%, #1f2937 100%);
      }

      /* Feature list */
      .slide-features {
        flex: 1;
        min-width: 200px;
        max-width: 380px;
        align-self: flex-start;
        padding: 14px 8px 0 0;
      }
      .slide-features .logo-wrap {
        display: flex;
        align-items: center;
        gap: 10px;
        color: #a7f3d0;
        font-size: 18px;
        font-weight: 700;
        margin-bottom: 64px;
      }
      .slide-features .logo-wrap img {
        width: 38px; height: 38px;
        border-radius: 10px; display: block;
      }
      .slide-features h3 {
        margin: 0 0 14px 0;
        font-size: 14px;
        font-weight: 700;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        color: rgba(167,243,208,0.72);
      }
      .slide-features ul { margin: 0; padding-left: 1.1em; }
      .slide-features li {
        font-size: 25px;
        line-height: 1.52;
        color: #ecfdf5;
        margin-bottom: 8px;
      }
      .slide-features li::marker { color: #34d399; }

      /* Phone frame */
      .phone-wrap {
        width: ${phone.frameWidth.toFixed(2)}px;
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
      }
      .phone-frame {
        width: ${phone.frameWidth.toFixed(2)}px;
        height: ${phone.frameHeight.toFixed(2)}px;
        border-radius: ${phone.frameRadius.toFixed(2)}px;
        background: linear-gradient(180deg, #475569 0%, #1e293b 100%);
        border: 3px solid rgba(255,255,255,0.1);
        padding: 18px;
        box-shadow: 0 42px 86px rgba(0,0,0,0.58);
      }
      .phone-screen {
        width: 100%; height: 100%;
        border-radius: ${phone.screenRadius.toFixed(2)}px;
        overflow: hidden;
        background: #060d1a;
      }
      .phone-screen video {
        width: 100%; height: 100%;
        object-fit: contain;
        display: block;
        background: #060d1a;
        opacity: 0;
      }
      .phone-screen video.sr-demo-video-visible { opacity: 1; }
    </style>
  </head>
  <body>
    <div class="header">
      <div class="header-text">
        <div class="kicker-wrap">
          <div class="kicker">Prayer Times</div>
          <div class="kicker">app.prayertimes.dev</div>
        </div>
        <div class="title">${escapeHtml(title)}</div>
        <div class="subtitle">${escapeHtml(subtitle)}</div>
      </div>
      <div class="header-brand">
        <img src="${logoDataUri}" alt="Prayer Times" />
        prayertimes.dev
      </div>
    </div>

    <div class="devices">
      <!-- Desktop browser frame -->
      <div class="desktop-wrap">
        <div class="desktop-frame">
          <div class="desktop-screen">
            <video class="desk-v" src="${origin}/desktop.webm" muted playsinline preload="auto"></video>
          </div>
        </div>
        <div class="desktop-stand"></div>
      </div>

      <!-- Feature highlights -->
      <div class="slide-features">
        <div class="logo-wrap">
          <img src="${logoDataUri}" alt="Prayer Times" />
          Prayer Times
        </div>
        <h3>Highlights</h3>
        <ul>${featuresHtml}</ul>
      </div>

      <!-- Phone frame -->
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
        { waitUntil: 'load' },
      );

      await page.waitForTimeout(80);
      await primeEmbeddedDemoVideos(page);
      await padClipToMs(page, clipStart, CLIP_MS);
    },
  );

  const vid = page.video();
  await context.close();
  const tmp = vid ? await vid.path() : null;
  if (!tmp) throw new Error('Playwright did not produce a composite slide recording.');
  await fs.rename(tmp, outputPath);
}

// ── Slide definitions ─────────────────────────────────────────────────────────

type SlideDefinition = {
  key: string;
  title: string;
  subtitle: string;
  features: string[];
  capture: SlideCapture;
};

// ── Test ──────────────────────────────────────────────────────────────────────

test.skip(!!process.env.CI, 'Skip heavy prayertimes demo spec in CI');

test('capture prayertimes.dev demo — desktop + mobile', async ({ browser }) => {
  await fs.mkdir(STILLS_DIR, { recursive: true });
  await fs.mkdir(SLIDES_DIR, { recursive: true });

  const slides: SlideDefinition[] = [
    /* ── Slide 01 — Home / Today's Prayer Times ─────────────────────────── */
    {
      key: '01-home',
      title: "Today's Prayer Times at a Glance",
      subtitle: 'Accurate prayer times for your location, updated in real time.',
      features: [
        'All 5 daily prayers shown clearly',
        'Live countdown to the next prayer',
        'Automatic local time zone support',
      ],
      capture: async (page) => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1500);
        // Highlight the prayer times list
        await pulseHighlight(
          page,
          '[class*="prayer"][class*="row"], [class*="prayer-item"], .prayer-time, [data-prayer], [class*="prayers"]',
        );
        await scrollPage(page);
        // Hover over the countdown if visible
        await pulseHighlight(
          page,
          '[class*="countdown"], [class*="next-prayer"], [aria-label*="next prayer" i], [class*="timer"]',
        );
        await page.waitForTimeout(500);
      },
    },

    /* ── Slide 02 — Built-in Product Tour ───────────────────────────────── */
    {
      key: '02-product-tour',
      title: 'Built-in Product Tour',
      subtitle: 'A guided walkthrough shows every key feature in under a minute.',
      features: [
        'Step-by-step in-app introduction',
        'Highlights navigation and core features',
        'Accessible any time from the help menu',
      ],
      capture: async (page) => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1200);
        // Attempt to trigger the tour
        await tryStartTour(page);
        await page.waitForTimeout(700);
        // Advance through tour steps to show them in the recording
        for (let i = 0; i < 5; i++) {
          await tryAdvanceTour(page);
          await page.waitForTimeout(480);
        }
        // Fallback: scroll through the home screen if no tour was found
        await scrollPage(page);
      },
    },

    /* ── Slide 03 — Location & City Search ──────────────────────────────── */
    {
      key: '03-location',
      title: 'Search Any City in the World',
      subtitle: 'Change your location instantly and get accurate times right away.',
      features: [
        'Search by city name or use GPS',
        'Covers thousands of cities worldwide',
        'Instant time zone adjustment',
      ],
      capture: async (page) => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1200);
        // Try to open the location panel
        const opened = await tryOpenLocationSearch(page);
        if (opened) {
          await page.waitForTimeout(500);
          // Type a city name in the search field if one appears
          try {
            const input = page
              .locator('input[type="search"], input[placeholder*="city" i], input[placeholder*="location" i], input[placeholder*="search" i]')
              .first();
            if (await input.isVisible({ timeout: 2000 })) {
              await input.click();
              await page.waitForTimeout(200);
              await input.type('London', { delay: 80 });
              await page.waitForTimeout(900);
              // Highlight first result if present
              await pulseHighlight(page, '[class*="result"], [class*="suggestion"], li[role="option"]');
            }
          } catch {
            /* search input not present */
          }
        } else {
          // Fallback: pulse the current location indicator
          await pulseHighlight(
            page,
            '[class*="location"], [class*="city"], [aria-label*="location" i], [class*="place-name"]',
          );
          await scrollPage(page);
        }
        await page.waitForTimeout(600);
      },
    },

    /* ── Slide 04 — Monthly Prayer Calendar ─────────────────────────────── */
    {
      key: '04-calendar',
      title: 'Monthly Prayer Calendar',
      subtitle: "Plan ahead with the full month's prayer times at a glance.",
      features: [
        'Complete monthly prayer schedule',
        'Easy month-by-month navigation',
        'Compact, print-friendly layout',
      ],
      capture: async (page) => {
        await navigateToSection(
          page,
          ['/calendar', '/monthly', '/month'],
          ['Calendar', 'Monthly', 'Month', 'Schedule'],
        );
        await pulseHighlight(page, 'table, [class*="calendar"], [class*="monthly"], [class*="month-view"]');
        await scrollPage(page);
        // Highlight navigation arrows
        await pulseHighlight(
          page,
          'button[aria-label*="next" i], button[aria-label*="previous" i], [class*="month-nav"], [class*="prev-btn"], [class*="next-btn"]',
        );
        await page.waitForTimeout(500);
      },
    },

    /* ── Slide 05 — Calculation Settings ────────────────────────────────── */
    {
      key: '05-settings',
      title: 'Flexible Calculation Settings',
      subtitle: 'Choose from 15+ calculation methods and your preferred school of thought.',
      features: [
        'ISNA, MWL, Egypt, Makkah & more',
        'Hanafi and Shafi\u02bbi Asr methods',
        'Hijri date display option',
      ],
      capture: async (page) => {
        await navigateToSection(
          page,
          ['/settings', '/preferences', '/options', '/config'],
          ['Settings', 'Preferences', 'Options'],
        );
        // Highlight the calculation method selector
        await pulseHighlight(
          page,
          'select, [class*="method"], [class*="calculation"], [aria-label*="method" i], [class*="calc-method"]',
        );
        await scrollPage(page);
        // Highlight the madhab / Asr setting
        await pulseHighlight(
          page,
          '[class*="madhab"], [class*="asr"], [aria-label*="asr" i], [class*="school"]',
        );
        await page.waitForTimeout(500);
      },
    },

    /* ── Slide 06 — Qibla Compass ────────────────────────────────────────── */
    {
      key: '06-qibla',
      title: 'Qibla Compass Direction',
      subtitle: 'Find the direction of the Kaaba from anywhere in the world.',
      features: [
        'Animated compass pointer',
        'Precise great-circle bearing',
        'Works offline with stored location',
      ],
      capture: async (page) => {
        await navigateToSection(
          page,
          ['/qibla', '/compass', '/direction', '/kibla', '/kaaba'],
          ['Qibla', 'Compass', 'Direction', 'Kibla'],
        );
        // Pulse the compass element
        await pulseHighlight(page, '[class*="compass"], [class*="qibla"], canvas, svg[class*="compass"], [class*="direction"]');
        await scrollPage(page);
        await page.waitForTimeout(900);
      },
    },
  ];

  // ── Capture + render each slide ───────────────────────────────────────────

  const slidePaths: string[] = [];

  for (const slide of slides) {
    const desktopPath = path.join(STILLS_DIR, `${slide.key}-desktop.webm`);
    const mobilePath = path.join(STILLS_DIR, `${slide.key}-mobile.webm`);
    const compositePath = path.join(SLIDES_DIR, `${slide.key}.webm`);

    await captureDesktopClip(browser, slide.capture, desktopPath);
    await captureMobileClip(browser, slide.capture, mobilePath);
    await renderCompositeSlide(
      browser,
      slide.title,
      slide.subtitle,
      slide.features,
      desktopPath,
      mobilePath,
      compositePath,
    );

    slidePaths.push(compositePath);
    console.log(`  ✓ ${path.basename(compositePath)}`);
  }

  // ── Write ffmpeg concat manifest ──────────────────────────────────────────

  const manifestLines: string[] = [];
  for (const p of slidePaths) {
    manifestLines.push(`file '${p.split(path.sep).join('/')}'`);
    manifestLines.push(`duration ${SLIDE_DURATION_SECONDS}`);
  }
  // Repeat last file without duration (ffmpeg concat quirk)
  manifestLines.push(`file '${slidePaths[slidePaths.length - 1].split(path.sep).join('/')}'`);
  await fs.writeFile(MANIFEST_PATH, `${manifestLines.join('\n')}\n`, 'utf8');

  console.log(`\nManifest written → ${MANIFEST_PATH}`);
  console.log(`  Clips: ${slidePaths.length}`);
  console.log(`  Run "npm run prayertimes:demo:render" to produce the final MP4.\n`);
});
