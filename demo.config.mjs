/**
 * demo.config.mjs
 *
 * Central configuration for the demo video pipeline.
 * Edit this file to customise durations, output paths, and audio.
 *
 * All paths are relative to the repository root.
 */

/** @type {import('./scripts/render-video.mjs').DemoConfig} */
const config = {
  // ── Capture ──────────────────────────────────────────────────
  /** Directory where Playwright writes per-slide WebM clips */
  slidesDir: 'demo/slides',

  /** ffmpeg concat-demuxer manifest listing slide videos (file '…' per line) */
  manifestPath: 'demo/manifest.txt',

  // ── Render ───────────────────────────────────────────────────
  /** Final MP4 output path */
  outputPath: 'demo/output/demo.mp4',

  /** Video frame rate */
  fps: 30,

  /** H.264 CRF quality (18 = near-lossless, 28 = smaller file) */
  crf: 22,

  // ── Optional audio ───────────────────────────────────────────
  /**
   * Path to a background music MP3 file (relative to repo root).
   * Set to null (or remove the key) if you have no audio.
   *
   * IMPORTANT: Only use royalty-free / CC0 audio.
   * A suitable placeholder can be downloaded from:
   *   https://pixabay.com/music/  (free for commercial use)
   * or generated with  `ffmpeg -f lavfi -i "sine=frequency=440:duration=30" audio/placeholder.mp3`
   */
  audioPath: null, // e.g. 'audio/background.mp3'

  /**
   * Duration (seconds) of the fade-out at the end of the audio track.
   * Set to 0 to disable.
   */
  audioFadeDuration: 2,

  // ── Branding (ffmpeg drawtext + optional logo overlay) ─────────
  branding: {
    /** PNG in repo (AppFlow palette); replace with your own asset if you like */
    logoPath: 'demo/branding/logo.png',
    title: 'AppFlow Demo',
    tagline: 'E2E capture • fixture-driven profile • Playwright + ffmpeg',
    /** Optional: absolute or repo-relative TTF if the OS default is missing */
    fontFile: null,
  },
};

export default config;
