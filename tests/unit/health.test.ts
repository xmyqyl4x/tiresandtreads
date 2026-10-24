import { expect, it } from 'vitest';
import { healthSchema } from '../../packages/contracts/src/health';

it('ENG-04 health contract accepts only bootstrap status and rejects extra data', () => {
  expect(healthSchema.parse({ status: 'ok', scope: 'bootstrap' })).toEqual({
    status: 'ok',
    scope: 'bootstrap',
  });
  expect(
    healthSchema.safeParse({ status: 'ok', scope: 'bootstrap', databasePassword: 'canary' })
      .success,
  ).toBe(false);
  expect(healthSchema.safeParse({ status: 'healthy', scope: 'production' }).success).toBe(false);
});
