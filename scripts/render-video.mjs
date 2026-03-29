#!/usr/bin/env node
/**
 * scripts/render-video.mjs
 *
 * Reads demo/manifest.txt (written by the Playwright capture step), calculates
 * the total video duration, then invokes ffmpeg to produce a polished MP4.
 *
 * Usage:
 *   node scripts/render-video.mjs [--config path/to/demo.config.mjs]
 *
 * Dependencies: none beyond Node 18+ built-ins.
 * External requirement: `ffmpeg` must be on PATH.
 *
 * @typedef {Object} DemoConfig
 * @property {string}       slidesDir         - Dir where PNGs live
 * @property {string}       manifestPath      - ffmpeg concat manifest
 * @property {string}       outputPath        - MP4 output path
 * @property {number}       [fps]             - Frame rate (default 30)
 * @property {number}       [crf]             - H.264 CRF quality (default 22)
 * @property {string|null}  [audioPath]       - Background music MP3 (optional)
 * @property {number}       [audioFadeDuration] - Fade-out seconds (default 2)
 */

import { execFileSync, spawnSync } from 'child_process';
import { existsSync, readFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { parseArgs } from 'util';

// ── Resolve paths relative to the repo root ───────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// ── CLI flags ─────────────────────────────────────────────────────────────────

const { values: flags } = parseArgs({
  args: process.argv.slice(2),
  options: {
    config: { type: 'string', default: 'demo.config.mjs' },
  },
  strict: false,
});

// ── Load config ───────────────────────────────────────────────────────────────

const configPath = resolve(REPO_ROOT, /** @type {string} */ (flags.config));

if (!existsSync(configPath)) {
  console.error(`[render-video] Config not found: ${configPath}`);
  process.exit(1);
}

/** @type {DemoConfig} */
const config = (await import(configPath)).default;

const manifestPath = resolve(REPO_ROOT, config.manifestPath ?? 'demo/manifest.txt');
const outputPath = resolve(REPO_ROOT, config.outputPath ?? 'demo/output/demo.mp4');
const fps = config.fps ?? 30;
const crf = config.crf ?? 22;
const audioPath = config.audioPath ? resolve(REPO_ROOT, config.audioPath) : null;
const fadeDur = config.audioFadeDuration ?? 2;

// ── Validate prerequisites ────────────────────────────────────────────────────

if (!existsSync(manifestPath)) {
  console.error(
    `[render-video] Manifest not found: ${manifestPath}\n` +
    `  Run "npm run demo:video:capture" first.`
  );
  process.exit(1);
}

// Check that ffmpeg is available
const ffmpegCheck = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
if (ffmpegCheck.error) {
  console.error(
    '[render-video] ffmpeg not found on PATH.\n' +
    '  macOS  : brew install ffmpeg\n' +
    '  Ubuntu : sudo apt-get install -y ffmpeg\n' +
    '  Windows: https://ffmpeg.org/download.html'
  );
  process.exit(1);
}

if (audioPath && !existsSync(audioPath)) {
  console.error(
    `[render-video] Audio file not found: ${audioPath}\n` +
    `  Set audioPath: null in demo.config.mjs to skip audio, or provide a valid path.`
  );
  process.exit(1);
}

// ── Parse manifest for total duration ────────────────────────────────────────

const manifestText = readFileSync(manifestPath, 'utf8');
const durationMatches = [...manifestText.matchAll(/^duration\s+([\d.]+)/gm)];

if (durationMatches.length === 0) {
  console.error(
    `[render-video] No "duration" entries found in ${manifestPath}.\n` +
    `  Make sure the capture step completed successfully.`
  );
  process.exit(1);
}

const totalDuration = durationMatches.reduce(
  (sum, m) => sum + parseFloat(m[1]),
  0
);

console.log(`[render-video] Total video duration: ${totalDuration}s`);
console.log(`[render-video] Output: ${outputPath}`);

// ── Ensure output directory exists ───────────────────────────────────────────

mkdirSync(dirname(outputPath), { recursive: true });

// ── Build ffmpeg argument list ────────────────────────────────────────────────

const args = [
  // Input 0: image sequence via concat demuxer
  '-f', 'concat',
  '-safe', '0',
  '-i', manifestPath,
];

// Input 1 (optional): background audio
if (audioPath) {
  args.push('-i', audioPath);
}

// Video filter: normalise fps and pixel format for maximum compatibility
args.push('-vf', `fps=${fps},format=yuv420p`);

// Audio filters (only when audio is present)
if (audioPath) {
  const fadeStart = Math.max(0, totalDuration - fadeDur);
  // atrim   – cut the audio to exactly match the video length
  // afade   – smooth fade-out over the last N seconds
  const audioFilter = [
    `atrim=0:${totalDuration}`,
    fadeDur > 0 ? `afade=t=out:st=${fadeStart}:d=${fadeDur}` : null,
  ]
    .filter(Boolean)
    .join(',');

  args.push('-af', audioFilter);
  args.push('-c:a', 'aac', '-b:a', '192k');
  // -shortest stops encoding when the shorter stream (video) ends
  args.push('-shortest');
}

// Video codec
args.push(
  '-c:v', 'libx264',
  '-crf', String(crf),
  '-preset', 'medium',
  // Enable fast web start (moov atom at the front of the file)
  '-movflags', '+faststart',
);

// Overwrite output without prompting
args.push('-y', outputPath);

// ── Invoke ffmpeg ─────────────────────────────────────────────────────────────

console.log(`\n[render-video] Running: ffmpeg ${args.join(' ')}\n`);

try {
  execFileSync('ffmpeg', args, { stdio: 'inherit' });
  console.log(`\n[render-video] ✓ Done! Video saved to: ${outputPath}`);
} catch (err) {
  console.error('\n[render-video] ✗ ffmpeg exited with an error (see output above).');
  process.exit(1);
}
