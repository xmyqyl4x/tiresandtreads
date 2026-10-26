import { build } from 'esbuild';
await Promise.all([
  build({
    entryPoints: ['scripts/runtime/service-host.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: '.local/service-host.mjs',
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
  }),
  build({
    entryPoints: ['scripts/mail/recover.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: '.local/mail-recover.mjs',
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
  }),
  build({
    entryPoints: ['scripts/data/source.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: '.local/source.mjs',
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
  }),
  build({
    entryPoints: ['scripts/data/import.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: '.local/import.mjs',
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
  }),
  build({
    entryPoints: ['scripts/runtime/preflight.mjs'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: '.local/preflight.mjs',
  }),
  build({
    entryPoints: ['scripts/runtime/worker.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: '.local/worker.mjs',
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
  }),
]);
