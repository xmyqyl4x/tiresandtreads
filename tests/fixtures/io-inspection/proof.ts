import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { context, publicPlan, settings } from '../multitarget-coordination/transport.ts';
import { descriptor, identity, sameIdentity, must } from '../multitarget-coordination/contract.ts';
import { mapping, checkFacts, evidenceFlags } from '../tls-admission/contract.ts';
import { within, remaining } from './budget.ts';
import { exchange } from './exchange.ts';
import { relays } from './relay.ts';

export const standard = [
  'positive-source',
  'positive-target',
  'connect-stall-source',
  'connect-stall-target',
  'connect-drop-source',
  'connect-drop-target',
  'read-hold-source',
  'read-hold-target',
  'read-drop-source',
  'read-drop-target',
  'statement-source',
  'statement-target',
  'late-source',
  'late-target',
  'context-drift-source',
  'context-drift-target',
] as const;
export const special = ['end-hang', 'inspection-loss', 'map-loss', 'preconnect-map-loss'] as const;
export type Scenario = (typeof standard)[number] | (typeof special)[number];
let quarantined = false;
const begin =
  "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout='1s'; SET LOCAL lock_timeout='250ms'; SET LOCAL idle_in_transaction_session_timeout='1s'; SET LOCAL transaction_timeout='5s'; ";
const facts =
  "SELECT current_user AS actor,session_user AS session_actor,current_database() AS database,current_setting('server_version_num')::int AS version,current_setting('transaction_read_only') AS readonly,current_setting('transaction_isolation') AS isolation,(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls,pg_get_userbyid(datdba) AS owner,pg_backend_pid() AS pid,(SELECT backend_start::text FROM pg_stat_activity WHERE pid=pg_backend_pid()) AS start,current_user AS role,current_setting('application_name') AS application,'client backend'::text AS type FROM pg_database WHERE datname=current_database(); ROLLBACK";

// Closed test-only scenarios. No raw endpoint/URI/SQL/PID/key/callback options.
export async function runScenario(scenario: Scenario) {
  if (quarantined) throw Error('I/O previous cleanup unknown');
  must([...standard, ...special].includes(scenario));
  const profile = process.env.IO_PROFILE;
  must(
    profile === 'standard'
      ? standard.includes(scenario as (typeof standard)[number])
      : profile === scenario,
  );
  const gates = await relays();
  const start = performance.now(),
    c = context(publicPlan());
  const slot = scenario.endsWith('target') ? 1 : 0,
    id = slot === 0 ? 'c0' : 'c1';
  const gate = gates[slot]!,
    d = descriptor(id),
    participant = randomBytes(8).toString('hex');
  const db = new pg.Client({
    ...settings(c, slot, 'app', `tt-mt:${c.run}:${participant}:${id}`, start),
    pipeline: scenario === 'end-hang',
  });
  let opened = false,
    ended = false,
    registered = false,
    queries = 0,
    readDispatched = false,
    readCompleted = false,
    accepted = false,
    contextChanged = false,
    binding = '',
    errorCode = 'none';
  let pendingRead: Promise<void> | undefined;
  db.once('end', () => {
    ended = true;
  });
  db.on('error', () => {});
  const guard = async () => {
    context(publicPlan());
    const r = await exchange('resource', {}, Math.min(750, remaining(start)));
    const current = mapping(JSON.stringify(r), c.project, c.generation, String(r.nonce));
    must(current === gate.bindingDigest);
    must(!binding || binding === current);
    binding = current;
    context(publicPlan());
    remaining(start);
  };
  const sql = async (text: string, cap = 1500) => {
    const limit = Math.min(cap, remaining(start));
    queries++;
    const configuration = { text, query_timeout: limit };
    const value = await within(db.query(configuration), Math.min(1500, limit + 100));
    remaining(start);
    return value;
  };
  const checkpoint = async () => {
    console.log('IO_PARENT_READY ' + scenario);
    while (!existsSync('/tmp/io-parent-stopped')) {
      remaining(start);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    remaining(start);
  };
  let admissionMs: number;
  try {
    await guard();
    const joined = await exchange(
      'sql',
      { op: 'join', participant, kind: 'candidate' },
      remaining(start),
    );
    must(joined.ok === true);
    await guard();
    if (scenario === 'preconnect-map-loss') {
      await checkpoint();
      await guard();
    }
    if (scenario.startsWith('connect-stall')) gate.set('stall-connect');
    if (scenario.startsWith('connect-drop')) gate.set('drop-connect');
    const connectLimit = Math.min(1500, remaining(start));
    opened = true;
    await within(db.connect(), connectLimit);
    await guard();
    const record = await exchange(
      'sql',
      { op: 'register', participant, channel: id },
      remaining(start),
    );
    must(record.ok === true);
    registered = true;
    await guard();
    const results = await sql(begin + facts);
    const list = Array.isArray(results) ? results : [results];
    const row = list.find((r) => r.rows[0]?.actor)?.rows[0];
    const endpoint = c.endpoints.find((e) => e.slot === slot && e.kind === 'app')!;
    checkFacts(row, endpoint);
    must(sameIdentity(identity(row, d, c.run, participant), record.identity));
    await guard();
    if (scenario === 'end-hang') {
      const result = await sql(
        begin + `SELECT pg_try_advisory_lock(${d.key},1) AS granted; ROLLBACK`,
      );
      const rows = (Array.isArray(result) ? result : [result]).flatMap((r) => r.rows);
      must(rows.some((r) => r.granted === true));
      const held = await exchange('sql', { op: 'sample', participant }, remaining(start));
      must(held.ok === true && Array.isArray(held.held) && held.held.includes(id));
    }
    if (scenario.startsWith('read-hold')) gate.set('hold-read');
    if (scenario.startsWith('read-drop')) gate.set('drop-read');
    readDispatched = true;
    if (scenario === 'end-hang') {
      // Native pipeline end waits for drain. The actual encrypted read reply is
      // withheld until its unchanged <=1500ms query timer closes the connection.
      gate.set('hold-read');
      const limit = remaining(start);
      queries++;
      const configuration = {
        text: begin + 'SELECT pg_sleep(0.05); ROLLBACK',
        query_timeout: limit,
      };
      pendingRead = db.query(configuration).then(
        () => {
          readCompleted = true;
        },
        () => {},
      );
      const replyUntil = performance.now() + Math.min(750, remaining(start));
      await within(
        (async () => {
          while (!gate.counts.withheldBytes) {
            if (performance.now() >= replyUntil) throw Error('Native read reply unavailable');
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
        })(),
        Math.min(750, remaining(start)),
      );
      await guard();
    } else {
      await sql(
        begin +
          (scenario.startsWith('statement')
            ? 'SELECT pg_sleep(2); ROLLBACK'
            : 'SELECT pg_sleep(0.05); ROLLBACK'),
        scenario.startsWith('read-hold') ? 350 : 1500,
      );
      readCompleted = true;
      if (scenario.startsWith('late'))
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(1, 4005 - (performance.now() - start))),
        );
      if (scenario.startsWith('context-drift')) {
        process.env.PROVIDER_MODE = 'changed-after-await';
        contextChanged = true;
      }
      if (['inspection-loss', 'map-loss'].includes(scenario)) await checkpoint();
      await guard();
      if (scenario === 'inspection-loss') {
        const observed = await exchange('sql', { op: 'sample', participant }, remaining(start));
        must(observed.ok === true);
      }
      accepted = scenario.startsWith('positive');
    }
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    errorCode = code === '57014' ? code : 'io-refused';
  } finally {
    admissionMs = performance.now() - start;
    if (contextChanged) process.env.PROVIDER_MODE = 'fixtures';
  }
  const cleanupStart = performance.now();
  let endObserved = !opened,
    backendAbsent = false,
    locksAbsent = false,
    inspectionObserved = false;
  try {
    if (opened) {
      await within(db.end(), 750).catch(() => {});
      endObserved = ended;
    }
    if (registered) {
      const until = performance.now() + 2000;
      do {
        const r = await exchange(
          'sql',
          { op: 'sample', participant },
          Math.min(500, Math.max(1, until - performance.now())),
        );
        must(r.ok === true && Array.isArray(r.present) && Array.isArray(r.held));
        backendAbsent = r.present.length === 0;
        locksAbsent = r.held.length === 0;
        inspectionObserved = true;
        if (backendAbsent && locksAbsent) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      } while (performance.now() < until);
    }
  } catch {
    inspectionObserved = false;
  }
  // Only non-dispatched upstreams can omit registered-backend inspection.
  const noUpstream = gate.counts.upstreamOpened === 0;
  const cleanupUnknown =
    !endObserved ||
    (!noUpstream && (!registered || !inspectionObserved || !backendAbsent || !locksAbsent));
  quarantined ||= cleanupUnknown;
  const report = Object.freeze({
    scenario,
    nativePipelineEndControl: scenario === 'end-hang',
    status: accepted && !cleanupUnknown ? 'observed' : 'refused',
    ownerConnectCalls: opened ? 1 : 0,
    ownerQueryCalls: queries,
    registered,
    readDispatched,
    readCompleted,
    readAccepted: accepted && !cleanupUnknown,
    resultDiscarded: !(accepted && !cleanupUnknown) && readCompleted,
    endObserved,
    inspectionObserved,
    backendAbsent,
    locksAbsent,
    cleanupUnknown,
    freshAttemptBlocked: quarantined,
    errorCode,
    admissionMs: Math.round(admissionMs * 100) / 100,
    cleanupMsBeforeRelayDisposal: Math.round((performance.now() - cleanupStart) * 100) / 100,
    relay: { ...gate.counts },
    cancellationClaim: false,
    backendAbsenceRequiresInspection: true,
    ...evidenceFlags,
  });
  await Promise.all(gates.map((g) => g.stop()));
  // This later native event cannot upgrade the immutable earlier disposition.
  if (opened && !ended) await within(new Promise<void>((resolve) => db.once('end', resolve)), 750);
  if (pendingRead) await within(pendingRead, 750);
  console.log('IO_ADMISSION_EVIDENCE ' + JSON.stringify(report));
  console.log(
    'IO_RELAY_CLEANUP ' +
      JSON.stringify({
        scenario,
        exactOwnedSocketsDisposed: true,
        laterNativeEndObserved: !opened || ended,
        laterPendingReadSettled: true,
        originalCleanupUnknown: report.cleanupUnknown,
        originalDispositionUnchanged: true,
        casesClosed: 0,
        gatesClosed: 0,
      }),
  );
  return report;
}
