import { readRuntimeConfig } from '../../packages/config/src/runtime.ts';

// Bundled at build time from the same schema used by instrumentation/readiness.
// A thrown error exits before Next.js opens its listening socket.
readRuntimeConfig(process.env);
