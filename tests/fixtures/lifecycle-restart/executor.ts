import pg from 'pg';
import { createPairedLifecycle } from '../lifecycle-pair/pair.ts';
import { lifecycleDatabases, type LifecycleTarget } from '../lifecycle-validation/reader.ts';
import {
  readExecutorPlan,
  executorFlags,
  type ExecutorPlan,
  type ExecutorEvent,
} from './protocol.ts';

// A private test child, not a CLI or service. No arguments, file input or target override.
if (process.argv.length !== 2 || !process.send) {
  process.stderr.write('Disposable executor refused\n');
  process.exit(64);
}
let initialized = false;
let continuePaused: (() => void) | undefined;
process.on('disconnect', () => process.exit(72));
const initialization = setTimeout(() => process.exit(64), 5000);
process.on('message', (message: unknown) => {
  if (!initialized) {
    initialized = true;
    clearTimeout(initialization);
    void execute(message).catch(() => {
      process.stderr.write('Disposable executor refused\n');
      process.exit(64);
    });
  } else if (
    message &&
    typeof message === 'object' &&
    Object.keys(message).length === 1 &&
    'kind' in message &&
    message.kind === 'continue' &&
    continuePaused
  ) {
    const resume = continuePaused;
    continuePaused = undefined;
    resume();
  } else {
    process.stderr.write('Disposable executor refused\n');
    process.exit(64);
  }
});

async function execute(raw: unknown) {
  const plan = readExecutorPlan(raw, process.env),
    pair = createPairedLifecycle(plan.inputs, plan.baseline, plan.identity);
  const reads = { app: 0, cms: 0 },
    importReads = { app: 0, cms: 0 };
  const targets = new WeakMap<pg.Client, LifecycleTarget>();
  const original = pg.Client.prototype.query;
  let armed = false,
    paused = false;
  let seed: NonNullable<Awaited<ReturnType<typeof pair.validate>>['receipt']>;
  async function send(event: ExecutorEvent) {
    await new Promise<void>((resolve, reject) =>
      process.send!(event, (error) => (error ? reject(Error('IPC unavailable')) : resolve())),
    );
  }
  async function pause(point: ExecutorPlan['point']) {
    if (!armed || paused || point !== plan.point || point === 'none') return;
    paused = true;
    // Install continuation before announcing the checkpoint, so a fast parent cannot race it.
    const pending = new Promise<void>((resolve) => {
      continuePaused = resolve;
    });
    await send({
      scope: 'disposable-local-restart',
      kind: 'checkpoint',
      processId: process.pid,
      point,
      receipt: seed,
      reads: { ...reads },
      ...executorFlags,
    });
    await pending;
  }
  // Instrument only this process. All original query calls still execute on real PG;
  // pauses happen after the actual lock/rollback result, never by fabricating a report.
  pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
    const execution = Reflect.apply(original, this, args) as Promise<pg.QueryResult>;
    return (async () => {
      const result = await execution,
        sql = args[0];
      if (
        typeof sql === 'string' &&
        sql.startsWith('SELECT current_user AS actor,session_user AS session_actor,')
      ) {
        const database = result.rows[0]?.database;
        if (database === lifecycleDatabases.app) targets.set(this, 'app');
        if (database === lifecycleDatabases.cms) targets.set(this, 'cms');
      }
      if (
        sql === 'SELECT pg_try_advisory_xact_lock(7724046, 1) AS acquired' &&
        result.rows[0]?.acquired
      )
        await pause(plan.point === 'handoff-locked' ? 'handoff-locked' : 'validation-locked');
      if (sql === 'ROLLBACK' && targets.has(this)) {
        const target = targets.get(this)!;
        targets.delete(this);
        reads[target]++;
        await pause(target === 'app' ? 'app-read' : 'cms-read');
      }
      return result;
    })();
  } as typeof pg.Client.prototype.query;
  try {
    let importedReceiptRejected: boolean | null = null;
    if (plan.kind === 'restart') {
      importedReceiptRejected = (await pair.handoff(plan.previousReceipt)).reason === 'receipt';
      Object.assign(importReads, reads);
    }
    let validation = await pair.validate();
    if (plan.kind === 'interrupt' && validation.receipt) {
      seed = validation.receipt;
      armed = true;
      if (plan.point === 'receipt') await pause('receipt');
      else if (plan.point !== 'handoff-locked') validation = await pair.validate();
    }
    const handoff = validation.receipt ? await pair.handoff(validation.receipt) : null;
    await send({
      scope: 'disposable-local-restart',
      kind: 'result',
      processId: process.pid,
      importedReceiptRejected,
      importReads,
      validationStatus: validation.status === 'validated' ? 'validated' : 'refused',
      handoffStatus: handoff ? (handoff.status === 'observed' ? 'observed' : 'refused') : 'absent',
      reads: { ...reads },
      ...executorFlags,
    });
  } finally {
    pair.close();
    pg.Client.prototype.query = original;
  }
  // Remove the orphan handler only after all original client finally blocks ran.
  process.removeAllListeners('disconnect');
  process.disconnect!();
}
