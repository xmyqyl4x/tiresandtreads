import type { Id } from '../../../domain/src/values/core.ts';
import type {
  PilotAudience,
  PilotCandidate,
  PilotDecision,
} from '../../../domain/src/offer-matching.ts';
import type { CouponAssignment } from '../../../domain/src/entities/partner.ts';
import type { TransactionContext as Tx } from './transactions.ts';
import type { CodeSeal } from './partner-services.ts';
import type { Envelope, KeyDigest } from './private-records.ts';
import type { DeliveryDocument } from './delivery-services.ts';
export type PilotLocation = Pick<PilotAudience, 'region' | 'postal' | 'latitude' | 'longitude'>;
export interface PilotRequest {
  readonly includeOffers: boolean;
  readonly itemKey: string;
  readonly adult: boolean;
  readonly quantity: number;
  readonly region: string | null;
  readonly postal: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
}
export interface PilotPolicy {
  readonly version: string;
  readonly timeZone: string;
  readonly provider: string;
  readonly fixture: boolean;
  readonly offersNotice: Id<'notice'>;
  readonly reportNotice: Id<'notice'>;
  readonly consentPolicy: string;
  readonly creditUnits: bigint;
}
export interface PilotLease {
  readonly sendId: Id<'send'>;
  readonly token: Id<'lease'>;
  readonly generation: string;
  readonly state: string;
}
export interface PilotContext {
  readonly policyVersion: string;
  readonly sendId: Id<'send'>;
  readonly ownerId: Id<'subject'>;
  readonly recipientId: Id<'subject'>;
  readonly contactId: Id<'contact'>;
  readonly provider: string;
  readonly providerKey: string;
  readonly permissionRevision: string;
  readonly reportAllowed: boolean;
  readonly offersAllowed: boolean;
  readonly audience: PilotAudience;
  readonly document: DeliveryDocument | null;
  readonly contact: Envelope;
  readonly geo: Readonly<{ box: Envelope; digest: string }>;
}
export interface PilotOffer extends PilotCandidate {
  readonly poolId: Id<'coupon_pool'>;
  readonly mode: 'shared' | 'unique' | 'generated';
  readonly prefix: string | null;
  readonly caps: readonly Readonly<{ id: Id<'offer_cap'>; kind: string; units: bigint }>[];
}
export interface PilotHeld {
  readonly assignment: CouponAssignment;
  readonly offer: PilotOffer;
  readonly seal: CodeSeal;
}
export interface PilotMail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly pdf: string | null;
  readonly commercial: boolean;
  readonly stream: 'report' | 'commercial';
  readonly headers: Readonly<Record<string, string>>;
  readonly unsubscribeUrl: string | null;
  readonly fixture: boolean;
}
export interface PilotPayload {
  readonly recipient: string;
  readonly mail: PilotMail;
}
export interface PilotProvider {
  readonly name: string;
  readonly fixture: boolean;
  send(
    key: string,
    payload: PilotPayload,
  ): Promise<
    Readonly<{
      outcome: 'accepted' | 'definitive_rejection' | 'uncertain';
      messageId: string | null;
    }>
  >;
}
export interface PilotRenderer {
  readonly fixture: boolean;
  render(
    context: PilotContext,
    offers: readonly Readonly<{ offer: PilotOffer; code: string; reasons: readonly string[] }>[],
  ): Promise<PilotMail>;
}
export interface PilotRepository {
  authorize(tx: Tx, keys: readonly KeyDigest[], send: Id<'send'>): Promise<void>;
  capture(
    tx: Tx,
    keys: readonly KeyDigest[],
    sendId: Id<'send'>,
    request: PilotRequest,
    digest: string,
    policy: PilotPolicy,
    location: Envelope,
    locationDigest: string,
  ): Promise<void>;
  acquire(tx: Tx, sendId: Id<'send'>): Promise<PilotLease | null>;
  context(tx: Tx, lease: PilotLease, policy: PilotPolicy): Promise<PilotContext>;
  candidates(tx: Tx, lease: PilotLease, policy: PilotPolicy): Promise<readonly PilotOffer[]>;
  reserve(
    tx: Tx,
    lease: PilotLease,
    context: PilotContext,
    offers: readonly PilotOffer[],
    decisions: readonly PilotDecision[],
    generated: ReadonlyMap<string, CodeSeal>,
    policy: PilotPolicy,
  ): Promise<void>;
  held(tx: Tx, lease: PilotLease, policy: PilotPolicy): Promise<readonly PilotHeld[]>;
  trim(tx: Tx, lease: PilotLease, keep: readonly string[]): Promise<void>;
  reservePayload(tx: Tx, lease: PilotLease, asset: Id<'asset'>): Promise<void>;
  claim(
    tx: Tx,
    lease: PilotLease,
    keep: readonly string[],
    permissionRevision: string,
    reportIncluded: boolean,
    payload: Envelope,
    digest: string,
    asset: Id<'asset'>,
    objectHash: string,
    policy: PilotPolicy,
    location: PilotLocation,
    locationDigest: string,
  ): Promise<boolean>;
  finish(
    tx: Tx,
    lease: PilotLease,
    outcome: 'accepted' | 'definitive_rejection' | 'uncertain',
    messageId: string | null,
  ): Promise<void>;
  stop(tx: Tx, lease: PilotLease): Promise<void>;
  retry(tx: Tx, lease: PilotLease): Promise<void>;
  cancel(tx: Tx, keys: readonly KeyDigest[], sendId: Id<'send'>): Promise<void>;
}
