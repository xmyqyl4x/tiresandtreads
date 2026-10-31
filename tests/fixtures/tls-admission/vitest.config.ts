import { defineConfig } from 'vitest/config';
const phase = process.env.TLS_ADMISSION_PHASE;
if (
  ![
    'standard',
    'expired',
    'future',
    'plaintext',
    'restart',
    'supervisor-loss',
    'material',
    'credential',
  ].includes(phase ?? '')
)
  throw Error('Disposable TLS phase refused');
const file =
  phase === 'standard'
    ? 'admission'
    : ['restart', 'supervisor-loss', 'material', 'credential'].includes(phase ?? '')
      ? 'liveness'
      : 'transport';
export default defineConfig({
  test: {
    include: [`tests/tls-admission/${file}.test.ts`],
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 15000,
    reporters: ['default'],
  },
});
