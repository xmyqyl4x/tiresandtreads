import './browser-runtime.ts';
import * as z from 'zod/mini';
import { resourceId, rightsKind } from './delivery-privacy-inputs.ts';
const timestamp = z
  .string()
  .check(z.refine((v) => Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v));
export const deliveryView = z.strictObject({
  id: resourceId,
  revision: z.string().check(z.regex(/^[1-9][0-9]{0,18}$/)),
  state: z.enum([
    'scheduled',
    'cancelled',
    'suppressed',
    'dispatching',
    'accepted',
    'uncertain',
    'failed',
    'manual_review',
  ]),
  sendAfter: timestamp,
  cancelDeadline: timestamp,
});
export const contactReceipt = z.strictObject({
  schema_version: z.literal(1),
  resource_id: resourceId,
  status: z.literal('accepted'),
  result_revision: z.optional(z.string().check(z.regex(/^[1-9][0-9]{0,18}$/))),
});
export const emailPreferenceView = z.strictObject({
  purpose: z.enum(['report', 'offers']),
  status: z.enum(['unknown', 'pending', 'confirmed', 'withdrawn', 'expired']),
});
export const confirmationView = z.extend(emailPreferenceView, {
  expiresAt: timestamp,
  expired: z.boolean(),
});
export const privacyStatusView = z
  .strictObject({
    id: resourceId,
    kind: rightsKind,
    status: z.enum(['pending', 'verified', 'processing', 'completed', 'rejected', 'manual_review']),
    dueAt: timestamp,
    completedAt: z.nullable(timestamp),
  })
  .check(z.refine((v) => (v.status === 'completed') === (v.completedAt !== null)));
export const privacyProofView = z.strictObject({
  id: resourceId,
  proof: z.string().check(z.maxLength(256)),
});
export type DeliveryView = z.infer<typeof deliveryView>;
export type ContactReceipt = z.infer<typeof contactReceipt>;
export type PrivacyStatusView = z.infer<typeof privacyStatusView>;
export type ConfirmationView = z.infer<typeof confirmationView>;
export type EmailPreferenceView = z.infer<typeof emailPreferenceView>;
export type DeliveryReceipt =
  | { readonly kind: 'delivery'; readonly view: DeliveryView }
  | { readonly kind: 'offers'; readonly view: ContactReceipt };
export function checkedProof(raw: string, kind: 'verify' | 'unsubscribe' | 'privacy') {
  const p = raw.split('.');
  if (
    raw.length > 256 ||
    p.length !== 4 ||
    p[0] !== kind ||
    !/^[A-Za-z0-9_-]{1,80}$/.test(p[1] ?? '') ||
    !resourceId.safeParse(p[2]).success ||
    !/^[a-f0-9]{64}$/.test(p[3] ?? '')
  )
    throw Error('Invalid private proof');
  return raw;
}
