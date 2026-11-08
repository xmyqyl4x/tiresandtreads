import pg from 'pg';
import { disposableTargets } from '../foundation/target.ts';
if (process.argv.length !== 2) throw Error('Fixed disposable report lock accepts no arguments');
const target = new URL(disposableTargets(process.env).app);
target.pathname = '/tt_app_catalog';
const c = new pg.Client({
  connectionString: target.toString(),
  connectionTimeoutMillis: 3000,
  statement_timeout: 20000,
});
await c.connect();
try {
  await c.query('BEGIN');
  await c.query("SET LOCAL lock_timeout='3s'");
  await c.query("SET LOCAL idle_in_transaction_session_timeout='20s'");
  await c.query('LOCK TABLE app.reports IN ACCESS EXCLUSIVE MODE');
  console.log(
    'LOCAL_REPORT_LOCK_READY ' +
      JSON.stringify({
        synthetic: true,
        boundedMs: 15000,
        rowMutations: 0,
        providerDispatches: 0,
        casesClosed: 0,
        gatesClosed: 0,
      }),
  );
  await new Promise((resolve) => setTimeout(resolve, 15000));
} finally {
  try {
    await c.query('ROLLBACK');
    console.log('LOCAL_REPORT_LOCK_RELEASED');
  } finally {
    await c.end();
  }
}
