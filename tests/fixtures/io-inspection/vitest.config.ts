import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include:
      process.env.IO_PROFILE === 'standard' || !process.env.IO_PROFILE
        ? ['tests/io-inspection/*.test.ts']
        : ['tests/io-inspection/adverse.test.ts'],
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
