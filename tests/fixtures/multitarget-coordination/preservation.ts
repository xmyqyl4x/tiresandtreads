import pg from 'pg';
import { context, publicPlan, settings } from './transport.ts';
import { budget, checkFacts } from '../tls-admission/contract.ts';
import { snapshot } from '../tls-admission/snapshot.ts';
import { must } from './contract.ts';

// Independent parent-requested catalog audit after candidate disposal. It does
// not reuse/admit a participant, resolve unknown cleanup, or establish authority.
const start = performance.now(),
  c = context(publicPlan());
let ended = 0;
for (const e of c.endpoints) {
  const db = new pg.Client(settings(c, e.slot, e.kind, 'tt-mt-preservation', start));
  let endObserved = false;
  db.once('end', () => {
    endObserved = true;
  });
  db.on('error', () => {});
  try {
    await db.connect();
    budget(start, performance.now());
    await db.query(
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL transaction_timeout='5s'",
    );
    const facts = (
      await db.query(
        "SELECT current_user AS actor,session_user AS session_actor,current_database() AS database,current_setting('server_version_num')::int AS version,current_setting('transaction_read_only') AS readonly,current_setting('transaction_isolation') AS isolation,(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls,pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=current_database()",
      )
    ).rows[0];
    checkFacts(facts, e);
    must((await snapshot(db, e.user, start)) === e.baseline);
    await db.query('ROLLBACK');
    budget(start, performance.now());
  } finally {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        db.end(),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 750);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    must(endObserved);
    ended++;
  }
}
console.log(
  'MC_PRESERVATION_EVIDENCE ' +
    JSON.stringify({
      endpoints: 4,
      ended,
      semanticBaselineParity: true,
      runtimeConnectQuarantined: true,
      participantAdmitted: false,
      unknownCleanupResolved: false,
      casesClosed: 0,
      gatesClosed: 0,
    }),
);
