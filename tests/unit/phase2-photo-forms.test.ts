import { it, expect } from 'vitest';
import {
  photoFile,
  confirmationInput,
  applyConfirmedSize,
} from '../../apps/web/src/phase2/owner/photo-forms.ts';
import { blankAssessment } from '../../apps/web/src/assessment/model.ts';
it('bounds file admission before bytes are read and preserves explicit processing choice', () => {
  expect(photoFile({ type: 'image/jpeg', size: 10485760 }, true)).toBe('image/jpeg');
  for (const [type, size, allowed] of [
    ['image/svg+xml', 100, true],
    ['image/png', 0, true],
    ['image/png', 10485761, true],
    ['image/png', 100, false],
  ] as const)
    expect(() => photoFile({ type, size }, allowed)).toThrow();
});
it('uses observed confirmation revision plus one, never inventing an accepted candidate', () => {
  const f = new FormData();
  f.set('value', '225/65R17');
  f.set('candidate', 'manual');
  expect(confirmationInput(f, 'tire_size', null)).toEqual({
    field: 'tire_size',
    value: '225/65R17',
    candidateId: null,
    revision: '1',
  });
  expect(confirmationInput(f, 'tire_size', '7').revision).toBe('8');
  f.set('value', '');
  expect(() => confirmationInput(f, 'tire_size', '7')).toThrow();
});
it('only an explicit confirmed size application changes one axle and requires placard confirmation again', () => {
  const before = {
    ...blankAssessment,
    mode: 'vehicle' as const,
    region: 'CA',
    configuration: 'saved',
    wheelPackage: 'OE',
    front: 'old-front',
    rear: 'old-rear',
    confirmed: true,
    priorities: ['wet' as const],
  };
  expect(applyConfirmedSize(before, null)).toBe(before);
  expect(
    applyConfirmedSize(before, { key: 'confirmed:1', axle: 'front', value: '225/65R17' }),
  ).toEqual({
    ...before,
    mode: 'manual',
    configuration: '',
    vehicle: '',
    year: '',
    front: '225/65R17',
    confirmed: false,
  });
  expect(before.front).toBe('old-front');
  expect(() =>
    applyConfirmedSize(before, { key: 'bad', axle: 'rear', value: 'not a tire size' }),
  ).toThrow();
});
