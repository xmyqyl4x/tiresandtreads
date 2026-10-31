import { defineConfig } from 'vitest/config';
import { profile } from './transport.ts';
export default defineConfig({
  test: {
    include: [
      `tests/multitarget-coordination/${profile() === 'standard' ? 'standard' : 'adverse'}.test.ts`,
    ],
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 15000,
    reporters: ['default'],
  },
});
