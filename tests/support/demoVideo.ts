import { createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import type { Page, ViewportSize } from '@playwright/test';

/** RGBA for `Emulation.setDefaultBackgroundColorOverride` (alpha 0–1). */
const DEMO_CAPTURE_PAGE_BG = { r: 15, g: 17, b: 23, a: 1 } as const;

/**
 * Chromium video capture can paint white between blank document → first navigation.
 * Set a dark compositor background before any `goto()` / `setContent()` to avoid white flashes.
 */
export async function overrideChromiumCaptureBackground(page: Page) {
  try {
    const session = await page.context().newCDPSession(page);
    await session.send('Emulation.setDefaultBackgroundColorOverride', {
      color: DEMO_CAPTURE_PAGE_BG,
    });
  } catch {
    /* Chromium-only; ignore if CDP is unavailable. */
  }
}

/**
 * Ensures the very first paints are dark (before app CSS loads).
 * Safe to call multiple times (Playwright init scripts are per-context anyway).
 */
export async function addForceDarkFirstPaintInitScript(page: Page) {
  await page.addInitScript(() => {
    const st = document.createElement('style');
    st.textContent = `
      html, body { background: #0f1117 !important; color-scheme: dark; }
    `;
    document.head.appendChild(st);
  });
}

export function asDataUri(buffer: Buffer): string {
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

export function recordVideoForViewport(videoDir: string, size: ViewportSize) {
  return {
    recordVideo: {
      dir: videoDir,
      size: { width: size.width, height: size.height },
    },
  };
}

/** Wait until `clipMs` have passed since `clipStart` (Date.now()). */
export async function padClipToMs(page: Page, clipStart: number, clipMs: number) {
  const elapsed = Date.now() - clipStart;
  const rest = clipMs - elapsed;
  if (rest > 0) {
    await page.waitForTimeout(rest);
  }
}

/**
 * Serves video clips from disk at `origin` + path (e.g. /clip.webm).
 * Used so composite slide pages can load `<video src="http://127.0.0.1:port/...">`.
 */
export async function withLocalClipServer(
  pathToFile: Record<string, string>,
  fn: (origin: string) => Promise<void>,
): Promise<void> {
  const server = createServer((req, res) => {
    const pathname = (req.url ?? '/').split('?')[0] ?? '/';
    const file = pathToFile[pathname];
    if (!file) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'video/webm',
      'Cache-Control': 'no-store',
    });
    const stream = createReadStream(file);
    stream.on('error', () => {
      if (!res.writableEnded) res.end();
    });
    stream.pipe(res);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address();
  const port = addr && typeof addr === 'object' ? addr.port : 0;
  const origin = `http://127.0.0.1:${port}`;

  try {
    await fn(origin);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

/**
 * Chromium often paints white until the first decoded pixel. Keep videos hidden until canplay + first frame.
 * Adds class `sr-demo-video-visible` when ready (paired with CSS in the slide HTML).
 */
export async function primeEmbeddedDemoVideos(page: Page) {
  await page.evaluate(async () => {
    const videos = [...document.querySelectorAll('video.screen-video')] as HTMLVideoElement[];

    const waitCanPlay = (v: HTMLVideoElement) =>
      v.readyState >= 3
        ? Promise.resolve()
        : new Promise<void>((r) => v.addEventListener('canplay', () => r(), { once: true }));

    const waitFirstPaintedFrame = (v: HTMLVideoElement) =>
      new Promise<void>((resolve) => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        const maxWait = window.setTimeout(done, 2500);
        const finish = () => {
          window.clearTimeout(maxWait);
          done();
        };
        v.addEventListener(
          'timeupdate',
          () => {
            if (v.currentTime > 0.02) finish();
          },
          { passive: true },
        );
        type V = HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => void };
        const rvfc = (v as V).requestVideoFrameCallback;
        if (typeof rvfc === 'function') {
          rvfc.call(v, () => finish());
        }
      });

    await Promise.all(
      videos.map(async (v) => {
        v.muted = true;
        await waitCanPlay(v);
        await v.play().catch(() => undefined);
        await waitFirstPaintedFrame(v);
        v.classList.add('sr-demo-video-visible');
      }),
    );
  });

  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

