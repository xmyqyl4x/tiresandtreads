import net from 'node:net';
import { existsSync, unlinkSync } from 'node:fs';
import {
  channels,
  descriptor,
  identity,
  sameIdentity,
  must,
  request,
  type Id,
  type Identity,
  type Kind,
} from './contract.ts';
import { context, publicPlan, rootClient, profile, live } from './transport.ts';

// Privileged read-only custody is deliberately outside the observer. Every
// observation is a new autocommit transaction (no cached statistics snapshot).
const c = context(publicPlan()),
  binding = await live(c);
const roots = await Promise.all([rootClient(c, 0), rootClient(c, 1)]);
const participants = new Map<string, { kind: Kind; records: Map<Id, Identity> }>();
const sql = `SELECT a.pid,a.backend_start::text AS start,a.datname AS database,
 a.usename AS role,a.application_name AS application,a.backend_type AS type,
 a.state,a.wait_event,
 coalesce((SELECT jsonb_agg(jsonb_build_object('database',l.database::int,
 'classid',l.classid::int,'objid',l.objid::int,'objsubid',l.objsubid,
 'mode',l.mode,'granted',l.granted)) FROM pg_locks l
 WHERE l.pid=a.pid AND l.locktype='advisory'),'[]') AS locks,
 (SELECT oid::int FROM pg_database WHERE datname=a.datname) AS oid
 FROM pg_stat_activity a WHERE a.application_name=ANY($1) OR a.pid=ANY($2) ORDER BY a.pid LIMIT 9`;
async function sample(participant: string) {
  const p = participants.get(participant);
  must(p);
  const present: Id[] = [],
    held: Id[] = [],
    slow: Id[] = [];
  for (const slot of [0, 1]) {
    const selected = [...p.records].filter(([id]) => descriptor(id).slot === slot);
    const applications = channels
      .filter((d) => d.slot === slot)
      .map((d) => `tt-mt:${c.run}:${participant}:${d.id}`);
    const rows = (await roots[slot]!.query(sql, [applications, selected.map(([, r]) => r.pid)]))
      .rows;
    must(rows.length <= selected.length);
    for (const row of rows) {
      const entry = selected.find(([, r]) => r.application === row.application);
      must(entry);
      const [id, expected] = entry;
      must(sameIdentity(expected, row));
      present.push(id);
      must(Array.isArray(row.locks) && row.locks.length <= 1);
      if (row.locks.length) {
        const l = row.locks[0],
          key = p.kind === 'negative' ? 7724054 : descriptor(id).key;
        must(
          l.database === row.oid &&
            l.classid === key &&
            l.objid === 1 &&
            l.objsubid === 2 &&
            l.mode === 'ExclusiveLock' &&
            l.granted === true,
        );
        held.push(id);
      }
      if (row.state === 'active' && row.wait_event === 'PgSleep') slow.push(id);
    }
  }
  return { present, held, slow };
}
async function handle(raw: string) {
  const r = request(raw);
  if (r.op === 'join') {
    must(participants.size < 64 && !participants.has(r.participant));
    participants.set(r.participant, { kind: r.kind!, records: new Map() });
    return {};
  }
  const p = participants.get(r.participant);
  must(p);
  if (r.op === 'register') {
    const d = descriptor(r.channel);
    must(!p.records.has(d.id));
    const application = `tt-mt:${c.run}:${r.participant}:${d.id}`;
    const rows = (await roots[d.slot]!.query(sql, [[application], []])).rows;
    must(rows.length === 1);
    const value = identity(rows[0], d, c.run, r.participant);
    p.records.set(d.id, value);
    return { identity: value };
  }
  return sample(r.participant);
}
// Separate volume, never mounted in observer. Only fixed selectors leave this
// socket; caller PIDs, identities, SQL and keys are not accepted.
async function fault(raw: string) {
  const r = JSON.parse(raw);
  must(
    Object.keys(r).sort().join(',') === 'mode,nonce,version' &&
      r.version === 1 &&
      /^[a-f0-9]{16}$/.test(r.nonce) &&
      ['lose-common0', 'lose-common1', 'observe-slow', 'pending-after-loss'].includes(r.mode),
  );
  const wanted: Id =
    r.mode === 'lose-common1' ||
    (['observe-slow', 'pending-after-loss'].includes(r.mode) && profile() === 'loss-target')
      ? 'c1'
      : 'c0';
  if (r.mode === 'pending-after-loss') must(['loss-source', 'loss-target'].includes(profile()));
  const deadline = performance.now() + 10000;
  while (performance.now() < deadline) {
    for (const [participant, p] of participants) {
      if (p.kind !== 'candidate') continue;
      const unknown = profile() === 'unknown-ack';
      // Do not inspect a half-registered opening prefix as a fault-ready
      // participant. The candidate is still independently admitting channels.
      if (p.records.size !== (unknown ? 2 : 6)) continue;
      const s = await sample(participant);
      const opposite = wanted === 'c0' ? 'i1c' : 'i0c';
      if (
        r.mode === 'pending-after-loss'
          ? !s.present.includes(wanted) && s.slow.includes(opposite)
          : r.mode === 'observe-slow'
            ? s.slow.includes(opposite)
            : unknown
              ? s.held.includes('c0') && s.slow.includes('c0')
              : s.held.length === 6 && s.slow.includes(opposite)
      ) {
        await live(c, undefined, binding);
        return {
          identity: p.records.get(wanted),
          slot: descriptor(wanted).slot,
          pendingAfterLoss: r.mode === 'pending-after-loss',
        };
      }
    }
    if (r.mode === 'pending-after-loss') throw Error('No pending read observed after loss');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw Error('Fixed fault precondition unavailable');
}
function server(path: string, operation: (raw: string) => Promise<object>, timeout: number) {
  if (existsSync(path)) unlinkSync(path);
  const s = net.createServer((socket) => {
    let raw = '',
      handled = false;
    socket.on('error', () => {});
    socket.setTimeout(timeout, () => socket.destroy());
    socket.on('data', (chunk) => {
      raw += chunk.toString('utf8');
      if (Buffer.byteLength(raw) > 4096) return socket.destroy();
      if (!raw.endsWith('\n') || handled) return;
      handled = true;
      void (async () => {
        let nonce = '0'.repeat(16);
        try {
          const envelope = JSON.parse(raw);
          if (/^[a-f0-9]{16}$/.test(envelope.nonce)) nonce = envelope.nonce;
          const result = await operation(raw);
          socket.end(JSON.stringify({ version: 1, nonce, ok: true, ...result }) + '\n');
        } catch {
          socket.end(JSON.stringify({ version: 1, nonce, ok: false }) + '\n');
        }
      })();
    });
  });
  s.listen(path);
  return s;
}
const servers = [
  server('/control/sql.sock', handle, 2000),
  server('/fault/registry.sock', fault, 12000),
];
console.log('Read-only coordination inspector ready');
process.once('SIGTERM', () => {
  servers.forEach((s) => s.close());
  void Promise.all(roots.map((r) => r.end())).finally(() => process.exit(0));
});
