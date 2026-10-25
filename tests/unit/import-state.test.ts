import { it, expect } from 'vitest';
import { runState } from '../../packages/db/src/repositories/ingestion.ts';
const row = {
  id: '11111111-1111-4111-8111-111111111111',
  dataset_version_id: '22222222-2222-4222-8222-222222222222',
  revision: '1',
  fence: '0',
  status: 'registered',
  checkpoint: { schemaVersion: 1, throughRow: '0' },
  accepted_count: '0',
  rejected_count: '0',
};
it('rejects corrupt stored import counters, unknown states and unsupported checkpoint versions', () => {
  expect(runState(row)).toMatchObject({
    fence: 0n,
    throughRow: 0n,
    accepted: 0n,
    rejected: 0n,
    status: 'registered',
  });
  for (const change of [
    { fence: null },
    { fence: '-1' },
    { accepted_count: '9007199254740993.0' },
    { rejected_count: 0 },
    { status: 'invented' },
    { checkpoint: { schemaVersion: 2, throughRow: '0' } },
    { checkpoint: { schemaVersion: 1, throughRow: '9999999999999999999' } },
    { checkpoint: { schemaVersion: 1, throughRow: '00' } },
    { checkpoint: [] },
  ])
    expect(() => runState({ ...row, ...change })).toThrow('errors.integrity');
  expect(
    runState({ ...row, fence: '9223372036854775807', accepted_count: '9007199254740993' }).accepted,
  ).toBe(9007199254740993n);
});
