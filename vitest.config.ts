import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // M0 Done-when: `npm test` runs before the first test exists.
    passWithNoTests: true,
  },
});
