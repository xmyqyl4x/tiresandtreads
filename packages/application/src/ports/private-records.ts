import type { Id, Instant, Revision } from '../../../domain/src/values/index.ts';
import type { JsonObject } from './catalog-records.ts';
export type { JsonObject } from './catalog-records.ts';
// Internal cryptographic representations. Cryptography and key custody belong to integrations.
export interface KeyDigest {
  readonly keyVersion: string;
  readonly digest: string;
}
export interface Envelope {
  readonly keyVersion: string;
  readonly hex: string;
}
export interface Owner {
  readonly subjectId: Id<'subject'>;
  readonly sessionId: Id<'owner_session'>;
}
export interface Contact {
  readonly id: Id<'contact'>;
  readonly subjectId: Id<'subject'>;
  readonly revision: Revision;
  readonly verifiedAt: Instant | null;
  readonly status: 'active' | 'restricted' | 'pending_deletion';
  readonly envelope: Envelope;
}
export interface Version {
  readonly reportId: Id<'report'>;
  readonly version: number;
  readonly baseVersion: number | null;
  readonly bundleId: Id<'bundle'>;
  readonly ruleVersionId: Id<'rule'>;
  readonly engineVersion: string;
  readonly schemaVersion: 1;
  readonly input: JsonObject;
  readonly output: JsonObject;
}
export interface ReportItem {
  readonly key: string;
  readonly skuId: Id<'tire_sku'> | null;
  readonly kind: 'picked' | 'excluded';
  readonly rank: number | null;
  readonly snapshot: JsonObject;
}
export interface Draft {
  readonly baseVersion: number;
  readonly schemaVersion: 1;
  readonly input: JsonObject;
  readonly expiresAt: Instant;
  readonly revision: Revision;
}
export interface CompareItem {
  readonly slot: 1 | 2 | 3 | 4;
  readonly sourceKey: string;
  readonly kind: 'catalog' | 'quote';
  readonly snapshot: JsonObject;
}
export interface Comparison {
  readonly revision: Revision;
  readonly scenario: JsonObject;
  readonly items: readonly CompareItem[];
}
export interface Quote {
  readonly id: Id<'quote'>;
  readonly reportId: Id<'report'>;
  readonly sourceKey: string;
  readonly skuId: Id<'tire_sku'> | null;
  readonly currency: string;
  readonly totalMinor: bigint;
  readonly quantity: number;
  readonly basis: 'per_tire' | 'set' | 'installed_set';
  readonly observedOn: string;
  readonly components: readonly JsonObject[];
  readonly expiresAt: Instant;
}
export interface SharedVersion {
  readonly capabilityId: Id<'report_capability'>;
  readonly reportId: Id<'report'>;
  readonly version: number;
  readonly versionBinding: number;
  readonly comparisonRevision: Revision | null;
}
export interface AssetGrant {
  readonly assetId: Id<'asset'>;
  readonly reportId: Id<'report'>;
  readonly version: number;
  readonly scope: 'owner' | 'shared';
  readonly sha256: string;
  readonly sizeBytes: bigint;
  readonly mimeType: string;
}
export type SendState =
  | 'scheduled'
  | 'cancelled'
  | 'suppressed'
  | 'dispatching'
  | 'accepted'
  | 'uncertain'
  | 'failed'
  | 'manual_review';
export interface Send {
  readonly id: Id<'send'>;
  readonly revision: Revision;
  readonly state: SendState;
  readonly ownerId: Id<'subject'> | null;
  readonly contactId: Id<'contact'> | null;
  readonly reportId: Id<'report'> | null;
  readonly reportVersion: number | null;
  readonly comparisonRevision: Revision | null;
  readonly provider: string;
  readonly providerKey: string;
  readonly sendAfter: Instant;
  readonly cancelDeadline: Instant;
  readonly templateId: Id<'template'>;
  readonly payloadAssetId: Id<'asset'> | null;
  readonly payloadHash: string | null;
}
