export function inspectPureSource(path: string, source: string): string[];
export function inspectProjection(source: string, name: string, fields: readonly string[]): void;
export interface DataAccessAudit {
  readonly pinnedSources: number;
  readonly pureModules: number;
  readonly repositoryPorts: number;
  readonly safeProjections: number;
  readonly sourceSha256: Readonly<Record<string, string>>;
  readonly actualS1Approval: false;
  readonly actualS2Approval: false;
  readonly servicesStarted: false;
  readonly wireContractsApproved: false;
  readonly providerDispatches: 0;
  readonly actualRecipientNotifications: 0;
  readonly casesClosed: 0;
  readonly gatesClosed: 0;
}
export function auditP2DataAccess(load?: (path: string) => string): Readonly<DataAccessAudit>;
