import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { healthSchema } from '../../packages/contracts/src/health.ts';

const response = {
  description: 'Bootstrap process/configuration is ready; database/providers are not yet evaluated',
  content: { 'application/json': { schema: healthSchema.toJSONSchema() } },
};
const document = {
  openapi: '3.1.0',
  info: {
    title: 'Tires & Tread bootstrap API',
    version: '0.0.0',
    description: 'Health-only S0 host. Product /api/v1 endpoints arrive at S4.',
  },
  paths: {
    '/health/live': { get: { operationId: 'getLiveness', responses: { 200: response } } },
    '/health/ready': {
      get: { operationId: 'getBootstrapReadiness', responses: { 200: response } },
    },
  },
};
const serialized = JSON.stringify(document, null, 2) + '\n';
const target = 'docs/api/openapi.json';
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== serialized)
    throw new Error('OpenAPI differs; run pnpm contracts:generate');
  console.log('OpenAPI matches the health contract');
} else {
  mkdirSync('docs/api', { recursive: true });
  writeFileSync(target, serialized);
}
