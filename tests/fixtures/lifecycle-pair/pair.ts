import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { digest } from '../../../scripts/database/inventory.ts';
import {
  readLifecycleRequest,
  inspectLifecycle,
  lifecycleSourceDigest,
  withReadOnlyLifecycle,
  type LifecycleBaseline,
} from '../lifecycle-validation/reader.ts';
import { receiptLedger, pairCompatible, type Inspection, type PairReceipt } from './contract.ts';

const flags = { hostedAccepted: false, productActivation: false, runtimeAdmission: false } as const;
type Reason =
  'configuration' | 'busy' | 'lock' | 'unavailable' | 'pair' | 'receipt' | 'invalidated';
type Outcome = Readonly<{
  scope: 'disposable-local-pair';
  status: 'validated' | 'observed' | 'refused';
  reason?: Reason;
  receipt?: PairReceipt;
  observations?: readonly Inspection[];
  hostedAccepted: false;
  productActivation: false;
  runtimeAdmission: false;
}>;

export function createPairedLifecycle(
  raw: unknown,
  baselineInput: LifecycleBaseline,
  identity: unknown,
) {
  // Copy once: callers cannot redirect a pending request by mutating its inputs.
  let inputs: { app: unknown; cms: unknown };
  let baseline: LifecycleBaseline;
  let app: ReturnType<typeof readLifecycleRequest>;
  let cms: ReturnType<typeof readLifecycleRequest>;
  let ledger: ReturnType<typeof receiptLedger>;
  try {
    if (
      !raw ||
      typeof raw !== 'object' ||
      Array.isArray(raw) ||
      Object.keys(raw).length !== 2 ||
      !('app' in raw) ||
      !('cms' in raw)
    )
      throw Error();
    inputs = structuredClone(raw) as typeof inputs;
    baseline = structuredClone(baselineInput);
    app = readLifecycleRequest(inputs.app, process.env);
    cms = readLifecycleRequest(inputs.cms, process.env);
    if (
      app.target !== 'app' ||
      cms.target !== 'cms' ||
      app.phase !== cms.phase ||
      app.project !== cms.project ||
      app.project !== baseline.project ||
      baseline.sourceDigest !== lifecycleSourceDigest()
    )
      throw Error();
    if (
      !identity ||
      typeof identity !== 'object' ||
      Array.isArray(identity) ||
      Object.keys(identity).length !== 3 ||
      Object.keys(identity).some(
        (k) => !['operationId', 'releaseDigest', 'credentialGeneration'].includes(k),
      )
    )
      throw Error();
    const ids = identity as {
      operationId: string;
      releaseDigest: string;
      credentialGeneration: string;
    };
    ledger = receiptLedger({
      project: app.project,
      fixtureId: randomBytes(16).toString('hex'),
      ...ids,
      phase: app.phase,
      sourceDigest: baseline.sourceDigest,
      baselineDigest: digest(baseline),
      targetsDigest: digest(
        [app, cms].map((s) => ({
          host: s.connection.host,
          port: 5432,
          owner: s.connection.user,
          database: s.database,
          caDigest: digest(s.connection.ssl.ca),
        })),
      ),
    });
  } catch {
    throw Error('Invalid disposable paired lifecycle configuration');
  }
  let busy = false,
    closed = false;
  const refused = (reason: Reason): Outcome =>
    Object.freeze({ scope: 'disposable-local-pair', status: 'refused', reason, ...flags });
  function current() {
    try {
      return (
        !closed &&
        baseline.project === process.env.ISOLATED_TEST_PROJECT &&
        baseline.sourceDigest === lifecycleSourceDigest() &&
        readLifecycleRequest(inputs.app, process.env).project === app.project &&
        readLifecycleRequest(inputs.cms, process.env).project === cms.project
      );
    } catch {
      return false;
    }
  }
  async function observe(): Promise<{ reason?: Reason; reports?: Inspection[] }> {
    try {
      return await withReadOnlyLifecycle(app, async (client) => {
        // Dedicated app-DB transaction lock shared by participating fixture
        // coordinators, including other processes. No durable lock/journal table.
        const lock = await client.query('SELECT pg_try_advisory_xact_lock(7724046, 1) AS acquired');
        if (!lock.rows[0]?.acquired) return { reason: 'lock' };
        const reports: Inspection[] = [];
        for (const target of ['app', 'cms'] as const)
          reports.push(await inspectLifecycle(inputs[target], process.env, baseline));
        // A lost/timed-out lock session must not return apparently protected reads.
        await client.query('SELECT 1');
        return { reports };
      });
    } catch {
      return { reason: 'unavailable' };
    }
  }
  async function run(candidate?: { receipt: unknown }): Promise<Outcome> {
    if (busy) return refused('busy');
    busy = true;
    try {
      // Any attempted handoff consumes the old evidence, including a failure.
      if (candidate && !ledger.consume(candidate.receipt, performance.now()))
        return refused('receipt');
      const ticket = ledger.begin(performance.now());
      if (!current()) return refused('configuration');
      const { reason, reports } = await observe();
      if (!current() || !ledger.isCurrent(ticket)) return refused('invalidated');
      if (reason) return refused(reason);
      if (!reports || !pairCompatible(reports, app.phase))
        return Object.freeze({ ...refused('pair'), observations: reports ?? [] });
      if (candidate)
        return Object.freeze({
          scope: 'disposable-local-pair',
          status: 'observed',
          observations: reports,
          ...flags,
        });
      const receipt = ledger.issue(ticket, reports, performance.now());
      return receipt
        ? Object.freeze({ scope: 'disposable-local-pair', status: 'validated', receipt, ...flags })
        : refused('invalidated');
    } finally {
      busy = false;
    }
  }
  return Object.freeze({
    validate: () => run(),
    handoff: (receipt: unknown) => run({ receipt }),
    invalidate: () => ledger.invalidate(),
    close: () => {
      closed = true;
      ledger.invalidate();
    },
  });
}
