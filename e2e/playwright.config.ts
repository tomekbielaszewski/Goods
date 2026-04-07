import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  use: {
    baseURL: 'http://localhost:8080',
    headless: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'api',
      testDir: './api',
      use: { browserName: 'chromium' },
    },
    {
      name: 'chrome',
      testDir: './ui',
      use: { browserName: 'chromium' },
    },
    {
      name: 'mobile',
      testDir: './ui',
      // Device emulation: 412×915 viewport, touch events, Pixel 7 UA.
      // Runs fully headless — no physical device or Xvfb needed.
      use: devices['Pixel 7'],
    },
  ],
  retries: 1,
  workers: 4,
})
