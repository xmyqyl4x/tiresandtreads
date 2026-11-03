import { it, expect } from 'vitest';
import { operationQuerySchemas } from '../../packages/contracts/src/operation-queries.ts';
it.each([
  { day: '2026-02-30' },
  { day: '2026-11-03', dimension: 'caller-sql' },
  { day: '2026-11-03', actorId: 'private' },
])('refuses malformed or unknown staff query inputs before persistence', (query) => {
  expect(operationQuerySchemas.operationsMetrics.safeParse(query).success).toBe(false);
});
it('preserves bounded page queries and required business dimensions for the OpenAPI contract', () => {
  expect(operationQuerySchemas.staffQueue.parse({ limit: '5' })).toEqual({ limit: 5 });
  expect(operationQuerySchemas.staffQueue.safeParse({ limit: '101' }).success).toBe(false);
  expect(operationQuerySchemas.adRevenue.safeParse({ day: '2026-11-03' }).success).toBe(false);
  expect(
    operationQuerySchemas.adRevenue.parse({ day: '2026-11-03', account: 'fixture' }),
  ).toMatchObject({ dimension: 'all', currency: 'USD' });
  expect(
    operationQuerySchemas.getBrowserConsent.safeParse({ cmpAvailable: 'arbitrary' }).success,
  ).toBe(false);
});
