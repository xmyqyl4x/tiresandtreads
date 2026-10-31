import { readFileSync } from 'node:fs';
import { randomBytes, createHash, X509Certificate } from 'node:crypto';
import net from 'node:net';
import pg from 'pg';
import { admit, budget, mapping } from '../tls-admission/contract.ts';
import { must } from './contract.ts';
export const profiles = [
  'standard',
  'loss-source',
  'loss-target',
  'unknown-ack',
  'deadline',
  'map-loss',
  'inspection-loss',
  'context-drift',
] as const;
export type Profile = (typeof profiles)[number];
export function profile(): Profile {
  const p = process.env.MC_PROFILE ?? 'standard';
  must(profiles.includes(p as Profile));
  return p as Profile;
}
export function publicPlan() {
  const p = JSON.parse(readFileSync('/owners/context.json', 'utf8'));
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
export function context(raw: unknown) {
  const c = admit(raw, readFileSync('/owners/context.json', 'utf8'), process.env),
    ca = readFileSync('/trust/ca.crt', 'utf8');
  must(
    Buffer.byteLength(ca) <= 65536 && createHash('sha256').update(ca).digest('hex') === c.caSha256,
  );
  const cert = new X509Certificate(ca);
  must(
    cert.ca && Date.parse(cert.validFrom) <= Date.now() && Date.parse(cert.validTo) > Date.now(),
  );
  return { ...c, ca, run: c.generation.slice(0, 16) };
}
export function settings(
  c: ReturnType<typeof context>,
  slot: number,
  kind: 'app' | 'cms',
  application: string,
  start?: number,
  root = false,
) {
  const endpoint = c.endpoints.find((e) => e.slot === slot && e.kind === kind)!;
  const admin = root ? JSON.parse(readFileSync('/admin/root.json', 'utf8')) : undefined;
  if (root) must(admin.project === c.project && /^[a-f0-9]{64}$/.test(admin.password));
  const remaining = start === undefined ? 1500 : budget(start, performance.now());
  return {
    host: endpoint.host,
    port: 5432,
    user: root ? 'local_harness' : endpoint.user,
    database: endpoint.database,
    password: root ? (admin.password as string) : endpoint.password,
    ssl: { ca: c.ca, rejectUnauthorized: true, minVersion: 'TLSv1.2' as const },
    sslnegotiation: 'postgres' as const,
    connectionTimeoutMillis: remaining,
    query_timeout: remaining,
    statement_timeout: Math.min(1000, remaining),
    lock_timeout: Math.min(250, remaining),
    idle_in_transaction_session_timeout: Math.min(1000, remaining),
    application_name: application,
    options:
      '-c search_path=pg_catalog -c default_transaction_read_only=on -c TimeZone=UTC -c DateStyle=ISO,YMD',
  };
}
export async function ipc(
  path: string,
  body: Record<string, unknown>,
  timeout = 1500,
): Promise<Record<string, unknown>> {
  const nonce = randomBytes(8).toString('hex');
  const raw = await new Promise<string>((resolve, reject) => {
    const socket = net.createConnection(path);
    let raw = '';
    socket.setTimeout(Math.max(1, Math.min(1500, timeout)), () =>
      socket.destroy(Error('unavailable')),
    );
    socket.on('connect', () => socket.write(JSON.stringify({ version: 1, nonce, ...body }) + '\n'));
    socket.on('data', (chunk) => {
      raw += chunk.toString('utf8');
      if (Buffer.byteLength(raw) > 8192) socket.destroy(Error('bounded'));
    });
    socket.on('end', () => resolve(raw.trim()));
    socket.on('error', () => reject(Error('Coordination custody unavailable')));
  });
  const r = JSON.parse(raw) as Record<string, unknown>;
  must(r.version === 1 && r.nonce === nonce && r.ok === true);
  return r;
}
export async function live(c: ReturnType<typeof context>, start?: number, expected?: string) {
  const nonce = randomBytes(8).toString('hex');
  const timeout = start === undefined ? 750 : Math.min(750, budget(start, performance.now()));
  // Existing resource protocol has a current flag rather than the SQL protocol's ok.
  const raw = await new Promise<string>((resolve, reject) => {
    const socket = net.createConnection('/control/admission.sock');
    let s = '';
    socket.setTimeout(timeout, () => socket.destroy(Error('unavailable')));
    socket.on('connect', () => socket.write(JSON.stringify({ version: 1, nonce }) + '\n'));
    socket.on('data', (x) => {
      s += x.toString('utf8');
      if (Buffer.byteLength(s) > 2048) socket.destroy(Error('bounded'));
    });
    socket.on('end', () => resolve(s.trim()));
    socket.on('error', () => reject(Error('Resource custody unavailable')));
  });
  const value = mapping(raw, c.project, c.generation, nonce);
  must(!expected || expected === value);
  if (start !== undefined) budget(start, performance.now());
  return value;
}
export async function rootClient(c: ReturnType<typeof context>, slot: number) {
  const db = new pg.Client(settings(c, slot, 'app', 'tt-mt-inspector', undefined, true));
  db.on('error', () => {});
  await db.connect();
  await db.query(
    'SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY',
  );
  return db;
}
