import { defineConfig, devices } from '@playwright/test';

/** Saved login (password-gate cookie) shared by all test projects. */
export const AUTH_FILE = 'playwright/.auth/site.json';

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* UAT site is slow to fire the `load` event, so allow more time per test. */
  timeout: 90_000,
  expect: { timeout: 15_000 },
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    baseURL: process.env.BASE_URL ?? 'https://cargocrew-2026-uat.vercel.app',
    navigationTimeout: 60_000,
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  /* Configure projects for major browsers */
  projects: [
    /* Unlocks the Vercel password gate once and saves the cookie. */
    { name: 'setup', testMatch: /.*\.setup\.ts/ },

    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: AUTH_FILE },
      dependencies: ['setup'],
    },

    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], storageState: AUTH_FILE },
      dependencies: ['setup'],
    },

    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], storageState: AUTH_FILE },
      dependencies: ['setup'],
    },
  ],
});
