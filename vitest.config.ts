import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    maxWorkers: 2,
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      // Empty stage-boundary markers have no executable behavior.
      exclude: [
        'packages/{domain,engine,application,db,integrations}/src/index.ts',
        // Generated declarations have complete live-schema parity checks in s2-gate.test.ts.
        'packages/db/src/models/*.generated.ts',
      ],
      thresholds: {
        lines: 85,
        statements: 85,
        functions: 85,
        branches: 80,
        'packages/{domain,engine,application}/src/**/*.ts': {
          lines: 95,
          statements: 95,
          branches: 90,
        },
      },
    },
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          setupFiles: ['tests/setup.ts'],
        },
      },
      {
        test: {
          name: 'usecases',
          include: ['tests/usecases/**/*.test.ts'],
          setupFiles: ['tests/setup.ts'],
        },
      },
      {
        test: {
          name: 'database',
          include: ['tests/database/**/*.test.ts'],
          testTimeout: 15000,
          fileParallelism: false,
        },
      },
      {
        test: {
          name: 'foundation',
          include: ['tests/foundation/**/*.test.ts'],
          testTimeout: 15000,
          hookTimeout: 15000,
          fileParallelism: false,
        },
      },
      {
        test: {
          name: 'schema',
          include: ['tests/schema/**/*.test.ts'],
          testTimeout: 15000,
          hookTimeout: 15000,
          fileParallelism: false,
        },
      },
      {
        test: {
          name: 'recovery',
          include: ['tests/recovery/**/*.test.ts'],
          testTimeout: 30000,
          hookTimeout: 30000,
          fileParallelism: false,
        },
      },
      {
        test: {
          name: 'custody',
          include: ['tests/custody/**/*.test.ts'],
          testTimeout: 30000,
          hookTimeout: 30000,
          fileParallelism: false,
        },
      },
      {
        test: {
          name: 'deployment',
          include: ['tests/deployment/**/*.test.ts'],
          testTimeout: 20000,
          hookTimeout: 20000,
          fileParallelism: false,
        },
      },
      { test: { name: 'probe', include: ['tests/probes/**/*.test.ts'] } },
    ],
  },
});
