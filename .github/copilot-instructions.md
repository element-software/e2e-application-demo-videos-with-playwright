# Copilot instructions for this repository

## Build, test, and lint commands

- Install dependencies with `npm install` at the repo root and `npm run app:install` for the Next.js app.
- Install the browser dependency with `npx playwright install chromium`.
- Build the app with `npm run app:build`.
- Run the capture test suite with `npm run demo:video:capture` or `npx playwright test`.
- Run the single Playwright spec with `npx playwright test tests/demo-tour.spec.ts --project=demo-capture`.
- Run the render step only with `npm run demo:video:render`.
- Run the full capture + render pipeline with `npm run demo:video`.
- If you already started the app yourself, point Playwright at it with `DEMO_BASE_URL=http://localhost:3000 npm run demo:video:capture`.
- There is currently **no lint script** in either the root `package.json` or `app/package.json`.

## High-level architecture

- This repository is a demo-video pipeline, not just a web app. The root package orchestrates a **Next.js App Router demo app**, a **Playwright capture spec**, and an **ffmpeg render step**.
- The demo app lives under `app/src/app`. `layout.tsx` provides the shared shell and nav, while the route pages under `app/src/app/**/page.tsx` are intentionally simple, static marketing/product screens that are easy to capture on video.
- The one dynamic area is the profile flow: `app/src/app/api/demo-profile/route.ts` serves the default profile from `app/src/lib/demoProfile.ts`, and `app/src/app/profile/ProfileClient.tsx` fetches it client-side.
- `tests/demo-tour.spec.ts` is the core of the demo system. It records each slide in a fresh browser context, injects a visible demo pointer, performs deterministic navigation/typing/scrolling, then wraps the raw app clip into a branded 1920x1080 composite slide with headline copy and bullets.
- `tests/support/demoVideo.ts` contains the shared capture helpers for dark first paint, local clip serving, video priming, and viewport-aligned recording.
- The capture step writes `.webm` clips into `demo/slides/` and writes a concat manifest to `demo/manifest.txt`. `scripts/render-video.mjs` reads that manifest, validates `ffmpeg`/`ffprobe`, overlays the optional logo, loops and fades audio if configured, and writes the final MP4 to `demo/output/demo.mp4`.
- `demo.config.mjs` is the central render-time configuration for output paths, fps, CRF, background audio, and branding assets.

## Key conventions

- Treat the **Playwright spec as the source of truth for the demo story**. Slide order, titles, subtitles, bullets, and the final composited output are all defined in `tests/demo-tour.spec.ts`.
- Keep `data-testid` values stable when editing UI routes. The capture flow depends on route-level markers like `page-home` and `page-profile`, plus form/profile selectors such as `input-name`, `btn-submit`, and `profile-loaded`.
- Keep the two profile data sources separate:
  - `app/src/lib/demoProfile.ts` is the default data for normal local browsing.
  - `e2e/fixtures/appflowProfile.ts` is the deterministic capture fixture used by Playwright via request routing.
  Change the fixture when you want the recorded demo content to change without changing the default app experience.
- Capture is intentionally serialized. `playwright.config.ts` uses `workers: 1` and `fullyParallel: false` because the output is an ordered video, not an independent test matrix.
- Preserve the aspect-ratio assumptions across the pipeline. Raw page capture uses the fixed 1280x720 viewport from `playwright.config.ts`, and the spec composites those clips into 1920x1080 slides before ffmpeg concatenation.
- The root Playwright config starts the app with `npm run app:dev` and defaults `baseURL` to `http://localhost:3000`. Follow the code, not the older README references to Vite or port 5173.
- `demo/branding/` contains committed assets used by rendering, while `demo/slides/`, `demo/manifest.txt`, and `demo/output/` are generated artifacts.
- `scripts/render-video.mjs` is intentionally dependency-light and uses Node built-ins plus external `ffmpeg`/`ffprobe`; prefer extending `demo.config.mjs` and the existing render pipeline before adding new packages.
