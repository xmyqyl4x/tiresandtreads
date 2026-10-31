import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include:
      process.env.POPULATED_PROFILE === 'positive'
        ? ['tests/populated-preservation/*.test.ts', 'tests/unit/populated-preservation.test.ts']
        : ['tests/populated-preservation/live.test.ts'],
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
