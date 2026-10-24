// Versioned wire shapes only. Public endpoints/decoders and authorization remain S3/S4 work.
export interface MoneyV1 {
  readonly schemaVersion: 1;
  readonly minor: string;
  readonly currency: string;
}
export type EvidenceV1<T> =
  | Readonly<{ state: 'known'; value: T }>
  | Readonly<{
      state: 'unknown';
      reason: 'not_supplied' | 'not_measured' | 'unverified' | 'not_applicable';
    }>;
export interface ErrorEnvelopeV1 {
  readonly code: string;
  readonly messageKey: string;
  readonly fieldErrors: Readonly<Record<string, string>>;
  readonly retryable: boolean;
  readonly requestId: string;
}
