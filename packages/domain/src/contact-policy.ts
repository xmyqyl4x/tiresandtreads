import type { ConsentPurpose } from './entities/consent.ts';
// Deliberately conservative ASCII mailbox contract. Do not strip dots/plus tags or fold local case.
export function normalizeEmail(input: unknown): string {
  if (typeof input !== 'string' || /[\r\n\0]/.test(input)) throw Error('invalid_input');
  const email = input.trim(),
    parts = email.split('@');
  if (parts.length !== 2 || email.length > 254) throw Error('invalid_input');
  const local = parts[0]!,
    domain = parts[1]!.toLowerCase();
  if (
    !local.length ||
    local.length > 64 ||
    !/^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~.]+$/.test(local) ||
    local.startsWith('.') ||
    local.endsWith('.') ||
    local.includes('..') ||
    !domain.includes('.') ||
    domain.split('.').some((p) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(p))
  )
    throw Error('invalid_input');
  return local + '@' + domain;
}
export const browserPurposes = ['analytics', 'ads', 'targeted_ads'] as const;
export type BrowserPurpose = (typeof browserPurposes)[number];
export function browserPolicy(
  confirmed: readonly ConsentPurpose[],
  gpc: boolean,
  cmpAvailable: boolean,
) {
  return {
    necessary: true,
    analytics: cmpAvailable && confirmed.includes('analytics'),
    ads: cmpAvailable && confirmed.includes('ads'),
    targeted_ads: cmpAvailable && !gpc && confirmed.includes('targeted_ads'),
    // R1 identity sharing is disabled independently of browser choices.
    identity_sharing: false,
  } as const;
}
