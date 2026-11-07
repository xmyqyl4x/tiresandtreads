import type { Id } from '../../../domain/src/values/core.ts';
import type { AIScope, AIPolicy, AIRequest } from '../../../domain/src/entities/analysis.ts';
import type { GenericAnalysisPacket } from '../../../domain/src/analysis-reuse-policy.ts';
import type { TransactionContext as Tx } from './transactions.ts';
import type {
  AnalysisConfiguration,
  AnalysisProviderResult,
  AnalysisUsage,
} from './report-analysis.ts';
export interface GenericDefinition {
  readonly id: Id<'ai_definition'>;
  readonly policyId: Id<'ai_policy'>;
  readonly fact: GenericAnalysisPacket['fact'];
}
export interface GenericWork {
  readonly requestId: Id<'ai_request'>;
  readonly scopeId: Id<'ai_scope'>;
  readonly definitionId: Id<'ai_definition'>;
  readonly jobId: Id<'job'>;
  readonly packet: GenericAnalysisPacket;
  readonly configuration: AnalysisConfiguration;
}
export interface GenericAnalysisRepository {
  definition(tx: Tx, id: Id<'ai_definition'>): Promise<GenericDefinition | null>;
  scope(tx: Tx, definition: GenericDefinition, key: string): Promise<AIScope | null>;
  digest(
    tx: Tx,
    scope: AIScope,
    policy: AIPolicy,
    definition: GenericDefinition,
    parameters: Readonly<Record<string, string | null>>,
  ): Promise<string>;
  lookup(
    tx: Tx,
    scope: AIScope,
    digest: string,
    definition: Id<'ai_definition'>,
    pendingOnly?: boolean,
    maxAgeSeconds?: number,
  ): Promise<Readonly<{
    requestId: Id<'ai_request'>;
    output: Readonly<Record<string, unknown>> | null;
    pending: boolean;
  }> | null>;
  blocked(tx: Tx, scope: AIScope, digest: string): Promise<boolean>;
  enqueue(
    tx: Tx,
    request: AIRequest,
    definition: GenericDefinition,
    packet: GenericAnalysisPacket,
  ): Promise<GenericWork>;
  work(tx: Tx, id: Id<'ai_request'>): Promise<GenericWork | null>;
  current(tx: Tx, work: GenericWork): Promise<boolean>;
  touch(tx: Tx, scope: AIScope, digest: string): Promise<void>;
  refresh(tx: Tx): Promise<
    readonly Readonly<{
      definitionId: Id<'ai_definition'>;
      parameters: Readonly<Record<string, string | null>>;
      key: string;
    }>[]
  >;
  maintain(tx: Tx): Promise<void>;
}
export interface GenericAnalysisProvider {
  analyze(
    input: Readonly<{
      packet: GenericAnalysisPacket;
      configuration: AnalysisConfiguration;
      deadlineMs: number;
      attempt: Id<'ai_attempt'>;
    }>,
  ): Promise<AnalysisProviderResult>;
}
export interface GenericAnalysisTransport {
  send(
    input: Readonly<{
      packet: GenericAnalysisPacket;
      configuration: AnalysisConfiguration;
      schema: Readonly<Record<string, unknown>>;
      strict: true;
      store: false;
      tools: readonly never[];
      maxInputTokens: 65536;
      maxOutputTokens: 512;
      signal: AbortSignal;
    }>,
  ): Promise<
    Readonly<AnalysisUsage & { state: 'complete' | 'incomplete' | 'refused'; output?: unknown }>
  >;
}
export interface GenericAnalysisView {
  readonly state: 'available' | 'pending' | 'unavailable';
  readonly id: Id<'ai_request'> | null;
  readonly output: Readonly<Record<string, unknown>> | null;
}
