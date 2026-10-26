import { instant } from '../../../domain/src/values/core.ts';
import type { RightsPolicy } from '../../../domain/src/privacy-policy.ts';
export function rightsClock(now: string, p: RightsPolicy) {
  if (!instant(now).ok) throw Error('Invalid privacy clock');
  const at = Date.parse(now);
  return {
    dueAt: new Date(at + p.responseDays * 86400000).toISOString(),
    proofExpiresAt: new Date(at + p.proofMinutes * 60000).toISOString(),
  };
}
