import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        // `npm test`: no stack needed (CI's check job).
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: [...configDefaults.exclude, 'src/**/*.int.test.ts'],
        },
      },
      {
        // `npm run test:int`: against the Compose stack on :3100. One file at
        // a time, because pause.int.test.ts pauses the shared search-service.
        test: {
          name: 'int',
          include: ['src/**/*.int.test.ts'],
          // The stdio tests spawn dist/main.js: build it first.
          globalSetup: ['src/testing/build.global.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
