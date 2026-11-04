import { it, expect } from 'vitest';
import { staffCommandFailure } from '../../packages/contracts/src/staff-command.ts';
it.each(['forbidden', 'not_found', 'unauthorized', 'conflict', 'invalid_input'])(
  'retains an earlier unknown command after a later %s refusal',
  (code) => {
    expect(staffCommandFailure({ code, retryable: false }, true)).toMatchObject({
      preserveCommand: true,
      uncertain: false,
    });
    expect(staffCommandFailure({ code, retryable: false }, false)).toMatchObject({
      preserveCommand: false,
    });
  },
);
it.each([
  Error('PRIVATE'),
  { code: 'timeout' },
  { code: 'commit_unknown' },
  { code: 'unavailable' },
  { code: 'other', retryable: true },
])('retains uncertain outcomes without leaking infrastructure details', (error) => {
  const result = staffCommandFailure(error);
  expect(result.preserveCommand).toBe(true);
  expect(result.uncertain).toBe(true);
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
});
