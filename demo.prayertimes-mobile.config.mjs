/**
 * demo.prayertimes-mobile.config.mjs
 *
 * Render configuration for the prayertimes.dev mobile-only vertical reel.
 * Output: demo/output/prayertimes-reel.mp4 (1080 × 1920 — 9:16 portrait)
 *
 * Usage:
 *   node scripts/render-video.mjs --config demo.prayertimes-mobile.config.mjs
 * Or:
 *   npm run prayertimes:reel:render
 */

/** @type {import('./scripts/render-video.mjs').DemoConfig} */
const config = {
  // ── Capture ──────────────────────────────────────────────────────────────
  /** Directory where Playwright writes per-slide WebM clips */
  slidesDir: 'demo/.tmp-prayertimes-mobile/slides',

  /** ffmpeg concat-demuxer manifest (written by prayertimes-demo-mobile.spec.ts) */
  manifestPath: 'demo/.tmp-prayertimes-mobile/slides/manifest.txt',

  // ── Render ───────────────────────────────────────────────────────────────
  /** Final MP4 output path — portrait 9:16 */
  outputPath: 'demo/output/prayertimes-reel.mp4',

  /** Video frame rate */
  fps: 30,

  /** H.264 CRF quality (18 = near-lossless, 28 = smaller file) */
  crf: 22,

  // ── Audio ─────────────────────────────────────────────────────────────────
  audioPath: 'demo/branding/soundtrack.mp3',
  audioFadeDuration: 2,

  // ── Branding ──────────────────────────────────────────────────────────────
  branding: {
    title: 'prayertimes.dev',
    tagline: 'Accurate prayer times · Qibla compass · Monthly calendar',
    fontFile: null,
  },
};

export default config;
