export type RightsKind = 'access' | 'delete' | 'correct' | 'restrict' | 'opt_out' | 'export';
export interface RightsPolicy {
  readonly responseDays: number;
  readonly escalationDays: number;
  readonly proofMinutes: number;
  readonly maxAttempts: number;
}
export function rightsPolicy(raw: unknown): RightsPolicy {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('Invalid rights policy');
  const p = raw as Record<string, unknown>;
  if (
    Object.keys(p).sort().join(',') !== 'escalationDays,maxAttempts,proofMinutes,responseDays' ||
    !Number.isInteger(p.responseDays) ||
    Number(p.responseDays) < 1 ||
    Number(p.responseDays) > 365 ||
    !Number.isInteger(p.escalationDays) ||
    Number(p.escalationDays) < 1 ||
    Number(p.escalationDays) >= Number(p.responseDays) ||
    !Number.isInteger(p.proofMinutes) ||
    Number(p.proofMinutes) < 5 ||
    Number(p.proofMinutes) > 1440 ||
    !Number.isInteger(p.maxAttempts) ||
    Number(p.maxAttempts) < 1 ||
    Number(p.maxAttempts) > 8
  )
    throw Error('Invalid rights policy');
  return Object.freeze({ ...p }) as unknown as RightsPolicy;
}
export const rightsKinds: readonly RightsKind[] = [
  'access',
  'delete',
  'correct',
  'restrict',
  'opt_out',
  'export',
];
