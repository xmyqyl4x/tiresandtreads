export interface GateRow {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly records: readonly {
    readonly kind: string;
    readonly path: string;
    readonly reviewer: string;
  }[];
}
export interface ServiceRegister {
  readonly schemaVersion: number;
  readonly stage: string;
  readonly gates: readonly GateRow[];
  readonly acceptanceRequested: boolean;
  readonly endpointImplementationAllowed: boolean;
  readonly publicActivation: boolean;
}
export interface GoldenPacket {
  readonly scenarioCount: number;
  readonly reviewStatus: string;
  readonly scenarios: readonly {
    readonly id: string;
    readonly specialistReview?: {
      readonly status: string;
      readonly reviewer: string | null;
      readonly reviewedAt: string | null;
    };
  }[];
}
export interface GateEvidence {
  readonly stage: 'S3';
  readonly accepted: boolean;
  readonly endpointImplementationAllowed: boolean;
  readonly publicActivation: boolean;
  readonly pendingGates: readonly string[];
  readonly draftGoldenScenarios: number;
  readonly actualSpecialistReviews: number;
}
export function evaluateServiceGate(register: ServiceRegister, packet: GoldenPacket): GateEvidence;
export function inspectServiceRegister(root?: string): GateEvidence & {
  readonly inventoryStatus: string;
  readonly components: number;
  readonly serviceModules: number;
  readonly modules: readonly {
    readonly file: string;
    readonly card: string;
    readonly exports: readonly string[];
  }[];
};
