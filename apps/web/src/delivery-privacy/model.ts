import {
  contactRequestSchema,
  deliveryRequestSchema,
  ownerRightsSchema,
  type DeliveryChoice,
  type OwnerRightsInput,
} from '../../../../packages/contracts/src/delivery-privacy-inputs.ts';
import {
  checkedProof,
  type DeliveryView,
} from '../../../../packages/contracts/src/delivery-privacy-views.ts';
export interface DeliveryReference {
  readonly id: string;
  readonly version: number;
  readonly comparisonRevision: string | null;
}
export interface DeliveryForm {
  readonly email: string;
  readonly report: boolean;
  readonly offers: boolean;
}
type Failure = { readonly ok: false; readonly errors: Record<string, string> };
export function deliveryReference(search: string): DeliveryReference | null {
  const q = new URLSearchParams(search),
    id = q.get('report'),
    version = q.get('version'),
    comparison = q.get('comparison');
  if (
    new Set(q.keys()).size !== [...q].length ||
    [...q.keys()].some((k) => !['report', 'version', 'comparison', 'send'].includes(k)) ||
    !id ||
    !version ||
    !/^[1-9][0-9]{0,9}$/.test(version)
  )
    return null;
  const input = deliveryRequestSchema.safeParse({
    email: 'ref@example.invalid',
    report: { id, version: Number(version) },
    offers: false,
    notices: {},
    comparisonRevision: comparison,
  });
  return input.success ? { id, version: Number(version), comparisonRevision: comparison } : null;
}
export function emailError(raw: string) {
  const email = raw.trim();
  return /[\r\n\0]/.test(raw) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254
    ? 'Enter a complete email address.'
    : '';
}
export function deliveryChoice(
  form: DeliveryForm,
  ref: DeliveryReference | null,
  notices: { report: string; offers: string },
): Failure | { readonly ok: true; readonly request: DeliveryChoice } {
  const errors: Record<string, string> = {},
    email = form.email.trim();
  if (emailError(form.email)) errors.email = emailError(form.email);
  if (!form.report && !form.offers) errors.purposes = 'Choose a report, offers, or both.';
  if (form.report && !ref)
    errors.report = 'Open a saved report version before requesting its delivery.';
  const bound = {
    ...(form.report ? { report: notices.report } : {}),
    ...(form.offers ? { offers: notices.offers } : {}),
  };
  const input = {
    email,
    report: form.report && ref ? { id: ref.id, version: ref.version } : null,
    offers: form.offers,
    notices: bound,
  };
  const parsed = contactRequestSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0]);
      if (field === 'notices')
        errors.notices = 'Current notice references are unavailable. Reload the notices.';
      else if (field === 'report') errors.report = 'Open a valid saved report version.';
      else if (field === 'email') errors.email = 'Enter a complete email address.';
      else errors.purposes = 'Review the selected purposes.';
    }
    return { ok: false, errors };
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    request: form.report
      ? { kind: 'delivery', input: { ...parsed.data, comparisonRevision: ref!.comparisonRevision } }
      : { kind: 'offers', input: parsed.data },
  };
}
export function deliveryPresentation(view: DeliveryView, now = Date.now()) {
  const copy: Record<DeliveryView['state'], readonly [string, string]> = {
    scheduled: [
      'Scheduled',
      'The request is queued. The server decides whether cancellation is still available.',
    ],
    dispatching: [
      'Already sending',
      'The request has been claimed for sending. We cannot promise recall.',
    ],
    accepted: [
      'Provider accepted',
      'Provider acceptance is not proof of delivery to the recipient.',
    ],
    uncertain: [
      'Send outcome unknown',
      'Check this request again. Do not create a new request to bypass an uncertain send.',
    ],
    failed: [
      'Send failed',
      'The service recorded a definite failure. This does not mean a message was delivered.',
    ],
    manual_review: [
      'Needs review',
      'The service needs an operator review. A new request would not resolve this status.',
    ],
    cancelled: [
      'Cancelled',
      'The queued report request was cancelled. Separate verified email preferences are unchanged.',
    ],
    suppressed: [
      'Stopped by current permissions',
      'Current permission or suppression checks prevented this report send.',
    ],
  };
  return {
    title: copy[view.state][0],
    detail: copy[view.state][1],
    canCancel: view.state === 'scheduled',
    deadlinePassed: Date.parse(view.cancelDeadline) <= now,
  };
}
export const proofPaths = {
  verify: '/preview/email-confirmation',
  unsubscribe: '/preview/email-preferences',
  privacy: '/preview/privacy-request',
} as const;
export function privateProof(raw: string, kind: keyof typeof proofPaths, origin: string) {
  try {
    let token = raw.trim();
    if (token.startsWith('#')) token = decodeURIComponent(token.slice(1));
    else if (token.includes('://')) {
      const u = new URL(token);
      if (
        u.origin !== new URL(origin).origin ||
        u.username ||
        u.password ||
        u.search ||
        u.pathname !== proofPaths[kind] ||
        !u.hash
      )
        return null;
      token = decodeURIComponent(u.hash.slice(1));
    }
    return checkedProof(token, kind);
  } catch {
    return null;
  }
}
export function proofLink(origin: string, kind: keyof typeof proofPaths, proof: string) {
  const u = new URL(origin);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password)
    throw Error('Invalid link origin');
  return u.origin + proofPaths[kind] + '#' + checkedProof(proof, kind);
}
export function rightsBody(raw: {
  kind: string;
  jurisdiction: string;
  acknowledged: boolean;
}): Failure | { readonly ok: true; readonly input: OwnerRightsInput } {
  const parsed = ownerRightsSchema.safeParse({
      kind: raw.kind,
      jurisdiction: raw.jurisdiction.trim(),
    }),
    errors: Record<string, string> = {};
  if (!parsed.success) {
    if (!['access', 'delete', 'correct', 'restrict', 'opt_out', 'export'].includes(raw.kind))
      errors.kind = 'Choose the request type.';
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(raw.jurisdiction.trim()))
      errors.jurisdiction = 'Enter your privacy region code.';
  }
  if (['delete', 'restrict', 'opt_out'].includes(raw.kind) && !raw.acknowledged)
    errors.acknowledged = 'Acknowledge the effect of this request before submitting.';
  return parsed.success && !Object.keys(errors).length
    ? { ok: true, input: parsed.data }
    : { ok: false, errors };
}
