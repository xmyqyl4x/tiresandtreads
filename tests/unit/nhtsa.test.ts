import { expect, it } from 'vitest';
import {
  parseSourceSpec,
  sourceKey,
} from '../../packages/application/src/services/source-policy.ts';
import { vpicFacts } from '../../packages/integrations/src/sources/vpic.ts';
import { sourceIdentity } from '../../packages/integrations/src/sources/identity.ts';
import { instant } from '../../packages/domain/src/values/core.ts';
const stamp = instant('2026-10-25T00:00:00.000Z');
if (!stamp.ok) throw Error('fixture');
it('requires an exact allowlisted scope and refuses a licensed connector without a reviewed contract', () => {
  expect(
    parseSourceSpec({ type: 'vpic-models', makeId: 474, year: 2024, vehicleType: 'passenger car' })
      .ok,
  ).toBe(true);
  for (const x of [
    { type: 'licensed-fitment' },
    { type: 'vpic-plants', year: 2015, equipmentType: 1 },
    { type: 'vpic-manufacturers', url: 'https://bad.test' },
    null,
  ])
    expect(parseSourceSpec(x).ok).toBe(false);
  expect(sourceKey({ type: 'nhtsa-tire-recalls' })).toBe('nhtsa_tire_recalls');
});
it('normalizes vehicle identity into form options without asserting tire fitment', async () => {
  const identity = sourceIdentity('fixture');
  const facts = [];
  for await (const fact of vpicFacts(
    { type: 'vpic-models', makeId: 474, year: 2024, vehicleType: 'passenger car' },
    [
      {
        Make_ID: 474,
        Make_Name: 'HONDA',
        Model_ID: 1861,
        Model_Name: 'Accord',
        VehicleTypeId: 2,
        VehicleTypeName: 'Passenger Car',
      },
    ],
    identity,
  ))
    facts.push(fact);
  expect(facts.some((f) => f.kind === 'vehicleLookupOptions')).toBe(true);
  expect(
    facts.some(
      (f) =>
        f.kind === 'fitmentConfigurations' || f.kind === 'fitmentAxles' || f.kind === 'vehicles',
    ),
  ).toBe(false);
});
