import { it, expect } from 'vitest';
import {
  queueViewSchema,
  reportQueueViewSchema,
  strategicRegisterViewSchema,
  commercialConfigurationViewSchema,
  sourceHealthViewSchema,
} from '../../packages/contracts/src/staff-console.ts';
const uuid = '10000000-0000-4000-8000-000000000001',
  at = '2026-11-04T18:00:00.000Z';
it('accepts bounded masked queue views and refuses private report, contact and owner fields', () => {
  const view = { items: [{ id: uuid, state: 'pending', dueAt: at }], next: null };
  expect(queueViewSchema.parse(view)).toEqual(view);
  for (const extra of [
    { email: 'private@example.test' },
    { ownerId: uuid },
    { report: { privateNote: 'private' } },
    { rawProviderPayload: {} },
  ])
    expect(
      queueViewSchema.safeParse({ ...view, items: [{ ...view.items[0], ...extra }] }).success,
    ).toBe(false);
  expect(
    queueViewSchema.safeParse({ ...view, items: Array(101).fill(view.items[0]) }).success,
  ).toBe(false);
  expect(queueViewSchema.safeParse({ ...view, next: 'https://evil.invalid' }).success).toBe(false);
});
it('keeps report triage limited to opaque IDs, state and time without granting report access', () => {
  const value = { items: [{ id: uuid, state: 'draft', updatedAt: at }], next: null };
  expect(reportQueueViewSchema.parse(value)).toEqual(value);
  for (const extra of [
    { snapshot: { recommendations: [] } },
    { vehicle: 'private vehicle' },
    { contactId: uuid },
    { shareToken: 'private' },
  ])
    expect(
      reportQueueViewSchema.safeParse({ ...value, items: [{ ...value.items[0], ...extra }] })
        .success,
    ).toBe(false);
});
it('accepts strategic public paths and refuses private or capability-bearing registry links', () => {
  const item = {
    id: uuid,
    path: '/learn/tire-basics',
    canonical: '/learn/tire-basics',
    status: 'noindex',
    reviewDue: at,
  };
  expect(strategicRegisterViewSchema.safeParse({ items: [item], next: null }).success).toBe(true);
  for (const path of [
    '/reports/private',
    'https://evil.invalid',
    '/learn/tire-basics?token=private',
  ])
    expect(
      strategicRegisterViewSchema.safeParse({ items: [{ ...item, path }], next: null }).success,
    ).toBe(false);
});
it('represents missing configuration and absent actual coverage without inventing zero or authority', () => {
  expect(
    commercialConfigurationViewSchema.parse({ version: 0, policy: null, networkReady: false }),
  ).toEqual({ version: 0, policy: null, networkReady: false });
  const value = { asOf: at, bundle: null, sources: [], actualCoverage: 'unconfirmed', next: null };
  expect(sourceHealthViewSchema.parse(value)).toEqual(value);
  expect(sourceHealthViewSchema.safeParse({ ...value, actualCoverage: 'accepted' }).success).toBe(
    false,
  );
  expect(sourceHealthViewSchema.safeParse({ ...value, sourceCredential: 'private' }).success).toBe(
    false,
  );
});
