import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    maxWorkers: 2,
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      // Empty stage-boundary markers have no executable behavior.
      exclude: ['packages/{domain,engine,application,db,integrations}/src/index.ts'],
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
      { test: { name: 'database', include: ['tests/database/**/*.test.ts'], testTimeout: 15000 } },
      { test: { name: 'probe', include: ['tests/probes/**/*.test.ts'] } },
    ],
  },
});
