import { randomBytes } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import pg from 'pg';
import { budget, checkFacts } from '../tls-admission/contract.ts';
import { snapshot } from '../tls-admission/snapshot.ts';
import {
  descriptor,
  identity,
  sameIdentity,
  next,
  must,
  receipt,
  type Id,
  type Kind,
} from './contract.ts';
import { context, publicPlan, settings, live, ipc, profile } from './transport.ts';

const facts = `SELECT current_user AS actor,session_user AS session_actor,current_database() AS database,
 current_setting('server_version_num')::int AS version,current_setting('transaction_read_only') AS readonly,
 current_setting('transaction_isolation') AS isolation,(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls,
 pg_get_userbyid(datdba) AS owner,pg_backend_pid() AS pid,
 (SELECT backend_start::text FROM pg_stat_activity WHERE pid=pg_backend_pid()) AS start,
 current_database() AS database,current_user AS role,current_setting('application_name') AS application,
 'client backend'::text AS type FROM pg_database WHERE datname=current_database()`;
const begin =
  "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout='1s'; SET LOCAL lock_timeout='250ms'; SET LOCAL idle_in_transaction_session_timeout='1s'; SET LOCAL transaction_timeout='5s';";
type Handle = { db: pg.Client; ended: boolean; connected: boolean };
let abandoned = false;
let clients = 0;
const domainClients = [0, 0];
function equal(a: readonly unknown[], b: readonly unknown[]) {
  return [...a].sort().join(',') === [...b].sort().join(',');
}

// This is disposable support, not a production executor. The raw plan cannot
// select operations, credentials, PIDs, SQL, keys, roles or timeouts.
class Participant {
  readonly #start: number;
  readonly #participant = randomBytes(8).toString('hex');
  readonly #c: ReturnType<typeof context>;
  #binding = '';
  readonly #handles = new Map<Id, Handle>();
  readonly #registered: Id[] = [];
  readonly #held: Id[] = [];
  readonly #attempted: Id[] = [];
  readonly #trace: string[] = [];
  #terminal = false;
  #finished = false;
  #unknown = false;
  #workStarted = 0;
  #workCompleted = 0;
  #late = 0;
  #parity = false;
  #reason = 'refused';
  constructor(
    readonly raw: unknown,
    readonly kind: Kind,
    start: number,
  ) {
    this.#start = start;
    this.#c = context(raw);
  }
  async initialize() {
    this.#binding = await live(this.#c, this.#start);
    await ipc(
      '/control/sql.sock',
      { op: 'join', participant: this.#participant, kind: this.kind },
      budget(this.#start, performance.now()),
    );
    await this.#guard();
  }
  async #guard(held: readonly Id[] = this.#held) {
    must(!this.#terminal && !this.#finished);
    const now = context(this.raw);
    must(now.generation === this.#c.generation && now.caSha256 === this.#c.caSha256);
    must(![...this.#handles.values()].some((h) => h.ended && h.connected));
    // Validate synchronously before constructing sibling promises: an expired
    // budget must not leave an already rejected sibling without a handler.
    const remaining = this.kind === 'candidate' ? budget(this.#start, performance.now()) : 1500;
    const [, s] = await Promise.all([
      live(this.#c, this.kind === 'candidate' ? this.#start : undefined, this.#binding),
      ipc('/control/sql.sock', { op: 'sample', participant: this.#participant }, remaining),
    ]);
    if (this.kind === 'candidate') budget(this.#start, performance.now());
    must(
      Array.isArray(s.present) &&
        Array.isArray(s.held) &&
        equal(s.present, this.#registered) &&
        equal(s.held, held),
    );
    context(this.raw);
  }
  async #query(id: Id, text: string, held: readonly Id[] = this.#held) {
    await this.#guard();
    const config = { text, query_timeout: budget(this.#start, performance.now()) };
    const result = await this.#handles.get(id)!.db.query(config);
    await this.#guard(held);
    return result;
  }
  async #open(id: Id, transport?: 'wrong-ca' | 'wrong-password' | 'wrong-host') {
    must(!this.#handles.has(id));
    await this.#guard();
    const d = descriptor(id),
      configuration = settings(
        this.#c,
        d.slot,
        d.kind,
        `tt-mt:${this.#c.run}:${this.#participant}:${id}`,
        this.#start,
      );
    if (transport === 'wrong-ca')
      configuration.ssl.ca = readFileSync('/trust/wrong-ca.crt', 'utf8');
    if (transport === 'wrong-password') configuration.password = '0'.repeat(64);
    if (transport === 'wrong-host') configuration.host = 'postgres.mismatch.preflight.test';
    // Two inspector connections are reserved. Fault profiles admit one
    // candidate only; the separate controller adds at most one root session.
    const reserveFault = profile() !== 'standard';
    must(clients < (reserveFault ? 9 : 10) && domainClients[d.slot]! < (reserveFault ? 5 : 6));
    clients++;
    domainClients[d.slot]!++;
    const h: Handle = { db: new pg.Client(configuration), ended: false, connected: false };
    this.#handles.set(id, h);
    h.db.once('end', () => {
      h.ended = true;
      clients--;
      domainClients[d.slot]!--;
    });
    h.db.on('error', () => {
      this.#terminal = true;
    });
    await h.db.connect();
    h.connected = true;
    // Registration is independent: no PID or identity is supplied by observer.
    const registered = await ipc(
      '/control/sql.sock',
      { op: 'register', participant: this.#participant, channel: id },
      budget(this.#start, performance.now()),
    );
    this.#registered.push(id);
    await this.#guard();
    const results = await this.#query(id, begin + facts + '; ROLLBACK');
    const list = Array.isArray(results) ? results : [results];
    const row = list.find((r) => r.rows[0]?.actor)?.rows[0];
    const endpoint = this.#c.endpoints.find((e) => e.slot === d.slot && e.kind === d.kind)!;
    checkFacts(row, endpoint);
    must(sameIdentity(identity(row, d, this.#c.run, this.#participant), registered.identity));
    this.#trace.push('open:' + id);
  }
  async openCommons() {
    try {
      must(this.kind === 'candidate' && this.#handles.size === 0);
      await this.#open('c0');
      await this.#open('c1');
    } catch {
      this.#terminal = true;
      throw Error('Coordination proof refused');
    }
  }
  async acquire(id: Id) {
    try {
      must(this.kind === 'candidate' && next(this.#held) === id && !this.#attempted.includes(id));
      must(this.#handles.has('c0') && this.#handles.has('c1'));
      if (id.startsWith('i')) {
        must(this.#held.includes('c1'));
        await this.#open(id);
      }
      await this.#guard();
      this.#attempted.push(id);
      this.#trace.push('try:' + id);
      const d = descriptor(id),
        unknown = profile() === 'unknown-ack' && id === 'c0';
      // A dispatched try may have granted even when no acknowledgement arrives.
      this.#unknown = true;
      const db = this.#handles.get(id)!.db;
      const config = {
        text:
          begin +
          `SELECT pg_try_advisory_lock(${d.key},1) AS granted;` +
          (unknown ? ' SELECT pg_sleep(0.65);' : '') +
          ' ROLLBACK',
        query_timeout: budget(this.#start, performance.now()),
      };
      const result = await db.query(config);
      const rows = (Array.isArray(result) ? result : [result]).flatMap((r) => r.rows);
      const granted = rows.find((r) => typeof r.granted === 'boolean')?.granted;
      must(typeof granted === 'boolean');
      if (!granted) {
        this.#unknown = false;
        await this.#guard();
        this.#reason = 'busy';
        this.#terminal = true;
        return false;
      }
      await this.#guard([...this.#held, id]);
      this.#held.push(id);
      this.#unknown = false;
      this.#trace.push('held:' + id);
      return true;
    } catch {
      this.#terminal = true;
      throw Error('Coordination proof refused');
    }
  }
  async read(slow?: 0 | 1) {
    try {
      must(this.kind === 'candidate' && this.#held.length === 6);
      if (slow !== undefined) {
        const id: Id = slow === 0 ? 'i0c' : 'i1c';
        await this.#guard();
        this.#workStarted++;
        const config = {
          text: begin + 'SELECT pg_sleep(0.65); ROLLBACK',
          query_timeout: budget(this.#start, performance.now()),
        };
        await this.#handles.get(id)!.db.query(config);
        this.#workCompleted++;
        try {
          if (['map-loss', 'inspection-loss'].includes(profile())) {
            // Parent deliberately withholds application delivery until its
            // owned stop completes. SQL itself may already have completed.
            while (!existsSync('/tmp/mc-parent-stopped')) {
              budget(this.#start, performance.now());
              await new Promise((resolve) => setTimeout(resolve, 5));
            }
          }
          await this.#guard();
        } catch {
          this.#late++;
          throw Error('Late result discarded');
        }
      } else {
        for (const id of ['i0a', 'i0c', 'i1a', 'i1c'] as const) {
          const d = descriptor(id),
            h = this.#handles.get(id)!,
            e = this.#c.endpoints.find((e) => e.slot === d.slot && e.kind === d.kind)!;
          await this.#query(id, begin);
          await this.#guard();
          this.#workStarted++;
          const metadata = await snapshot(h.db, e.user, this.#start);
          this.#workCompleted++;
          if (profile() === 'deadline') {
            // SQL completed inside its normal limits. End the short group
            // before withholding application delivery past the whole budget.
            await this.#query(id, 'ROLLBACK');
            await new Promise((resolve) =>
              setTimeout(resolve, Math.max(0, 4025 - (performance.now() - this.#start))),
            );
          }
          if (profile() === 'context-drift') process.env.PROVIDER_MODE = 'changed-after-await';
          try {
            await this.#guard();
          } catch {
            this.#late++;
            throw Error('Late result discarded');
          }
          must(metadata === e.baseline);
          await this.#query(id, 'ROLLBACK');
        }
        this.#parity = true;
      }
      this.#reason = 'observed';
    } catch {
      this.#terminal = true;
      throw Error('Coordination proof refused');
    }
  }
  async fixedControl(id: Id, transport?: 'wrong-ca' | 'wrong-password' | 'wrong-host') {
    must(this.kind !== 'candidate');
    try {
      await this.#open(id, transport);
      if (this.kind === 'witness') return;
      const key = this.kind === 'negative' ? 7724054 : descriptor(id).key;
      await this.#guard();
      const result = await this.#handles
        .get(id)!
        .db.query(begin + `SELECT pg_try_advisory_lock(${key},1) AS granted; ROLLBACK`);
      const granted = (Array.isArray(result) ? result : [result])
        .flatMap((r) => r.rows)
        .find((r) => typeof r.granted === 'boolean')?.granted;
      must(granted === true);
      await this.#guard([...this.#held, id]);
      this.#held.push(id);
    } catch {
      this.#terminal = true;
      throw Error('Coordination proof refused');
    }
  }
  async alive() {
    await this.#guard();
    return true;
  }
  async finish() {
    must(!this.#finished);
    this.#finished = true;
    let ended = 0,
      unknown = false;
    // Reverse actual open order includes ungranted and partially opened clients.
    for (const [id, h] of [...this.#handles].reverse()) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          h.db.end().catch(() => {}),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, 750);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (h.ended) ended++;
      else unknown = true;
      this.#trace.push('close:' + id);
    }
    let absent = false,
      locksAbsent = false;
    const until = performance.now() + 2000;
    try {
      while (performance.now() < until) {
        const s = await ipc(
          '/control/sql.sock',
          { op: 'sample', participant: this.#participant },
          Math.min(500, Math.max(1, until - performance.now())),
        );
        must(Array.isArray(s.present) && Array.isArray(s.held));
        absent = s.present.length === 0;
        locksAbsent = s.held.length === 0;
        if (absent && locksAbsent) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    } catch {
      unknown = true;
    }
    unknown ||= !absent || !locksAbsent;
    abandoned ||= unknown;
    return receipt({
      status: this.#reason,
      reason: this.#reason,
      trace: this.#trace,
      opened: this.#handles.size,
      ended,
      acquired: this.#held,
      attempted: this.#attempted,
      workStarted: this.#workStarted,
      workCompleted: this.#workCompleted,
      lateResults: this.#late,
      cleanupUnknown: unknown,
      backendAbsent: absent,
      locksAbsent,
      baselineParity: this.#parity,
      elapsedMs: Math.round((performance.now() - this.#start) * 100) / 100,
      unknownGrant: this.#unknown,
    });
  }
}
export async function candidate(raw?: unknown, entry: 'app' | 'cms' = 'app') {
  const start = performance.now();
  must(!abandoned);
  must(entry === 'app' || entry === 'cms');
  const p = new Participant(raw === undefined ? publicPlan() : raw, 'candidate', start);
  await p.initialize();
  return p;
}
export async function control(
  kind: Exclude<Kind, 'candidate'>,
  id: Id,
  transport?: 'wrong-ca' | 'wrong-password' | 'wrong-host',
) {
  const start = performance.now();
  must(!abandoned);
  const p = new Participant(publicPlan(), kind, start);
  await p.initialize();
  try {
    await p.fixedControl(id, transport);
    return p;
  } catch {
    await p.finish();
    throw Error('Coordination proof refused');
  }
}
