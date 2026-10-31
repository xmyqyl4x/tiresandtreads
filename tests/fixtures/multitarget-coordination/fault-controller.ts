import { randomBytes } from 'node:crypto';
import net from 'node:net';
import { must, identity, descriptor, sameIdentity } from './contract.ts';
import { context, publicPlan, live, rootClient, profile, ipc } from './transport.ts';

// Test controller only: never imported into candidate or read-only inspector.
const c = context(publicPlan()),
  binding = await live(c),
  p = profile();
must(['loss-source', 'loss-target', 'unknown-ack', 'map-loss', 'inspection-loss'].includes(p));
const mode =
  p === 'loss-target'
    ? 'lose-common1'
    : ['map-loss', 'inspection-loss'].includes(p)
      ? 'observe-slow'
      : 'lose-common0';
const nonce = randomBytes(8).toString('hex');
const raw = await new Promise<string>((resolve, reject) => {
  const s = net.createConnection('/fault/registry.sock');
  let data = '';
  s.setTimeout(12000, () => s.destroy(Error('bounded')));
  s.on('error', reject);
  s.on('connect', () => s.write(JSON.stringify({ version: 1, nonce, mode }) + '\n'));
  s.on('data', (x) => {
    data += x;
    if (Buffer.byteLength(data) > 4096) s.destroy(Error('bounded'));
  });
  s.on('end', () => resolve(data));
});
const r = JSON.parse(raw);
must(r.ok === true && r.nonce === nonce);
if (mode === 'observe-slow') {
  console.log('MC_SLOW_OBSERVED');
} else {
  const d = descriptor(mode === 'lose-common1' ? 'c1' : 'c0');
  const participant = String(r.identity?.application).split(':')[2]!;
  const expected = identity(r.identity, d, c.run, participant);
  must(r.slot === d.slot);
  const root = await rootClient(c, d.slot);
  try {
    await live(c, undefined, binding);
    const predicate = `pid=$1 AND backend_start::text=$2 AND datname=$3 AND usename=$4 AND application_name=$5 AND backend_type=$6`;
    const values = [
      expected.pid,
      expected.start,
      expected.database,
      expected.role,
      expected.application,
      expected.type,
    ];
    const row = (
      await root.query(
        `SELECT pid,backend_start::text AS start,datname AS database,usename AS role,application_name AS application,backend_type AS type FROM pg_stat_activity WHERE ${predicate}`,
        values,
      )
    ).rows;
    must(row.length === 1 && sameIdentity(expected, row[0]));
    // Recheck the entire exact identity in the effect statement itself.
    const signal = (
      await root.query(
        `SELECT pg_terminate_backend(pid) AS sent FROM pg_stat_activity WHERE ${predicate}`,
        values,
      )
    ).rows;
    must(signal.length === 1 && signal[0].sent === true);
    let absent = false;
    const until = performance.now() + 2000;
    while (performance.now() < until) {
      const rows = (await root.query(`SELECT pid FROM pg_stat_activity WHERE ${predicate}`, values))
        .rows;
      const locks = (
        await root.query("SELECT pid FROM pg_locks WHERE pid=$1 AND locktype='advisory'", [
          expected.pid,
        ])
      ).rows;
      if (!rows.length && !locks.length) {
        absent = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    must(absent);
    let pendingAfterLoss = false;
    if (p !== 'unknown-ack') {
      const observed = await ipc('/fault/registry.sock', { mode: 'pending-after-loss' });
      must(observed.pendingAfterLoss === true);
      pendingAfterLoss = true;
    }
    console.log(
      'MC_FAULT_EVIDENCE ' +
        JSON.stringify({
          mode,
          identityChecked: true,
          signalSent: true,
          backendAbsent: true,
          locksAbsent: true,
          terminationCalls: 1,
          pendingReadObservedAfterBackendLoss: pendingAfterLoss,
        }),
    );
  } finally {
    await root.end();
  }
}
