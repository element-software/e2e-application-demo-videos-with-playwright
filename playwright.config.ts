import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for the AppFlow demo tour.
 *
 * The webServer block automatically starts the Vite dev server before
 * running tests and shuts it down afterwards.  If you prefer to start
 * the server yourself, set the DEMO_BASE_URL environment variable:
 *
 *   DEMO_BASE_URL=http://localhost:5173 npm run demo:video:capture
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // screenshots must be ordered
  retries: 0,
  workers: 1,
  reporter: 'list',

  use: {
    baseURL: process.env.DEMO_BASE_URL ?? 'http://localhost:5173',
    // Fixed viewport so every slide is the same size
    viewport: { width: 1280, height: 720 },
    // Disable animations so screenshots are stable
    reducedMotion: 'reduce',
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
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
