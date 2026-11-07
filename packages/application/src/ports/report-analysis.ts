import type { Id, Revision } from '../../../domain/src/values/core.ts';
import type { AnalysisPacket } from '../../../domain/src/analysis-policy.ts';
import type { AIRequest, AIScope, AIPolicy } from '../../../domain/src/entities/analysis.ts';
import type { TransactionContext as Tx } from './transactions.ts';
import type { Owner, KeyDigest } from './private-records.ts';
export interface AnalysisConfiguration {
  readonly policyId: Id<'ai_policy'>;
  readonly provider: string;
  readonly model: string;
  readonly prompt: string;
  readonly schema: string;
  readonly validator: string;
  readonly canonical: string;
  readonly configurationHash: string;
}
export interface AnalysisReportEvidence {
  readonly market: string;
  readonly locale: string;
  readonly snapshotHash: string;
  readonly bundleId: string;
  readonly ruleVersion: string;
  readonly engineVersion: string;
  readonly input: unknown;
  readonly output: unknown;
  readonly sources: readonly Readonly<{ id: string; validUntil: string }>[];
  readonly subjectRevision: Revision;
  readonly attachmentRevision: bigint;
}
export interface AnalysisWork {
  readonly requestId: Id<'ai_request'>;
  readonly reportId: Id<'report'>;
  readonly version: number;
  readonly ownerId: Id<'subject'>;
  readonly jobId: Id<'job'>;
  readonly packet: AnalysisPacket;
  readonly expectedAttachment: bigint;
  readonly configuration: AnalysisConfiguration;
}
export interface ReportAnalysisRepository {
  owner(tx: Tx, keys: readonly KeyDigest[]): Promise<Owner | null>;
  subjectRevision(tx: Tx, owner: Id<'subject'>): Promise<Revision>;
  evidence(
    tx: Tx,
    owner: Id<'subject'>,
    report: Id<'report'>,
    version: number,
  ): Promise<AnalysisReportEvidence | null>;
  configuration(tx: Tx, policy: Id<'ai_policy'>): Promise<AnalysisConfiguration | null>;
  scope(
    tx: Tx,
    owner: Id<'subject'>,
    policy: Id<'ai_policy'>,
    key: string,
  ): Promise<AIScope | null>;
  enqueue(tx: Tx, input: Omit<AnalysisWork, 'jobId' | 'configuration'>): Promise<AnalysisWork>;
  work(tx: Tx, request: Id<'ai_request'>): Promise<AnalysisWork | null>;
  current(tx: Tx, work: AnalysisWork): Promise<boolean>;
  output(tx: Tx, work: AnalysisWork): Promise<Readonly<Record<string, unknown>> | null>;
  withdraw(tx: Tx, scope: Id<'ai_scope'>): Promise<boolean>;
}
export interface AnalysisUsage {
  readonly providerRequestId: string | null;
  readonly inputTokens: bigint | null;
  readonly outputTokens: bigint | null;
  readonly costMinor: bigint | null;
}
export type AnalysisProviderResult = Readonly<
  AnalysisUsage &
    (
      | { state: 'complete'; output: unknown }
      | { state: 'refused' | 'incomplete' | 'timeout' | 'unavailable' | 'invalid_output' }
    )
>;
export interface AnalysisProvider {
  analyze(
    input: Readonly<{
      packet: AnalysisPacket;
      configuration: AnalysisConfiguration;
      deadlineMs: number;
      attempt: Id<'ai_attempt'>;
    }>,
  ): Promise<AnalysisProviderResult>;
}
export interface StructuredAnalysisTransport {
  send(
    input: Readonly<{
      packet: AnalysisPacket;
      configuration: AnalysisConfiguration;
      schema: Readonly<Record<string, unknown>>;
      strict: true;
      store: false;
      tools: readonly never[];
      maxOutputTokens: 4096;
      maxInputTokens: 65536;
      signal: AbortSignal;
    }>,
  ): Promise<
    Readonly<AnalysisUsage & { state: 'complete' | 'refused' | 'incomplete'; output?: unknown }>
  >;
}
export interface AnalysisAdmissionPlan {
  readonly configurationHash: string;
  readonly currency: 'USD';
  readonly inputCeiling?: bigint;
  readonly outputCeiling?: bigint;
  readonly windows: readonly Readonly<{ id: Id<'ai_budget'>; amountMinor: bigint }>[];
}
export interface AnalysisAdmission {
  plan(
    tx: Tx,
    policy: AIPolicy,
    scope: AIScope,
    request: AIRequest,
  ): Promise<AnalysisAdmissionPlan | null>;
}
export interface AnalysisStatus {
  readonly id: Id<'ai_request'> | null;
  readonly state: 'not_requested' | 'pending' | 'available' | 'unavailable' | 'expired';
  readonly reportId: Id<'report'>;
  readonly version: number;
  readonly output: Readonly<Record<string, unknown>> | null;
}
