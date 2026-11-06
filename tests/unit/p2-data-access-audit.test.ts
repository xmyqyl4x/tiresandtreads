import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  inspectPureSource,
  inspectProjection,
  auditP2DataAccess,
} from '../../scripts/review/p2-data-access.mjs';
const file = 'packages/domain/src/entities/photo.ts';
it('audits the exact repository inventory without approving S2 or service construction', () => {
  const r = auditP2DataAccess();
  expect(r.actualS2Approval).toBe(false);
  expect(r.servicesStarted).toBe(false);
  expect(r.gatesClosed).toBe(0);
  expect(r.pinnedSources).toBeGreaterThan(49);
  expect(r.pureModules).toBeGreaterThan(10);
  expect(r.repositoryPorts).toBe(5);
});
it('accepts inward relative type imports and returns their exact dependency', () => {
  expect(
    inspectPureSource(
      file,
      "import type {Id} from '../values/core.ts'; export interface A { readonly id:Id<'x'> }",
    ),
  ).toEqual(['packages/domain/src/values/core.ts']);
});
it.each([
  "import OpenAI from 'openai';",
  "export * from 'drizzle-orm';",
  "type A = import('pg').Pool;",
  "const a = import('@aws-sdk/client-s3');",
  "const a = require('pg');",
  "import a = require('drizzle-orm');",
  'const a = import(name);',
  "import type {A} from '../../../db/src/transactions.ts';",
  "import type {A} from '../../../../../../outside.ts';",
])('refuses impure or unbounded model edges: %s', (source) => {
  expect(() => inspectPureSource(file, source)).toThrow();
});
it('accepts exactly named readonly projection fields', () => {
  expect(() =>
    inspectProjection('interface P { readonly id:string; readonly state:string }', 'P', [
      'id',
      'state',
    ]),
  ).not.toThrow();
});
it.each([
  'interface P { readonly id:string; readonly state:string; readonly objectKey:string }',
  'interface P { readonly id:string }',
  'interface P extends Secret { readonly id:string; readonly state:string }',
  'interface P { readonly id:string; readonly state:string; [key:string]:unknown }',
  'interface P { id:string; readonly state:string }',
  'interface P { readonly id:string; readonly state?:string }',
])('refuses drift in a safe projection: %s', (source) => {
  expect(() => inspectProjection(source, 'P', ['id', 'state'])).toThrow();
});
it('refuses a changed pinned repository even if its TypeScript is valid', () => {
  expect(() =>
    auditP2DataAccess(
      (p: string) =>
        readFileSync(p, 'utf8') + (p.endsWith('/analysis-requests.ts') ? '\n// drift\n' : ''),
    ),
  ).toThrow(/checksum/);
});
it('refuses missing source rather than reporting partial coverage', () => {
  expect(() =>
    auditP2DataAccess((p: string) => {
      if (p.endsWith('/photo-owners.ts')) throw Error('missing');
      return readFileSync(p, 'utf8');
    }),
  ).toThrow('missing');
});

it('rejects unreviewed source-revision metadata even when repository code is unchanged', () => {
  expect(() =>
    auditP2DataAccess(
      (p: string) =>
        readFileSync(p, 'utf8') + (p.endsWith('p2-source-revisions.json') ? '\n ' : ''),
    ),
  ).toThrow(/checksum/);
});
it('refuses a drifted partner-authorship revision independently from historical pins', () => {
  expect(() =>
    auditP2DataAccess(
      (p: string) =>
        readFileSync(p, 'utf8') +
        (p.endsWith('partner-offers.ts') ? '\n// unauthorized drift\n' : ''),
    ),
  ).toThrow(/checksum/);
});
