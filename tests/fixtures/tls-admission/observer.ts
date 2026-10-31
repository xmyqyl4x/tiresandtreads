import { readFileSync } from 'node:fs';
import { createHash, randomBytes, X509Certificate } from 'node:crypto';
import net from 'node:net';
import pg from 'pg';
import {
  admit,
  budget,
  checkFacts,
  mapping,
  must,
  refused,
  evidenceFlags,
  type Endpoint,
} from './contract.ts';
import { snapshot } from './snapshot.ts';

const factsSql =
  "SELECT current_user AS actor,session_user AS session_actor,current_database() AS database,current_setting('server_version_num')::int AS version,current_setting('transaction_read_only') AS readonly,current_setting('transaction_isolation') AS isolation,(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls,pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=current_database()";
export function publicPlan() {
  const p = JSON.parse(readFileSync('/owners/context.json', 'utf8')) as {
    project: string;
    fixtureGeneration: string;
  };
  return JSON.stringify({
    version: 1,
    scope: 'disposable-readonly-multitarget-plan',
    project: p.project,
    fixtureGeneration: p.fixtureGeneration,
    domains: [
      { slot: 0, purpose: 'source' },
      { slot: 1, purpose: 'target' },
    ],
  });
}
function context(raw: unknown) {
  const c = admit(raw, readFileSync('/owners/context.json', 'utf8'), process.env);
  const ca = readFileSync('/trust/ca.crt', 'utf8');
  must(
    Buffer.byteLength(ca) <= 65536 && createHash('sha256').update(ca).digest('hex') === c.caSha256,
  );
  const cert = new X509Certificate(ca);
  must(
    cert.ca && Date.parse(cert.validFrom) <= Date.now() && Date.parse(cert.validTo) > Date.now(),
  );
  return { ...c, ca };
}
async function live(c: ReturnType<typeof context>, start: number, expected?: string) {
  const nonce = randomBytes(8).toString('hex');
  const raw = await new Promise<string>((resolve, reject) => {
    const socket = net.createConnection('/control/admission.sock');
    let result = '';
    socket.setTimeout(Math.min(750, budget(start, performance.now())), () =>
      socket.destroy(Error('unavailable')),
    );
    socket.on('connect', () => socket.write(JSON.stringify({ version: 1, nonce }) + '\n'));
    socket.on('data', (chunk) => {
      result += chunk.toString('utf8');
      if (Buffer.byteLength(result) > 2048) socket.destroy(Error('bounded'));
    });
    socket.on('end', () => resolve(result.trim()));
    socket.on('error', () => reject(Error('unavailable')));
  });
  const value = mapping(raw, c.project, c.generation, nonce);
  must(!expected || value === expected);
  budget(start, performance.now());
  return value;
}
const endings = new WeakMap<pg.Client, { ended: boolean }>();
function client(e: Endpoint, ca: string, start: number) {
  const remaining = budget(start, performance.now());
  const configuration = {
    host: e.host,
    port: 5432,
    database: e.database,
    user: e.user,
    password: e.password,
    ssl: { ca, rejectUnauthorized: true, minVersion: 'TLSv1.2' as const },
    sslnegotiation: 'postgres' as const,
    connectionTimeoutMillis: remaining,
    query_timeout: remaining,
    statement_timeout: Math.min(1000, remaining),
    lock_timeout: Math.min(250, remaining),
    idle_in_transaction_session_timeout: Math.min(1000, remaining),
    application_name: 'tt-tls-admission',
    options: '-c search_path=pg_catalog -c default_transaction_read_only=on',
  };
  const db = new pg.Client(configuration),
    state = { ended: false };
  endings.set(db, state);
  db.once('end', () => {
    state.ended = true;
  });
  return db;
}
async function close(db: pg.Client) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      db.end().catch(() => {}),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 750);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  return endings.get(db)?.ended === true;
}
async function query(db: pg.Client, text: string, start: number) {
  const config = { text, query_timeout: budget(start, performance.now()) };
  const result = await db.query(config);
  budget(start, performance.now());
  return result;
}
export async function observe(raw: unknown) {
  const start = performance.now(),
    observations: { slot: number; kind: string; tls: true; readOnly: true; metadata: string }[] =
      [];
  let connections = 0,
    ended = 0,
    cleanupUnknown = false,
    workUnknown = false,
    reason = 'refused';
  try {
    const c = context(raw),
      binding = await live(c, start);
    for (const e of c.endpoints) {
      context(raw);
      await live(c, start, binding);
      const db = client(e, c.ca, start);
      db.on('error', () => {});
      const guard = async () => {
        context(raw);
        await live(c, start, binding);
      };
      const read = async (text: string) => {
        await guard();
        const result = await query(db, text, start);
        await guard();
        return result;
      };
      let begun = false;
      try {
        connections++;
        await db.connect();
        await guard();
        await read(
          "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout='1s'; SET LOCAL lock_timeout='250ms'; SET LOCAL idle_in_transaction_session_timeout='1s'; SET LOCAL transaction_timeout='5s'",
        );
        begun = true;
        const facts = (await read(factsSql)).rows[0];
        checkFacts(facts, e);
        await guard();
        const metadata = await snapshot(db, e.user, start);
        must(metadata === e.baseline);
        await guard();
        observations.push(
          Object.freeze({ slot: e.slot, kind: e.kind, tls: true, readOnly: true, metadata }),
        );
        await read('ROLLBACK');
        begun = false;
      } finally {
        if (begun) await db.query('ROLLBACK').catch(() => {});
        if (await close(db)) ended++;
        else cleanupUnknown = true;
      }
    }
    await live(c, start, binding);
    must(!cleanupUnknown);
    reason = 'observed';
  } catch {
    observations.length = 0;
    workUnknown = connections > 0;
  }
  return Object.freeze({
    scope: 'disposable-fixture-tls-admission',
    status: reason,
    observations: Object.freeze(observations),
    connections,
    ended,
    cleanupUnknown,
    workUnknown,
    elapsedMs: Math.round((performance.now() - start) * 100) / 100,
    ...evidenceFlags,
  });
}
const controls = [
  'wrong-ca',
  'source-hostname',
  'target-hostname',
  'wrong-password',
  'server-transport',
] as const;
export type TransportControl = (typeof controls)[number];
export async function transportControl(raw: unknown, control: TransportControl) {
  must(controls.includes(control));
  const start = performance.now();
  let connections = 0,
    connected = false,
    code = 'unavailable';
  let ended: boolean;
  const c = context(raw),
    binding = await live(c, start),
    e = { ...c.endpoints[control === 'target-hostname' ? 2 : 0]! };
  let ca = c.ca;
  if (control === 'wrong-ca') ca = readFileSync('/trust/wrong-ca.crt', 'utf8');
  if (control === 'source-hostname') e.host = 'postgres.mismatch.preflight.test';
  if (control === 'target-hostname') e.host = 'recovery-postgres.mismatch.preflight.test';
  if (control === 'wrong-password') e.password = '0'.repeat(64);
  const db = client(e, ca, start);
  db.on('error', () => {});
  try {
    connections++;
    await db.connect();
    connected = true;
  } catch (error) {
    const value = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    const known = [
      'SELF_SIGNED_CERT_IN_CHAIN',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
      'ERR_TLS_CERT_ALTNAME_INVALID',
      'CERT_HAS_EXPIRED',
      'CERT_NOT_YET_VALID',
      '28P01',
    ];
    code = typeof value === 'string' && known.includes(value) ? value : 'transport-refused';
  } finally {
    ended = await close(db);
  }
  await live(c, start, binding);
  if (connected) return refused();
  return Object.freeze({
    control,
    connections,
    connected,
    ended,
    code,
    sqlQueries: 0,
    ...evidenceFlags,
  });
}
