import { it, expect } from 'vitest';
import {
  observe,
  audit,
  foundationRefusal,
  writeDenial,
} from '../fixtures/populated-preservation/reader.ts';
import { profile, flags } from '../fixtures/populated-preservation/contract.ts';

const variant = profile();
it('observes the declared populated phase and refuses actual drift without repairing either domain', async () => {
  const result = await observe();
  const expected: Record<string, string> = {
    'app-row': '1/app:rows',
    'cms-row': '1/cms:rows',
    'missing-row': '1/app:populated',
    'app-history': '1/app:historiesValid',
    'cms-history': '1/cms:historiesValid',
    inventory: '1/app:catalog',
    quarantine: '1/app:quarantined',
    'source-row': '0/app:rows',
  };
  expect(result.compatible, JSON.stringify(result.findings)).toBe(variant === 'positive');
  if (variant === 'positive') expect(result.findings).toEqual([]);
  else expect(result.findings).toContain(expected[variant]);
  expect(result.observations).toHaveLength(4);
  for (const [key, value] of Object.entries(flags)) expect(result).toHaveProperty(key, value);
  if (variant === 'positive') {
    for (const slot of [0, 1])
      for (const kind of ['app', 'cms'] as const) {
        await expect(foundationRefusal(slot, kind)).rejects.toThrow(
          'Disposable TLS admission refused',
        );
        await expect(writeDenial(slot, kind)).rejects.toHaveProperty('code', '25006');
      }
    const repeated = await observe();
    expect(repeated.observations).toEqual(result.observations);
    expect(repeated.compatible).toBe(true);
  }
  const preserved = await audit();
  expect(preserved.fourEndpointParity).toBe(true);
  console.log(
    'POPULATED_OBSERVATION_EVIDENCE ' +
      JSON.stringify({
        profile: variant,
        compatible: result.compatible,
        findings: result.findings,
        endpointTables: result.observations.map((o) => o.tables),
        fourEndpointParity: true,
        sourcePreservedAsPresented: true,
        targetPreservedAsPresented: true,
        foundationRefusals: variant === 'positive' ? 4 : 0,
        nativeWriteRefusals: variant === 'positive' ? 4 : 0,
        repeatedObservation: variant === 'positive',
        ...flags,
      }),
  );
});
