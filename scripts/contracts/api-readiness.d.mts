export interface LocalEndpointInventory {
  readonly operationId: string;
  readonly method: string;
  readonly path: string;
  readonly actor: 'public' | 'owner' | 'staff' | 'callback' | 'capability';
  readonly category: string;
  readonly service: string;
  readonly useCases: readonly string[];
  readonly databaseProof: string;
  readonly requestSchema: string;
  readonly responseSchema: string;
  readonly idempotencyRequired: boolean;
  readonly maxBodyBytes: number;
  readonly successStatuses: readonly string[];
}
export function localApiReadiness(): {
  readonly schemaVersion: 1;
  readonly scope: 'local-development-only';
  readonly status: 'local-contracts-available';
  readonly S3Accepted: false;
  readonly S4Accepted: false;
  readonly G0Accepted: false;
  readonly publicActivation: false;
  readonly hostedProvisioning: false;
  readonly purchases: false;
  readonly actualNotifications: false;
  readonly clients: readonly string[];
  readonly fullJourneyProof: string;
  readonly actualHostProof: string;
  readonly admissionProof: string;
  readonly remainingAcceptance: readonly string[];
  readonly inventory: readonly LocalEndpointInventory[];
};
