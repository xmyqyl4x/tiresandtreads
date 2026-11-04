import { it, expect } from 'vitest';
import { previewForwardHeaders } from '../fixtures/http/preview-headers.mjs';
const path = '/local-staff-api/api/v1/staff-console/publish',
  reviewer = 'Bearer ' + 'a'.repeat(43),
  incoming = {
    'x-reviewer-authorization': reviewer,
    authorization: 'Bearer ' + 'b'.repeat(43),
    'x-csrf-token': 'c'.repeat(64),
    'x-forwarded-host': 'evil.invalid',
    'x-private': 'PRIVATE',
  };
it('preserves peer authority only on the exact reviewed local write without permitting arbitrary upstream headers', () => {
  expect(previewForwardHeaders(incoming, '127.0.0.1:8380', path, 'POST')).toEqual({
    host: '127.0.0.1:8380',
    authorization: incoming.authorization,
    'x-csrf-token': incoming['x-csrf-token'],
    'x-reviewer-authorization': reviewer,
  });
  for (const [p, m] of [
    [path, 'GET'],
    [path + '?extra=1', 'POST'],
    ['/local-staff-api/api/v1/staff/recover', 'POST'],
  ] as const)
    expect(previewForwardHeaders(incoming, '127.0.0.1:8380', p, m)).not.toHaveProperty(
      'x-reviewer-authorization',
    );
  expect(
    previewForwardHeaders(
      { ...incoming, 'x-reviewer-authorization': ['forged', reviewer] },
      '127.0.0.1:8380',
      path,
      'POST',
    ),
  ).not.toHaveProperty('x-reviewer-authorization');
});
