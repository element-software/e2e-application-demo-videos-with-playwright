/**
 * prayertimes-demo-mobile.spec.ts
 *
 * Mobile-only vertical reel for https://app.prayertimes.dev
 * Output: demo/output/prayertimes-reel.mp4  (1080 × 1920 — portrait/9:16)
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
 *   1. Captures a mobile clip at 480 × 960 (9:20 — matches DEMO_MOBILE_VIEWPORT)
 *   2. Renders it inside a branded 1080 × 1920 phone-frame composite
 *
 * After all slides, writes a concat manifest for
 * `npm run prayertimes:reel:render` (→ demo/output/prayertimes-reel.mp4).
 */

import { test, devices, type Browser, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  DEMO_MOBILE_VIEWPORT,
  getDemoInteractionOverlayScript,
  recordVideoForViewport,
  padClipToMs,
  withLocalClipServer,
  primeEmbeddedDemoVideos,
  overrideChromiumCaptureBackground,
} from './support/demoVideo';

// ── Paths & timing ────────────────────────────────────────────────────────────

const DEMO_TMP_DIR = path.join(process.cwd(), 'demo', '.tmp-prayertimes-mobile');
const STILLS_DIR = path.join(DEMO_TMP_DIR, 'stills');
const SLIDES_DIR = path.join(DEMO_TMP_DIR, 'slides');
const MANIFEST_PATH = path.join(SLIDES_DIR, 'manifest.txt');

const SLIDE_DURATION_SECONDS = 7.5;
const CLIP_MS = Math.round(SLIDE_DURATION_SECONDS * 1000);

// Reel canvas dimensions (1080 × 1920 portrait)
const REEL_W = 1080;
const REEL_H = 1920;

// Phone frame dimensions in the reel — derived to keep native aspect
const PHONE_FRAME_W = 540;
const PHONE_FRAME_H = Math.round(PHONE_FRAME_W * (DEMO_MOBILE_VIEWPORT.height / DEMO_MOBILE_VIEWPORT.width));
const PHONE_BORDER = 24;
const PHONE_RADIUS = 56;

// ── Branding ──────────────────────────────────────────────────────────────────

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

// ── Interaction helpers (mirrors desktop spec, kept local for readability) ────

async function scrollPage(page: Page): Promise<void> {
  await page.waitForTimeout(350);
  await page.mouse.move(DEMO_MOBILE_VIEWPORT.width / 2, DEMO_MOBILE_VIEWPORT.height * 0.45, { steps: 14 });
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
    /* skip */
  }
}

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
    } catch { /* try next */ }
  }
  return false;
}

async function tryStartTour(page: Page): Promise<void> {
  await tryClick(
    page,
    '[aria-label*="tour" i]', '[aria-label*="guide" i]', '[aria-label*="help" i]',
    'button:has-text("Tour")', 'button:has-text("Start tour")', 'button:has-text("Take a tour")',
    'button:has-text("Help")', 'button:has-text("?")',
    '[class*="tour-btn"]', '[class*="help-btn"]', '[class*="walkthrough"]',
    '[data-tour-start]', '[data-action="start-tour"]', '.help-icon',
  );
}

async function tryAdvanceTour(page: Page): Promise<void> {
  await tryClick(
    page,
    '.shepherd-button-primary', '.shepherd-button:last-child',
    '[data-driver-action="next"]', '.driver-navigation-btns button:last-child',
    '[data-action="next-step"]',
    'button:has-text("Next")', 'button:has-text("Got it")',
    'button:has-text("Continue")', 'button:has-text("OK")',
    '.introjs-nextbutton', '.joyride-button--primary',
    '[class*="tour-next"]', '[class*="next-btn"]', '[aria-label="Next step"]',
  );
}

async function tryOpenLocationSearch(page: Page): Promise<boolean> {
  return tryClick(
    page,
    '[aria-label*="location" i]', '[aria-label*="city" i]', '[aria-label*="change location" i]',
    '[class*="location-btn"]', '[class*="city-picker"]', '[class*="location-selector"]',
    '[class*="location-name"]', '[data-action="change-location"]',
    'button:has-text("Change location")', 'button:has-text("Search city")', '.location-button',
  );
}

async function navigateToSection(page: Page, paths: string[], linkTexts: string[]): Promise<void> {
  for (const p of paths) {
    try {
      await page.goto(p, { waitUntil: 'domcontentloaded', timeout: 10_000 });
      await page.waitForTimeout(900);
      return;
    } catch { /* try next */ }
  }
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(500);
  for (const text of linkTexts) {
    try {
      const link = page.getByRole('link', { name: new RegExp(text, 'i') }).first();
      if (await link.isVisible({ timeout: 2000 })) {
        await link.click(); await page.waitForTimeout(800); return;
      }
    } catch { /* try next */ }
  }
  for (const text of linkTexts) {
    try {
      const btn = page.getByRole('button', { name: new RegExp(text, 'i') }).first();
      if (await btn.isVisible({ timeout: 1500 })) {
        await btn.click(); await page.waitForTimeout(800); return;
      }
    } catch { /* try next */ }
  }
}

// ── Capture helpers ───────────────────────────────────────────────────────────

type SlideCapture = (page: Page) => Promise<void>;

async function captureMobileScreenVideo(
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

// ── Reel slide renderer ───────────────────────────────────────────────────────

const PHONE_INNER_W = PHONE_FRAME_W - PHONE_BORDER * 2;
const PHONE_INNER_H = PHONE_FRAME_H - PHONE_BORDER * 2;

// Top-area heights for the text block above the phone frame
const TEXT_TOP = 220;
const PHONE_TOP = 540;

async function renderMobileReelSlide(
  browser: Browser,
  title: string,
  subtitle: string,
  features: string[],
  mobileWebmPath: string,
  outputPath: string,
): Promise<void> {
  const logoDataUri = getPrayerTimesLogoDataUri();
  const featuresHtml = features.map((f) => `<li>${escapeHtml(f)}</li>`).join('');

  const slideDir = path.dirname(outputPath);
  await fs.mkdir(slideDir, { recursive: true });

  const context = await browser.newContext({
    viewport: { width: REEL_W, height: REEL_H },
    ...recordVideoForViewport(slideDir, { width: REEL_W, height: REEL_H }),
  });
  const page = await context.newPage();
  await overrideChromiumCaptureBackground(page);

  await withLocalClipServer(
    { '/mobile.webm': mobileWebmPath },
    async (origin) => {
      const clipStart = Date.now();

      const phoneLeft = Math.round((REEL_W - PHONE_FRAME_W) / 2);

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
        width: ${REEL_W}px;
        height: ${REEL_H}px;
        background:
          radial-gradient(circle at 28% 16%, #064e3b 0%, rgba(6,78,59,0.24) 28%, transparent 50%),
          radial-gradient(circle at 72% 80%, #0e7490 0%, rgba(14,116,144,0.2) 26%, transparent 48%),
          linear-gradient(160deg, #060d1a 0%, #0a1f2e 45%, #0c1b2a 100%);
        color: #f0fdf4;
        font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        overflow: hidden;
      }

      /* ── Brand logo ────────────────────────────────── */
      .brand {
        position: absolute;
        left: ${phoneLeft}px;
        top: 72px;
        display: flex;
        align-items: center;
        gap: 18px;
        font-size: 30px;
        font-weight: 800;
        color: #a7f3d0;
        letter-spacing: 0.02em;
      }
      .brand img {
        width: 54px; height: 54px;
        border-radius: 14px;
        display: block;
      }

      /* ── Text block above phone ────────────────────── */
      .text-block {
        position: absolute;
        left: ${phoneLeft}px;
        right: ${REEL_W - phoneLeft - PHONE_FRAME_W}px;
        top: ${TEXT_TOP}px;
      }
      .kicker {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        padding: 12px 24px;
        font-size: 22px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        font-weight: 700;
        background: rgba(6,78,59,0.32);
        border: 1px solid rgba(52,211,153,0.45);
        color: #a7f3d0;
        margin-bottom: 24px;
      }
      .title {
        font-size: 58px;
        line-height: 1.08;
        font-weight: 800;
        color: #ecfdf5;
        margin: 0 0 18px;
      }
      .subtitle {
        font-size: 32px;
        color: #a7f3d0;
        font-weight: 500;
        line-height: 1.4;
        margin: 0;
      }

      /* ── Phone frame ───────────────────────────────── */
      .phone-frame {
        position: absolute;
        left: ${phoneLeft}px;
        top: ${PHONE_TOP}px;
        width: ${PHONE_FRAME_W}px;
        height: ${PHONE_FRAME_H}px;
        border-radius: ${PHONE_RADIUS}px;
        background: linear-gradient(180deg, #475569 0%, #1e293b 100%);
        border: 3px solid rgba(255,255,255,0.12);
        padding: ${PHONE_BORDER}px;
        box-shadow: 0 56px 120px rgba(0,0,0,0.68);
      }
      .phone-screen {
        width: ${PHONE_INNER_W}px;
        height: ${PHONE_INNER_H}px;
        border-radius: ${Math.round(PHONE_RADIUS * 0.72)}px;
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

      /* ── Feature list below phone ──────────────────── */
      .features {
        position: absolute;
        left: ${phoneLeft}px;
        right: ${REEL_W - phoneLeft - PHONE_FRAME_W}px;
        top: ${PHONE_TOP + PHONE_FRAME_H + 52}px;
      }
      .features h3 {
        margin: 0 0 20px 0;
        font-size: 22px;
        font-weight: 700;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        color: rgba(167,243,208,0.7);
      }
      .features ul {
        margin: 0;
        padding-left: 1.4em;
      }
      .features li {
        font-size: 36px;
        line-height: 1.55;
        color: #ecfdf5;
        margin-bottom: 8px;
      }
      .features li::marker { color: #34d399; }
    </style>
  </head>
  <body>
    <!-- Brand -->
    <div class="brand">
      <img src="${logoDataUri}" alt="Prayer Times" />
      prayertimes.dev
    </div>

    <!-- Text -->
    <div class="text-block">
      <div class="kicker">Prayer Times</div>
      <p class="title">${escapeHtml(title)}</p>
      <p class="subtitle">${escapeHtml(subtitle)}</p>
    </div>

    <!-- Phone -->
    <div class="phone-frame">
      <div class="phone-screen">
        <video class="screen-video" src="${origin}/mobile.webm" muted playsinline preload="auto"></video>
      </div>
    </div>

    <!-- Feature bullets -->
    <div class="features">
      <h3>Highlights</h3>
      <ul>${featuresHtml}</ul>
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
  if (!tmp) throw new Error('Playwright did not produce a mobile reel slide recording.');
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

test.skip(!!process.env.CI, 'Skip heavy prayertimes reel spec in CI');

test('capture prayertimes.dev demo — mobile reel', async ({ browser }) => {
  await fs.mkdir(STILLS_DIR, { recursive: true });
  await fs.mkdir(SLIDES_DIR, { recursive: true });

  const slides: SlideDefinition[] = [
    /* 01 — Home */
    {
      key: '01-home',
      title: "Today's Prayer Times",
      subtitle: 'Accurate times for your location, updated in real time.',
      features: ['All 5 daily prayers at a glance', 'Live countdown to next prayer', 'Automatic time zone support'],
      capture: async (page) => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1500);
        await pulseHighlight(page, '[class*="prayer"][class*="row"], [class*="prayer-item"], .prayer-time, [data-prayer], [class*="prayers"]');
        await scrollPage(page);
        await pulseHighlight(page, '[class*="countdown"], [class*="next-prayer"], [aria-label*="next prayer" i], [class*="timer"]');
        await page.waitForTimeout(500);
      },
    },

    /* 02 — Tour */
    {
      key: '02-product-tour',
      title: 'Built-in Product Tour',
      subtitle: 'A guided walkthrough shows every feature in under a minute.',
      features: ['Step-by-step in-app introduction', 'Highlights core features', 'Available any time from help menu'],
      capture: async (page) => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1200);
        await tryStartTour(page);
        await page.waitForTimeout(700);
        for (let i = 0; i < 5; i++) {
          await tryAdvanceTour(page);
          await page.waitForTimeout(480);
        }
        await scrollPage(page);
      },
    },

    /* 03 — Location */
    {
      key: '03-location',
      title: 'Search Any City',
      subtitle: 'Change location instantly and get accurate times right away.',
      features: ['Search by city name or use GPS', 'Thousands of cities worldwide', 'Instant time zone adjustment'],
      capture: async (page) => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1200);
        const opened = await tryOpenLocationSearch(page);
        if (opened) {
          await page.waitForTimeout(500);
          try {
            const input = page.locator('input[type="search"], input[placeholder*="city" i], input[placeholder*="location" i], input[placeholder*="search" i]').first();
            if (await input.isVisible({ timeout: 2000 })) {
              await input.click();
              await page.waitForTimeout(200);
              await input.type('London', { delay: 80 });
              await page.waitForTimeout(900);
              await pulseHighlight(page, '[class*="result"], [class*="suggestion"], li[role="option"]');
            }
          } catch { /* skip */ }
        } else {
          await pulseHighlight(page, '[class*="location"], [class*="city"], [aria-label*="location" i], [class*="place-name"]');
          await scrollPage(page);
        }
        await page.waitForTimeout(600);
      },
    },

    /* 04 — Calendar */
    {
      key: '04-calendar',
      title: 'Monthly Prayer Calendar',
      subtitle: "Plan ahead with the full month's prayer schedule.",
      features: ['Complete monthly prayer schedule', 'Easy month-by-month navigation', 'Compact, print-friendly layout'],
      capture: async (page) => {
        await navigateToSection(page, ['/calendar', '/monthly', '/month'], ['Calendar', 'Monthly', 'Month', 'Schedule']);
        await pulseHighlight(page, 'table, [class*="calendar"], [class*="monthly"], [class*="month-view"]');
        await scrollPage(page);
        await pulseHighlight(page, 'button[aria-label*="next" i], button[aria-label*="previous" i], [class*="month-nav"], [class*="prev-btn"], [class*="next-btn"]');
        await page.waitForTimeout(500);
      },
    },

    /* 05 — Settings */
    {
      key: '05-settings',
      title: 'Flexible Calculation Settings',
      subtitle: 'Choose from 15+ methods and your preferred school of thought.',
      features: ['ISNA, MWL, Egypt, Makkah & more', 'Hanafi and Shafi\u02bbi Asr methods', 'Hijri date display option'],
      capture: async (page) => {
        await navigateToSection(page, ['/settings', '/preferences', '/options', '/config'], ['Settings', 'Preferences', 'Options']);
        await pulseHighlight(page, 'select, [class*="method"], [class*="calculation"], [aria-label*="method" i], [class*="calc-method"]');
        await scrollPage(page);
        await pulseHighlight(page, '[class*="madhab"], [class*="asr"], [aria-label*="asr" i], [class*="school"]');
        await page.waitForTimeout(500);
      },
    },

    /* 06 — Qibla */
    {
      key: '06-qibla',
      title: 'Qibla Compass Direction',
      subtitle: 'Find the direction of the Kaaba from anywhere in the world.',
      features: ['Animated compass pointer', 'Precise great-circle bearing', 'Works offline with stored location'],
      capture: async (page) => {
        await navigateToSection(page, ['/qibla', '/compass', '/direction', '/kibla', '/kaaba'], ['Qibla', 'Compass', 'Direction', 'Kibla']);
        await pulseHighlight(page, '[class*="compass"], [class*="qibla"], canvas, svg[class*="compass"], [class*="direction"]');
        await scrollPage(page);
        await page.waitForTimeout(900);
      },
    },
  ];

  // ── Capture + render each slide ───────────────────────────────────────────

  const slidePaths: string[] = [];

  for (const slide of slides) {
    const mobilePath = path.join(STILLS_DIR, `${slide.key}-mobile.webm`);
    const compositePath = path.join(SLIDES_DIR, `${slide.key}.webm`);

    await captureMobileScreenVideo(browser, slide.capture, mobilePath);
    await renderMobileReelSlide(
      browser,
      slide.title,
      slide.subtitle,
      slide.features,
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
  manifestLines.push(`file '${slidePaths[slidePaths.length - 1].split(path.sep).join('/')}'`);
  await fs.writeFile(MANIFEST_PATH, `${manifestLines.join('\n')}\n`, 'utf8');

  console.log(`\nManifest written → ${MANIFEST_PATH}`);
  console.log(`  Clips: ${slidePaths.length}`);
  console.log(`  Run "npm run prayertimes:reel:render" to produce the final MP4.\n`);
});
