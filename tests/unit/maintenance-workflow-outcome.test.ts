import { it, expect } from 'vitest';
import { completeMaintenance } from '../../packages/integrations/src/maintenance-outcome.ts';
it('refuses an application failure inside a successful transport response without exposing its details', () => {
  expect(() =>
    completeMaintenance({
      ok: true,
      value: {
        status: 'completed',
        results: [{ action: 'quotas', status: 'failed', error: 'private@example.invalid' }],
      },
    }),
  ).toThrow('Maintenance incomplete');
  expect(() =>
    completeMaintenance({ ok: false, error: { code: 'unavailable', details: 'private' } }),
  ).toThrow('Maintenance incomplete');
});
it('refuses overlap and malformed or unbounded cycle receipts', () => {
  for (const r of [
    null,
    {},
    { ok: true, value: { status: 'busy', results: [] } },
    { ok: true, value: { status: 'completed', results: [] } },
    { ok: true, value: { status: 'completed', results: [{ action: 'quotas', status: 'busy' }] } },
  ])
    expect(() => completeMaintenance(r)).toThrow('Maintenance incomplete');
});
it('preserves bounded completed and disabled actions and strips unexpected fields from the workflow receipt', () => {
  expect(
    completeMaintenance({
      ok: true,
      value: {
        status: 'completed',
        results: [
          { action: 'quotas', status: 'completed', processed: 2, private: 'secret' },
          { action: 'privacy', status: 'disabled' },
        ],
      },
    }),
  ).toEqual({
    ok: true,
    value: {
      status: 'completed',
      results: [
        { action: 'quotas', status: 'completed', processed: 2 },
        { action: 'privacy', status: 'disabled' },
      ],
    },
  });
});
