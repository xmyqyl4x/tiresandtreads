import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { createLocalObserver } from '../../packages/integrations/src/local-observer.ts';
type Observer = ReturnType<typeof createLocalObserver> & { close(): Promise<void> };
function requireProof(value: unknown): asserts value {
  if (!value) throw Error('Local observability proof failed');
}
// Deliberately synthetic fault injection, separate from the read-only observer. Never process fake mail.
export async function proveObservability(owner: pg.Client, create: (actor: string) => Observer) {
  const actor = randomUUID(),
    prefix = 'synthetic-observer-' + randomUUID(),
    ids: string[] = [];
  let observer: Observer | undefined;
  const started = Date.now();
  try {
    await owner.query(
      "INSERT INTO admin.staff_identities(id,provider_subject,status,last_verified_at) VALUES($1,$2,'active',now())",
      [actor, prefix],
    );
    const role = await owner.query(
      "INSERT INTO admin.staff_role_assignments(staff_id,role_id) SELECT $1,id FROM admin.roles WHERE code='operations_read' RETURNING role_id",
      [actor],
    );
    requireProof(role.rowCount === 1);
    observer = create(actor);
    const baseline = await observer.sample();
    requireProof(baseline.healthy);
    for (let n = 0; n < 101; n++) ids.push(randomUUID());
    await owner.query(
      "INSERT INTO app.webhook_inbox(id,provider,provider_event_id,payload_digest,received_at,signature_verified_at) SELECT x,'resend',$2||':'||x,decode(repeat('ab',32),'hex'),now()-interval '1 hour',now() FROM unnest($1::uuid[]) x",
      [ids, prefix],
    );
    const alert = await observer.sample();
    requireProof(
      alert.events.some(
        (e) =>
          e.component === 'callbacks' &&
          e.state === 'alert' &&
          e.reasons.includes('backlog') &&
          e.reasons.includes('lag'),
      ),
    );
    requireProof((await observer.sample()).events.length === 0);
    await owner.query(
      'UPDATE admin.staff_role_assignments SET revoked_at=clock_timestamp() WHERE staff_id=$1',
      [actor],
    );
    const denied = await observer.sample();
    requireProof(
      !denied.fresh &&
        denied.activeAlerts.includes('callbacks') &&
        denied.events.some(
          (e) => e.component === 'telemetry' && e.reasons.includes('access_denied'),
        ),
    );
    // Operator withdrawal of owned test input, not a fabricated processed/send acknowledgement.
    const removed = await owner.query(
      'DELETE FROM app.webhook_inbox WHERE id=ANY($1::uuid[]) AND provider_event_id LIKE $2',
      [ids, prefix + ':%'],
    );
    requireProof(removed.rowCount === 101);
    const stillDenied = await observer.sample();
    requireProof(stillDenied.activeAlerts.includes('callbacks'));
    await owner.query('UPDATE admin.staff_role_assignments SET revoked_at=NULL WHERE staff_id=$1', [
      actor,
    ]);
    const recovered = await observer.sample();
    requireProof(
      recovered.healthy &&
        recovered.events.some((e) => e.component === 'callbacks' && e.state === 'recovered'),
    );
    requireProof(!JSON.stringify([alert, denied, recovered]).includes(prefix));
    return {
      baselineHealthy: true,
      injectedSyntheticCallbacks: 101,
      alerts: alert.events,
      stableRepeatEvents: 0,
      revokedAccessRetainedAlarm: true,
      recovery: recovered.events,
      finalHealthy: true,
      fixtureWithdrawal: 101,
      automaticRemediation: false,
      externalMailSends: 0,
      elapsedMs: Date.now() - started,
    };
  } finally {
    try {
      await observer?.close();
    } finally {
      try {
        await owner.query(
          'DELETE FROM app.webhook_inbox WHERE id=ANY($1::uuid[]) AND provider_event_id LIKE $2',
          [ids, prefix + ':%'],
        );
      } finally {
        await owner.query(
          'DELETE FROM admin.staff_role_assignments a USING admin.staff_identities s WHERE a.staff_id=s.id AND s.id=$1 AND s.provider_subject=$2',
          [actor, prefix],
        );
        await owner.query(
          'DELETE FROM admin.staff_identities WHERE id=$1 AND provider_subject=$2',
          [actor, prefix],
        );
      }
    }
  }
}
