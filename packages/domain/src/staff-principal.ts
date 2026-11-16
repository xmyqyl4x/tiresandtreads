import { instantMilliseconds } from './values/time.ts';
import { id, instant, invalid, ok, type Id, type Instant } from './values/core.ts';
// Staff verification establishes no partner email or business-domain facts.
export interface StaffIdentity {
  readonly subject: string;
  readonly staffId: Id<'staff'> | null;
  readonly mfaAt: Instant;
  readonly expiresAt: Instant;
}
export interface StaffPrincipal extends StaffIdentity {
  readonly staffId: Id<'staff'>;
}
export function staffPrincipal(value: unknown, now: number) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('principal');
  const v = value as Record<string, unknown>,
    staff = id('staff', v.staffId),
    mfa = instant(v.mfaAt),
    until = instant(v.expiresAt);
  if (
    !staff.ok ||
    !mfa.ok ||
    !until.ok ||
    !Number.isSafeInteger(now) ||
    typeof v.subject !== 'string' ||
    !/^[A-Za-z0-9:._-]{1,200}$/.test(v.subject) ||
    instantMilliseconds(mfa.value) - 62135596800000 > now ||
    now - (instantMilliseconds(mfa.value) - 62135596800000) > 300000 ||
    instantMilliseconds(until.value) - 62135596800000 <= now ||
    instantMilliseconds(until.value) - 62135596800000 > now + 3600000
  )
    return invalid('principal');
  return ok(
    Object.freeze({
      subject: v.subject,
      staffId: staff.value,
      mfaAt: mfa.value,
      expiresAt: until.value,
    }),
  );
}
