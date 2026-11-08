import type { AssessmentRequest } from '../../../../packages/contracts/src/report-inputs.ts';
export type ConfirmedSizeApplication = { key: string; axle: 'front' | 'rear'; value: string };
export function applyConfirmedSize(
  before: AssessmentFields,
  application: ConfirmedSizeApplication | null,
): AssessmentFields {
  if (application === null) return before;
  const value = application.value.trim();
  if (!/^[A-Z0-9/.-]{1,80}$/i.test(value)) throw Error('Invalid confirmed size');
  return {
    ...before,
    mode: 'manual',
    configuration: '',
    vehicle: '',
    year: '',
    [application.axle]: value.toUpperCase(),
    confirmed: false,
  };
}
export type AssessmentFields = {
  mode: 'vehicle' | 'manual';
  region: string;
  year: string;
  vehicle: string;
  configuration: string;
  wheelPackage: string;
  front: string;
  rear: string;
  confirmed: boolean;
  strategy: AssessmentRequest['strategy'];
  winterUse: AssessmentRequest['winterUse'];
  replace: AssessmentRequest['replace'];
  priorities: AssessmentRequest['priorities'];
  budget: string;
  budgetBasis: 'installed' | 'merchandise';
  annualMiles: string;
};
export const blankAssessment: AssessmentFields = {
  mode: 'vehicle',
  region: '',
  year: '',
  vehicle: '',
  configuration: '',
  wheelPackage: '',
  front: '',
  rear: '',
  confirmed: false,
  strategy: 'year_round',
  winterUse: 'unknown',
  replace: ['front_left', 'front_right', 'rear_left', 'rear_right'],
  priorities: [],
  budget: '',
  budgetBasis: 'installed',
  annualMiles: '',
};
export function assessmentAnswers(f: AssessmentFields) {
  const errors: Record<string, string> = {};
  const text = (value: string) => value.trim();
  if (!/^[A-Z0-9_-]{1,80}$/.test(text(f.region).toUpperCase()))
    errors.region = 'Enter a supported region code, or a region to check.';
  if (f.mode === 'vehicle' && !f.configuration)
    errors.configuration = 'Choose a wheel package explicitly, or use manual entry.';
  if (!f.wheelPackage.trim())
    errors.wheelPackage = 'Enter or choose the wheel package shown on your vehicle information.';
  for (const axle of ['front', 'rear'] as const)
    if (!/^[A-Z0-9/.-]{1,80}$/i.test(text(f[axle])))
      errors[axle] = 'Enter the size from the sidewall or vehicle placard.';
  if (!f.confirmed)
    errors.confirmed =
      'Confirm you checked the front and rear information. This does not verify fitment.';
  if (![1, 2, 4].includes(f.replace.length) || new Set(f.replace).size !== f.replace.length)
    errors.replace = 'Choose one, two or four tire positions.';
  if (f.priorities.length > 3 || new Set(f.priorities).size !== f.priorities.length)
    errors.priorities = 'Choose up to three different priorities.';
  const dollars = text(f.budget),
    miles = text(f.annualMiles);
  if (dollars && !/^\d{1,9}(\.\d{1,2})?$/.test(dollars))
    errors.budget = 'Enter a dollar amount with up to two decimal places.';
  if (miles && (!/^\d{1,6}$/.test(miles) || Number(miles) > 200000))
    errors.annualMiles = 'Enter whole annual miles from 0 to 200,000, or leave unknown.';
  if (Object.keys(errors).length) return { ok: false as const, errors };
  const [whole, fraction = ''] = dollars.split('.');
  const input: AssessmentRequest = {
    market: 'US',
    regionKey: text(f.region).toUpperCase(),
    configurationId: f.mode === 'vehicle' ? f.configuration : null,
    wheelPackage: text(f.wheelPackage),
    sizes: { front: text(f.front).toUpperCase(), rear: text(f.rear).toUpperCase() },
    strategy: f.strategy,
    winterUse: f.winterUse,
    replace: f.replace,
    priorities: f.priorities,
    budget: dollars
      ? {
          basis: f.budgetBasis,
          ceilingMinor: (BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'))).toString(),
          currency: 'USD',
        }
      : null,
    annualMiles: miles ? Number(miles) : null,
  };
  return { ok: true as const, input };
}
