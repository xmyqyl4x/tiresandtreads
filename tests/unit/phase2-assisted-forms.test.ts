import { it, expect } from 'vitest';
import {
  assistanceState,
  deliverySelection,
  reportReference,
} from '../../apps/web/src/phase2/owner/forms.ts';
it('admits canonical report references and refuses malformed versions', () => {
  const f = new FormData();
  f.set('report', '11111111-1111-4111-8111-111111111111');
  f.set('version', '2');
  expect(reportReference(f).version).toBe(2);
  f.set('version', '2e0');
  expect(() => reportReference(f)).toThrow();
});
it.each(['not_requested', 'pending', 'unavailable', 'expired', 'available'] as const)(
  'labels %s without asserting correctness or sending mail',
  (state) => {
    expect(assistanceState(state)).toBeTruthy();
    expect(assistanceState(state)).not.toMatch(/email sent|safe to drive/i);
  },
);
it('requires an explicit exact attachment or named deterministic fallback', () => {
  expect(deliverySelection('artifact', '7')).toEqual({ attachmentRevision: '7', fallback: null });
  expect(deliverySelection('declined', null)).toEqual({
    attachmentRevision: null,
    fallback: 'declined',
  });
  expect(() => deliverySelection('artifact', null)).toThrow();
  expect(() => deliverySelection('', '1')).toThrow();
});
