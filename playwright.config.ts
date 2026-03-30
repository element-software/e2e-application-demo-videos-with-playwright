import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for the AppFlow demo tour.
 *
 * The webServer block automatically starts the Next.js dev server before
 * running tests and shuts it down afterwards.  If you prefer to start
 * the server yourself, set the DEMO_BASE_URL environment variable:
 *
 *   DEMO_BASE_URL=http://localhost:3000 npm run demo:video:capture
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // demo clips must run in order
  retries: 0,
  workers: 1,
  reporter: 'list',
  // Long runs: each slide replays the tour, scrolls every page, and records video
  timeout: 600_000,

  use: {
    baseURL: process.env.DEMO_BASE_URL ?? 'http://localhost:3000',
    // Fixed viewport so every slide is the same size
    viewport: { width: 1280, height: 720 },
    // Let transitions run so recorded demos look natural
    reducedMotion: 'no-preference',
    screenshot: 'only-on-failure',
    trace: 'off',
    video: 'off',
  },

  projects: [
    {
      name: 'demo-capture',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'npm run app:dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
