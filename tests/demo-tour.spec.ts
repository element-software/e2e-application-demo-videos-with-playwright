/**
 * demo-tour.spec.ts
 *
 * Scripted walk-through of the AppFlow demo app.
 *
 * For every "slide" this test:
 *  1. Navigates to a page / triggers a UI state
 *  2. Waits for the content to settle
 *  3. Saves a PNG screenshot to demo/slides/
 *  4. Records the file path + display duration for the ffmpeg manifest
 *
 * After all slides are captured, the test writes demo/manifest.txt using
 * the ffmpeg concat-demuxer format (with the quirk-required trailing file
 * entry so the last slide holds its duration).
 */

import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// ── Config ────────────────────────────────────────────────────────────────────

/** Absolute path to the repository root (two levels up from tests/) */
const REPO_ROOT = path.resolve(__dirname, '..');

/** Where screenshots are saved */
const SLIDES_DIR = path.join(REPO_ROOT, 'demo', 'slides');

/** ffmpeg concat manifest output path */
const MANIFEST_PATH = path.join(REPO_ROOT, 'demo', 'manifest.txt');

// ── Types ─────────────────────────────────────────────────────────────────────

interface Slide {
  /** Absolute path to the PNG file */
  file: string;
  /** How many seconds this slide should be displayed in the final video */
  duration: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * writeManifest writes a concat-demuxer manifest file that ffmpeg can read
 * with  -f concat -safe 0 -i manifest.txt
 *
 * The format is:
 *   file '/abs/path/to/slide.png'
 *   duration 3
 *   ...
 *   file '/abs/path/to/last-slide.png'   ← repeated without duration (ffmpeg quirk)
 *
 * Without the trailing repetition of the last entry, ffmpeg trims the final
 * frame to zero length and the last slide disappears from the output video.
 */
function writeManifest(slides: Slide[], manifestPath: string): void {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });

  const lines: string[] = [];
  for (const slide of slides) {
    // Use forward slashes on all platforms for ffmpeg compat
    const posixPath = slide.file.split(path.sep).join('/');
    lines.push(`file '${posixPath}'`);
    lines.push(`duration ${slide.duration}`);
  }

  // ffmpeg concat quirk: repeat the last file entry without a duration
  if (slides.length > 0) {
    const lastPosix = slides[slides.length - 1].file.split(path.sep).join('/');
    lines.push(`file '${lastPosix}'`);
  }

  fs.writeFileSync(manifestPath, lines.join('\n') + '\n');

  const total = slides.reduce((sum, s) => sum + s.duration, 0);
  console.log(
    `\nManifest written → ${manifestPath}` +
      `\n  Slides : ${slides.length}` +
      `\n  Total  : ${total}s\n`
  );
}

// ── Test ──────────────────────────────────────────────────────────────────────

test('capture AppFlow demo tour', async ({ page }) => {
  // Ensure the output directory exists before we start writing files
  fs.mkdirSync(SLIDES_DIR, { recursive: true });

  const slides: Slide[] = [];

  /**
   * Helper: run `action`, wait for the page to settle, take a screenshot,
   * then record the slide.
   *
   * @param name      Filename stem (no extension) — used for the PNG name
   * @param duration  Seconds this slide should occupy in the final video
   * @param action    Async function that brings the desired UI state into view
   */
  async function captureSlide(
    name: string,
    duration: number,
    action: () => Promise<void>
  ): Promise<void> {
    await action();

    // Allow CSS transitions / data fetches to settle
    await page.waitForLoadState('networkidle');

    const filePath = path.join(SLIDES_DIR, `${name}.png`);
    await page.screenshot({ path: filePath, fullPage: false });

    slides.push({ file: filePath, duration });
    console.log(`  ✓ ${name}.png  (${duration}s)`);
  }

  // ── Slide 1 · Home / Hero ─────────────────────────────────────────────────
  await captureSlide('01-home', 3, async () => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="page-home"]');
  });

  // ── Slide 2 · Features ───────────────────────────────────────────────────
  await captureSlide('02-features', 4, async () => {
    await page.click('a[href="/features"]');
    await page.waitForSelector('[data-testid="page-features"]');
  });

  // ── Slide 3 · Dashboard ───────────────────────────────────────────────────
  await captureSlide('03-dashboard', 4, async () => {
    await page.click('a[href="/dashboard"]');
    await page.waitForSelector('[data-testid="page-dashboard"]');
  });

  // ── Slide 4 · Get Started (empty form) ────────────────────────────────────
  await captureSlide('04-get-started', 3, async () => {
    await page.click('a[href="/get-started"]');
    await page.waitForSelector('[data-testid="page-get-started"]');
  });

  // ── Slide 5 · Get Started (filled-in form) ────────────────────────────────
  await captureSlide('05-signup-filled', 3, async () => {
    await page.fill('[data-testid="input-name"]', 'Jane Smith');
    await page.fill('[data-testid="input-email"]', 'jane@company.com');
    await page.fill('[data-testid="input-password"]', 'super-secret-pw');
  });

  // ── Slide 6 · Success banner ──────────────────────────────────────────────
  await captureSlide('06-signup-success', 3, async () => {
    await page.click('[data-testid="btn-submit"]');
    await page.waitForSelector('[data-testid="success-banner"]');
  });

  // ── Write manifest ────────────────────────────────────────────────────────
  writeManifest(slides, MANIFEST_PATH);
});
