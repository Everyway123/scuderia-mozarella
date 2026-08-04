import { defineConfig } from 'vitest/config';

// e2e ганяє Playwright, а не vitest — інакше він пробує виконати їх як юніти.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**'],
  },
});
