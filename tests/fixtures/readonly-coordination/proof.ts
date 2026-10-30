import type pg from 'pg';
import { randomBytes } from 'node:crypto';
import { readLifecycleRequest, withReadOnlyLifecycle } from '../lifecycle-validation/reader.ts';
import { readCoordinationPlan, refused, evidenceFlags } from './contract.ts';

// Fixed disposable SQL only. No dispatcher, caller SQL/key/PID, migration or provider import.
const sql = {
  acquire: 'SELECT pg_try_advisory_lock(7724054,1) AS acquired',
  inner: 'SELECT pg_advisory_xact_lock(7724004,1)',
  read: 'SELECT 1 AS observed',
  slow: 'SELECT pg_sleep(0.65), 1 AS observed',
} as const;
type Query = keyof typeof sql;
type Identity = Readonly<{
  pid: number;
  database: string;
  role: string;
  application: string;
  readOnly: true;
  tls: true;
}>;
const observed = { opened: 0, ended: 0 };
export const coordinationDiagnostics = () => Object.freeze({ ...observed });

async function channel(input: unknown, application: string) {
  const settings = readLifecycleRequest(input, process.env);
  let client: pg.Client | undefined,
    live = false,
    stopped = false;
  let release!: () => void;
  const stop = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ready!: (identity: Identity) => void, reject!: (error: Error) => void;
  const identity = new Promise<Identity>((resolve, fail) => {
    ready = resolve;
    reject = fail;
  });
  const finished = withReadOnlyLifecycle(settings, async (c) => {
    client = c;
    observed.opened++;
    c.once('end', () => {
      observed.ended++;
      live = false;
    });
    c.on('error', () => {
      live = false;
      release();
    });
    await c.query("SELECT set_config('application_name',$1,true)", [application]);
    const row = (
      await c.query(
        "SELECT pg_backend_pid() AS pid,current_database() AS database,current_user AS role,current_setting('transaction_read_only') AS read_only,(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls",
      )
    ).rows[0];
    if (
      !Number.isInteger(row?.pid) ||
      row.pid < 1 ||
      row.database !== settings.database ||
      row.role !== settings.connection.user ||
      row.read_only !== 'on' ||
      row.tls !== true
    )
      refused();
    live = true;
    ready(
      Object.freeze({
        pid: row.pid,
        database: row.database,
        role: row.role,
        application,
        readOnly: true,
        tls: true,
      }),
    );
    await stop;
  }).catch(() => {
    live = false;
    reject(Error('Read-only coordination proof refused'));
  });
  const facts = await identity;
  return Object.freeze({
    facts,
    live: () => live && !stopped,
    async query(key: Query) {
      if (!live || stopped || !client) return { ok: false as const, reason: 'unavailable' };
      try {
        const result = await client.query(sql[key]);
        return { ok: true as const, acquired: result.rows[0]?.acquired === true };
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
        return { ok: false as const, reason: code === '55P03' ? 'lock-timeout' : 'unavailable' };
      }
    },
    async close() {
      stopped = true;
      live = false;
      release();
      await finished;
    },
  });
}

export async function openParticipant(raw: unknown) {
  const plan = readCoordinationPlan(raw, process.env);
  const coordinationTarget = plan.mode === 'common' ? 'app' : plan.origin;
  const nonce = randomBytes(8).toString('hex');
  let coordinator: Awaited<ReturnType<typeof channel>> | undefined;
  let work: Awaited<ReturnType<typeof channel>> | undefined;
  try {
    coordinator = await channel(
      plan.inputs[coordinationTarget],
      `tt-coordination-proof:${nonce}:coord`,
    );
    work = await channel(plan.inputs[plan.origin], `tt-coordination-proof:${nonce}:work`);
  } catch {
    await coordinator?.close();
    return refused();
  }
  // Captured immutable handles; public evidence never exposes a Client or credentials.
  const allocation = coordinator,
    reader = work;
  let phase: 'fresh' | 'acquiring' | 'held' | 'lost' | 'closed' = 'fresh';
  let busy = false,
    workQueries = 0;
  let closing: Promise<void> | undefined;
  const result = (
    status: 'held' | 'busy' | 'observed' | 'refused',
    reason: string,
    workCompleted = false,
  ) => Object.freeze({ scope: plan.scope, status, reason, workCompleted, ...evidenceFlags });
  const inScope = () => {
    try {
      return readCoordinationPlan(plan, process.env).project === plan.project;
    } catch {
      return false;
    }
  };
  const allowed = () => inScope() && phase === 'held' && allocation.live() && reader.live();
  function close() {
    phase = 'closed';
    closing ??= (async () => {
      await allocation.close();
      await reader.close();
    })();
    return closing;
  }
  async function read(key: 'read' | 'slow') {
    if (!allowed()) return result('refused', 'coordination-lost');
    if (busy) return result('refused', 'busy');
    busy = true;
    workQueries++;
    try {
      const outcome = await reader.query(key);
      if (!allowed()) {
        if (phase !== 'closed') phase = 'lost';
        return result('refused', 'coordination-lost', outcome.ok);
      }
      return outcome.ok ? result('observed', 'read-only', true) : result('refused', outcome.reason);
    } finally {
      busy = false;
    }
  }
  return Object.freeze({
    facts: () =>
      Object.freeze({
        coordinator: allocation.facts,
        work: reader.facts,
        mode: plan.mode,
        origin: plan.origin,
        phase,
        workQueries,
        ...evidenceFlags,
      }),
    async acquire() {
      if (!inScope() || phase !== 'fresh' || !allocation.live() || !reader.live())
        return result('refused', 'not-fresh');
      phase = 'acquiring';
      const outcome = await allocation.query('acquire');
      if (!outcome.ok || !inScope() || !allocation.live() || phase !== 'acquiring') {
        await close();
        return result('refused', 'unavailable');
      }
      if (!outcome.acquired) {
        await close();
        return result('busy', 'common-key-held');
      }
      phase = 'held';
      return result('held', 'cooperative-fixture-only');
    },
    async innerLock() {
      if (plan.mode !== 'common') return result('refused', 'control-mode');
      if (!allowed() || busy) return result('refused', 'coordination-lost');
      busy = true;
      try {
        const outcome = await allocation.query('inner');
        if (!outcome.ok) {
          await close();
          return result('refused', outcome.reason);
        }
        return allowed()
          ? result('observed', 'inner-lock-only')
          : result('refused', 'coordination-lost');
      } finally {
        busy = false;
      }
    },
    read: () => read('read'),
    slowRead: () => read('slow'),
    close,
  });
}
