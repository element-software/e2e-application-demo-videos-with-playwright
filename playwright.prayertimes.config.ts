import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for the prayertimes.dev demo video capture.
 *
 * Points at the live app (https://app.prayertimes.dev) by default.
 * Override by setting DEMO_BASE_URL in the environment:
 *
 *   DEMO_BASE_URL=http://localhost:3000 npm run prayertimes:demo:capture
 *
 * No webServer block — the target is the deployed production app.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'prayertimes-demo*.spec.ts',
  fullyParallel: false, // slides must run sequentially to build the story
  retries: 0,
  workers: 1,
  reporter: 'list',
  // Generous timeout — each slide records desktop + mobile + renders composite
  timeout: 300_000,

  use: {
    baseURL: process.env.DEMO_BASE_URL ?? 'https://app.prayertimes.dev',
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'no-preference',
    screenshot: 'only-on-failure',
    trace: 'off',
    video: 'off', // per-context recording is controlled inside each spec
  },

  projects: [
    {
      name: 'prayertimes-demo',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
