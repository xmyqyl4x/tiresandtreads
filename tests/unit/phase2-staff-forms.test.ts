import { it, expect } from 'vitest';
import { csvMetadata, templateInput } from '../../apps/web/src/phase2/staff/forms.ts';
it('captures a closed CSV provenance request and fixed installed mapping without executable client conversions', () => {
  const f = new FormData();
  for (const [k, v] of Object.entries({
    template: '11111111-1111-4111-8111-111111111111',
    provider: '22222222-2222-4222-8222-222222222222',
    license: '33333333-3333-4333-8333-333333333333',
    effective: '2026-11-08T00:00',
    externalVersion: 'local-v1',
    mapping: 'tire_models_v1',
    version: '1',
    maxRows: '100000',
    maxBytes: '16777216',
  }))
    f.set(k, v);
  expect(csvMetadata(f)).toMatchObject({
    market: 'US',
    effectiveAt: '2026-11-08T00:00:00.000Z',
    externalVersion: 'local-v1',
  });
  expect(templateInput(f)).toMatchObject({
    mapping: 'tire_models_v1',
    state: 'active',
    maxRows: 100000,
    maxBytes: 16777216,
  });
  f.set('provider', 'not-an-id');
  expect(() => csvMetadata(f)).toThrow();
  f.set('maxRows', '100001');
  expect(() => templateInput(f)).toThrow();
});
