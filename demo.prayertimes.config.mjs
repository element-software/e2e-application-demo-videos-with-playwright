/**
 * demo.prayertimes.config.mjs
 *
 * Render configuration for the prayertimes.dev demo video.
 * Desktop + mobile composite output: demo/output/prayertimes-demo.mp4 (1920 × 1080)
 *
 * Usage:
 *   node scripts/render-video.mjs --config demo.prayertimes.config.mjs
 * Or:
 *   npm run prayertimes:demo:render
 */

/** @type {import('./scripts/render-video.mjs').DemoConfig} */
const config = {
  // ── Capture ──────────────────────────────────────────────────────────────
  /** Directory where Playwright writes per-slide WebM clips */
  slidesDir: 'demo/.tmp-prayertimes/slides',

  /** ffmpeg concat-demuxer manifest (written by prayertimes-demo.spec.ts) */
  manifestPath: 'demo/.tmp-prayertimes/slides/manifest.txt',

  // ── Render ───────────────────────────────────────────────────────────────
  /** Final MP4 output path */
  outputPath: 'demo/output/prayertimes-demo.mp4',

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
