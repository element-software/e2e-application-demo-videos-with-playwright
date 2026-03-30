#!/usr/bin/env node
/**
 * scripts/render-video.mjs
 *
 * Reads demo/manifest.txt (written by the Playwright capture step), concatenates
 * slide WebM clips with ffmpeg, applies optional branding (logo + lower-third
 * text), then produces a polished MP4.
 *
 * Usage:
 *   node scripts/render-video.mjs [--config path/to/demo.config.mjs]
 *
 * Dependencies: none beyond Node 18+ built-ins.
 * External requirement: `ffmpeg` and `ffprobe` must be on PATH.
 *
 * @typedef {Object} DemoBranding
 * @property {string|null} [logoPath]  - PNG (or still image) relative to repo root; omit to skip logo
 * @property {string}      [title]     - Lower-third title
 * @property {string}      [tagline]   - Smaller line under the title
 * @property {string|null} [fontFile]  - Optional TTF path (repo-relative or absolute)
 *
 * @typedef {Object} DemoConfig
 * @property {string}       slidesDir         - Dir where slide videos live (informational)
 * @property {string}       manifestPath      - ffmpeg concat manifest (video files)
 * @property {string}       outputPath        - MP4 output path
 * @property {number}       [fps]             - Frame rate (default 30)
 * @property {number}       [crf]             - H.264 CRF quality (default 22)
 * @property {string|null}  [audioPath]       - Background music MP3 (optional)
 * @property {number}       [audioFadeDuration] - Fade-out seconds (default 2)
 * @property {DemoBranding|null} [branding]  - Optional logo + lower-third copy
 */

import { execFileSync, spawnSync } from 'child_process';
import { existsSync, readFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import { dirname, resolve, join } from 'path';
import { fileURLToPath } from 'url';
import { parseArgs } from 'util';
import os from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const { values: flags } = parseArgs({
  args: process.argv.slice(2),
  options: {
    config: { type: 'string', default: 'demo.config.mjs' },
  },
  strict: false,
});

const configPath = resolve(REPO_ROOT, /** @type {string} */ (flags.config));

if (!existsSync(configPath)) {
  console.error(`[render-video] Config not found: ${configPath}`);
  process.exit(1);
}

/** @type {Record<string, unknown>} */
const config = (await import(configPath)).default;

const manifestPath = resolve(REPO_ROOT, config.manifestPath ?? 'demo/manifest.txt');
const outputPath = resolve(REPO_ROOT, config.outputPath ?? 'demo/output/demo.mp4');
const fps = config.fps ?? 30;
const crf = config.crf ?? 22;
const audioPath = config.audioPath ? resolve(REPO_ROOT, config.audioPath) : null;
const fadeDur = config.audioFadeDuration ?? 2;

/** @type {DemoBranding} */
const branding =
  config.branding && typeof config.branding === 'object' && config.branding !== null
    ? /** @type {DemoBranding} */ (config.branding)
    : {};

const logoRel = typeof branding.logoPath === 'string' ? branding.logoPath : null;
const logoAbs = logoRel ? resolve(REPO_ROOT, logoRel) : null;
const useLogo = Boolean(logoAbs && existsSync(logoAbs));
const brandTitle = typeof branding.title === 'string' ? branding.title : 'AppFlow Demo';
const brandTagline = typeof branding.tagline === 'string' ? branding.tagline : 'Recorded product tour';

if (!existsSync(manifestPath)) {
  console.error(
    `[render-video] Manifest not found: ${manifestPath}\n` +
      `  Run "npm run demo:video:capture" first.`
  );
  process.exit(1);
}

for (const bin of ['ffmpeg', 'ffprobe']) {
  const check = spawnSync(bin, ['-version'], { encoding: 'utf8' });
  if (check.error) {
    console.error(
      `[render-video] ${bin} not found on PATH.\n` +
        '  macOS  : brew install ffmpeg\n' +
        '  Ubuntu : sudo apt-get install -y ffmpeg\n' +
        '  Windows: https://ffmpeg.org/download.html'
    );
    process.exit(1);
  }
}

if (audioPath && !existsSync(audioPath)) {
  console.error(
    `[render-video] Audio file not found: ${audioPath}\n` +
      `  Set audioPath: null in demo.config.mjs to skip audio, or provide a valid path.`
  );
  process.exit(1);
}

if (logoRel && !useLogo) {
  console.warn(`[render-video] Branding logo not found (${logoRel}); continuing without logo overlay.`);
}

/**
 * @param {string} manifestText
 * @returns {string[]}
 */
function parseConcatFilePaths(manifestText) {
  const paths = [];
  for (const line of manifestText.split(/\r?\n/)) {
    const m = /^\s*file\s+'([^']+)'\s*$/.exec(line);
    if (m) paths.push(m[1]);
  }
  return paths;
}

/**
 * @param {string} filePath
 * @returns {number}
 */
function probeDurationSeconds(filePath) {
  const out = execFileSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ],
    { encoding: 'utf8' }
  );
  const n = parseFloat(out.trim());
  if (Number.isNaN(n)) {
    throw new Error(`ffprobe could not read duration for: ${filePath}`);
  }
  return n;
}

/**
 * Escape a filesystem path for use inside an ffmpeg filtergraph (fontfile=, textfile=).
 * @param {string} p
 */
function escapePathForFilter(p) {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

function defaultTitleFont() {
  if (process.platform === 'darwin') {
    return '/System/Library/Fonts/Supplemental/Arial.ttf';
  }
  if (process.platform === 'win32') {
    return 'C:/Windows/Fonts/arial.ttf';
  }
  return '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
}

/**
 * @param {string|null|undefined} configured
 */
function resolveFontFile(configured) {
  if (typeof configured === 'string' && configured.length > 0) {
    const abs = resolve(REPO_ROOT, configured);
    if (existsSync(abs)) return abs;
    if (existsSync(configured)) return configured;
  }
  return defaultTitleFont();
}

const manifestText = readFileSync(manifestPath, 'utf8');
const concatPaths = parseConcatFilePaths(manifestText);

if (concatPaths.length === 0) {
  console.error(
    `[render-video] No file entries found in ${manifestPath}.\n` +
      `  Expected lines like: file '/abs/path/to/slide.webm'`
  );
  process.exit(1);
}

for (const p of concatPaths) {
  if (!existsSync(p)) {
    console.error(`[render-video] Referenced clip missing: ${p}`);
    process.exit(1);
  }
}

const totalDuration = concatPaths.reduce((sum, p) => sum + probeDurationSeconds(p), 0);

console.log(`[render-video] Concatenating ${concatPaths.length} clip(s)`);
console.log(`[render-video] Total video duration: ${totalDuration.toFixed(2)}s`);
console.log(`[render-video] Output: ${outputPath}`);

mkdirSync(dirname(outputPath), { recursive: true });

const fontFile = resolveFontFile(branding.fontFile);
if (!existsSync(fontFile)) {
  console.error(
    `[render-video] No usable font for drawtext (tried ${fontFile}).\n` +
      `  Set branding.fontFile in demo.config.mjs to a valid .ttf path.`
  );
  process.exit(1);
}

const tmpLabelDir = mkdtempSync(join(os.tmpdir(), 'demo-render-brand-'));
const titleFile = join(tmpLabelDir, 'title.txt');
const taglineFile = join(tmpLabelDir, 'tagline.txt');
writeFileSync(titleFile, brandTitle, 'utf8');
writeFileSync(taglineFile, brandTagline, 'utf8');

const escFont = escapePathForFilter(fontFile);
const escTitleFile = escapePathForFilter(titleFile);
const escTagFile = escapePathForFilter(taglineFile);

/** @type {string[]} */
const args = ['-y', '-f', 'concat', '-safe', '0', '-i', manifestPath];

let logoInputIndex = -1;
let audioInputIndex = -1;

if (useLogo && logoAbs) {
  args.push('-loop', '1', '-framerate', String(fps), '-i', logoAbs);
  logoInputIndex = 1;
}

if (audioPath) {
  args.push('-i', audioPath);
  audioInputIndex = logoInputIndex === -1 ? 1 : 2;
}

/** @type {string[]} */
const videoChain = useLogo && logoInputIndex >= 0
  ? [
      `[0:v]fps=${fps},format=yuv420p[base]`,
      `[${logoInputIndex}:v]scale=56:-1,format=yuva420p[lg]`,
      `[base][lg]overlay=W-w-20:20:shortest=1[ov0]`,
      `[ov0]drawbox=x=0:y=ih-56:w=iw:h=56:color=black@0.48:t=fill[ov1]`,
      `[ov1]drawtext=fontfile='${escFont}':textfile='${escTitleFile}':x=24:y=h-38:fontsize=20:fontcolor=white[ov2]`,
      `[ov2]drawtext=fontfile='${escFont}':textfile='${escTagFile}':x=24:y=h-20:fontsize=13:fontcolor=white@0.88[outv]`,
    ]
  : [
      `[0:v]fps=${fps},format=yuv420p,drawbox=x=0:y=ih-56:w=iw:h=56:color=black@0.48:t=fill[ov1]`,
      `[ov1]drawtext=fontfile='${escFont}':textfile='${escTitleFile}':x=24:y=h-38:fontsize=20:fontcolor=white[ov2]`,
      `[ov2]drawtext=fontfile='${escFont}':textfile='${escTagFile}':x=24:y=h-20:fontsize=13:fontcolor=white@0.88[outv]`,
    ];

let filterComplex = videoChain.join(';');

if (audioPath && audioInputIndex >= 0) {
  const fadeStart = Math.max(0, totalDuration - fadeDur);
  let audioGraph = `[${audioInputIndex}:a]atrim=0:${totalDuration}`;
  if (fadeDur > 0) {
    audioGraph += `,afade=t=out:st=${fadeStart}:d=${fadeDur}`;
  }
  audioGraph += '[aout]';
  filterComplex = `${filterComplex};${audioGraph}`;
}

args.push('-filter_complex', filterComplex);
args.push('-map', '[outv]');

if (audioPath && audioInputIndex >= 0) {
  args.push('-map', '[aout]');
  args.push('-c:a', 'aac', '-b:a', '192k');
  args.push('-shortest');
}

args.push(
  '-c:v',
  'libx264',
  '-crf',
  String(crf),
  '-preset',
  'medium',
  '-movflags',
  '+faststart',
  outputPath
);

console.log(`\n[render-video] Running: ffmpeg ${args.join(' ')}\n`);

function cleanupLabelDir() {
  try {
    rmSync(tmpLabelDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

try {
  execFileSync('ffmpeg', args, { stdio: 'inherit' });
  cleanupLabelDir();
  console.log(`\n[render-video] ✓ Done! Video saved to: ${outputPath}`);
} catch {
  cleanupLabelDir();
  console.error('\n[render-video] ✗ ffmpeg exited with an error (see output above).');
  process.exit(1);
}
