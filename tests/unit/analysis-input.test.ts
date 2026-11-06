import { it, expect } from 'vitest';
import {
  canonicalManifest,
  manifestValue,
} from '../../packages/db/src/repositories/analysis-input.ts';
import { id, revision } from '../../packages/domain/src/values/core.ts';
import type { AIPolicy, AIScope, AIManifest } from '../../packages/domain/src/entities/analysis.ts';
const parsed = id('ai_policy', '10000000-0000-4000-8000-000000000001'),
  s = id('ai_scope', '10000000-0000-4000-8000-000000000002'),
  r = revision('1');
if (!parsed.ok || !s.ok || !r.ok) throw Error('fixed values');
const policy: AIPolicy = {
  id: parsed.value,
  task: 'generic_explanation',
  canonicalVersion: 'jsonb-v1',
  validatorVersion: 'v1',
  sharedAllowed: true,
  sharedParameters: ['usage', 'climate_category'],
  status: 'active',
};
const scope: AIScope = {
  id: s.value,
  policyId: policy.id,
  ownerId: null,
  kind: 'shared',
  subjectRevision: null,
  permissionRevision: r.value,
  invalidationRevision: 0n,
  state: 'active',
  processingAllowed: true,
  noticeVersion: 'v1',
};
it('serializes a bounded reviewed generic manifest and keeps nullable parameters explicit', () =>
  expect(
    JSON.parse(
      canonicalManifest(
        { parameters: { usage: 'commute', climate_category: null } },
        policy,
        scope,
      ),
    ),
  ).toEqual({ parameters: { usage: 'commute', climate_category: null } }));
it.each([
  { parameters: { email: 'owner@example.invalid' } },
  { parameters: { usage: 'free text' } },
  { parameters: { usage: 1 } },
  { parameters: { usage: ['commute'] } },
  { parameters: {}, bundle_id: policy.id },
  { parameters: {}, authoritative_hash: 'a'.repeat(64) },
  { parameters: {}, sanitized_sha256: 'a'.repeat(64) },
])('rejects shared private/unreviewed inputs %j', (input) =>
  expect(() => canonicalManifest(input, policy, scope)).toThrow(),
);
it.each([
  null,
  [],
  {},
  { parameters: [] },
  { parameters: {}, injected: 1 },
  { parameters: {}, bundle_id: 'bad' },
  { parameters: {}, authoritative_hash: 'A'.repeat(64) },
  { parameters: { text: 'a'.repeat(70000) } },
])('rejects an invalid or oversized manifest %j', (input) =>
  expect(() => manifestValue(input)).toThrow(),
);
it('requires the active matching policy', () => {
  expect(() =>
    canonicalManifest({ parameters: {} }, { ...policy, status: 'retired' }, scope),
  ).toThrow();
  expect(() =>
    canonicalManifest({ parameters: {} }, { ...policy, sharedAllowed: false }, scope),
  ).toThrow();
});
it('requires the photo input hash only for photo tasks', () => {
  const p = { ...policy, task: 'photo_extraction' as const },
    ownerScope = { ...scope, kind: 'owner' as const };
  expect(() => canonicalManifest({ parameters: {} }, p, ownerScope)).toThrow();
  expect(() =>
    canonicalManifest({ parameters: {}, sanitized_sha256: 'a'.repeat(64) }, policy, ownerScope),
  ).toThrow();
});
it('snapshots mutable caller input before awaiting any SQL', () => {
  const input: AIManifest = { parameters: { usage: 'commute' } };
  const text = canonicalManifest(input, policy, scope);
  (input.parameters as Record<string, unknown>).usage = 'offroad';
  expect(JSON.parse(text).parameters.usage).toBe('commute');
});
