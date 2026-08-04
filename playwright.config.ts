import { defineConfig, devices } from '@playwright/test';

// Chromium уже стоїть у середовищі — не тягнемо його заново.
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5181',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    // Мобільний профіль на Chromium, а не на WebKit: у середовищі стоїть
    // тільки Chromium, а перевіряємо ми верстку під 390 px, не рушій Safari.
    {
      name: 'mobile',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
      },
      testMatch: /mobile\.spec\.ts/,
    },
  ],
  webServer: {
    command: 'npx vite --port 5181 --host 127.0.0.1',
    url: 'http://127.0.0.1:5181',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
