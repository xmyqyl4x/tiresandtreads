import { config } from 'zod/mini';
// Browser validation must work under a self-only CSP; no JIT/eval probe is needed for small wire DTOs.
// Node application/service parsers retain their existing configuration.
if (typeof window !== 'undefined') config({ jitless: true });
