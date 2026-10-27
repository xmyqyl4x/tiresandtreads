import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { completedMaintenance } from './local-workflow-history.ts';
export async function proveWorkflow(client: pg.Client, origin: string, timeout = 85000) {
  if (!/^http:\/\/(service-host|test|127\.0\.0\.1):\d+$/.test(origin))
    throw Error('Invalid local callback');
  const policy = 'local_workflow_' + randomUUID();
  try {
    await client.query(
      "INSERT INTO app.rate_limit_policies(policy_key,policy_version,window_seconds,limit_value,enabled) VALUES($1,'fixture',60,1,false)",
      [policy],
    );
    for (const expired of [true, false])
      await client.query(
        "INSERT INTO app.rate_limit_buckets(policy_key,policy_version,key_version,principal_hmac,window_start,window_seconds,limit_value,used,expires_at) VALUES($1,'fixture','local-proof',decode(repeat('12',32),'hex'),date_trunc('hour',clock_timestamp())+($2::int*interval '1 hour'),60,1,1,date_trunc('hour',clock_timestamp())+($2::int*interval '1 hour')+interval '90 minutes')",
        [policy, expired ? -2 : 0],
      );
    const before = Date.now();
    const sync = await fetch(origin + '/internal/inngest', {
      method: 'PUT',
      signal: AbortSignal.timeout(15000),
    });
    if (!sync.ok) throw Error('Workflow registration failed');
    let rows: { expired: boolean }[] = [];
    while (Date.now() - before < timeout) {
      rows = (
        await client.query(
          'SELECT expires_at<=clock_timestamp() AS expired FROM app.rate_limit_buckets WHERE policy_key=$1',
          [policy],
        )
      ).rows;
      if (rows.length === 1 && rows[0]?.expired === false) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    if (rows.length !== 1 || rows[0]?.expired !== false)
      throw Error('Cron did not complete the SQL cleanup');
    let receipt = await completedMaintenance('http://inngest:8288', before - 5000);
    while (!receipt && Date.now() - before < timeout) {
      await new Promise((r) => setTimeout(r, 250));
      receipt = await completedMaintenance('http://inngest:8288', before - 5000);
    }
    if (!receipt) throw Error('Completed maintenance receipt unavailable');
    if (
      (
        await client.query('SELECT enabled FROM app.rate_limit_policies WHERE policy_key=$1', [
          policy,
        ])
      ).rows[0]?.enabled !== false
    )
      throw Error('Proof changed admission policy');
    if (
      (await fetch(origin + '/api/reports', { signal: AbortSignal.timeout(3000) })).status !== 404
    )
      throw Error('Unexpected product API');
    return {
      trigger: 'cron * * * * *',
      callbackRegistered: true,
      run: receipt,
      expiredRemoved: 1,
      unexpiredPreserved: 1,
      admissionPolicyEnabled: false,
      productApiStatus: 404,
      elapsedMs: Date.now() - before,
    };
  } finally {
    await client.query('DELETE FROM app.rate_limit_buckets WHERE policy_key=$1', [policy]);
    await client.query('DELETE FROM app.rate_limit_policies WHERE policy_key=$1', [policy]);
  }
}
