import { expect, it } from 'vitest';
import { assessmentApiFixture } from '../fixtures/http/assessment-api.ts';
import { commitAcknowledgementFixture } from '../fixtures/http/commit-acknowledgement.ts';
import { deliveryPrivacyController } from '../../apps/web/src/delivery-privacy/controller.ts';
import { createDeliveryPrivacyClient } from '../../packages/contracts/src/delivery-privacy-client.ts';
import { uid } from '../fixtures/private/database.ts';
import type { Id } from '../../packages/domain/src/values/core.ts';

type Fixture = Awaited<ReturnType<typeof assessmentApiFixture>>;
type Session = Awaited<ReturnType<Fixture['session']>>;
type Command = { path: string; key: string | null; body: string | null };
function transport(f: Fixture, who: Session, commands: Command[]) {
  const send: typeof fetch = async (url, options = {}) => {
    const headers = new Headers(options.headers);
    headers.set('origin', f.server.origin);
    if (options.credentials === 'same-origin') headers.set('cookie', who.cookie);
    const path = new URL(String(url)).pathname;
    if (options.method === 'POST' && path.startsWith('/api/v1/deliveries'))
      commands.push({
        path,
        key: headers.get('idempotency-key'),
        body: typeof options.body === 'string' ? options.body : null,
      });
    return fetch(url, { ...options, headers });
  };
  return send;
}
function input(f: Fixture, report: string, email = uid('address') + '@example.invalid') {
  return {
    email,
    report: { id: report, version: 1 },
    comparisonRevision: null,
    offers: true,
    notices: { report: f.notices.report, offers: f.notices.offers },
  };
}
async function count(f: Fixture, owner: string) {
  return (
    await f.db.admin.query(
      'SELECT count(*)::int AS n FROM email.email_sends WHERE owner_subject_id=$1',
      [owner],
    )
  ).rows[0].n;
}
function evidence(
  operation: 'request' | 'cancel',
  outcome: 'committed' | 'rolled-back',
  observed: ReturnType<typeof commitAcknowledgementFixture>['observed'],
) {
  console.log(
    'DELIVERY_COMMIT_RECOVERY_EVIDENCE ' +
      JSON.stringify({
        operation,
        outcome,
        observed,
        actualPostgreSQL: true,
        acknowledgementFault: 'one-shot-driver-simulation',
        actualNetworkLoss: false,
        explicitSameCommandRecovery: true,
        productionTimeoutsChanged: false,
        originalCiRootCauseEstablished: false,
        providerDispatches: 0,
        actualRecipientNotifications: 0,
        casesClosed: 0,
        gatesClosed: 0,
      }),
  );
}
for (const outcome of ['committed', 'rolled-back'] as const) {
  it(`recovers an explicit delivery request after an unacknowledged ${outcome} transaction without duplicating its intent`, async () => {
    const fault = commitAcknowledgementFixture(),
      f = await assessmentApiFixture(undefined, fault.decorate);
    try {
      const who = await f.session(),
        report = await f.report(who),
        owner = await f.ownerIdentity(who),
        commands: Command[] = [],
        send = transport(f, who, commands),
        controller = deliveryPrivacyController(f.server.origin, send),
        request = { kind: 'delivery' as const, input: input(f, report.head.id) };
      fault.arm('request', report.head.id, outcome);
      await expect(controller.submit(request)).rejects.toMatchObject({
        code: 'commit_unknown',
        retryable: false,
      });
      expect(commands).toHaveLength(1);
      expect(await count(f, owner.subjectId)).toBe(outcome === 'committed' ? 1 : 0);
      await expect(
        controller.submit({
          ...request,
          input: { ...request.input, email: 'other@example.invalid' },
        }),
      ).rejects.toThrow('Retry the unconfirmed request before changing it');
      expect(commands).toHaveLength(1);
      const receipt = await controller.submit(request);
      expect(receipt.kind).toBe('delivery');
      if (receipt.kind !== 'delivery') throw Error('Missing delivery receipt');
      expect(commands).toHaveLength(2);
      expect(commands[1]).toEqual(commands[0]);
      expect(commands[0]!.key).toBeTruthy();
      expect(await count(f, owner.subjectId)).toBe(1);
      const records = await f.db.admin.query(
        `SELECT s.id,s.revision::text,s.dispatch_state,
          (SELECT count(*)::int FROM email.delivery_work w WHERE w.send_id=s.id) AS work,
          (SELECT count(*)::int FROM privacy.contact_intents i WHERE i.owner_subject_id=s.owner_subject_id) AS intents
         FROM email.email_sends s WHERE s.owner_subject_id=$1`,
        [owner.subjectId],
      );
      expect(records.rows).toEqual([
        {
          id: receipt.view.id,
          revision: receipt.view.revision,
          dispatch_state: 'scheduled',
          work: 1,
          intents: 2,
        },
      ]);
      expect(fault.observed).toMatchObject({
        injected: 1,
        committed: outcome === 'committed' ? 1 : 0,
        rolledBack: outcome === 'rolled-back' ? 1 : 0,
        destroyed: 1,
      });
      expect(f.providerCalls()).toBe(0);
      expect(f.inbox).toHaveLength(0);
      evidence('request', outcome, fault.observed);
    } finally {
      await f.cleanup();
    }
  }, 45000);

  it(`reconciles correct-address cancellation after an unacknowledged ${outcome} transaction before an explicit replacement`, async () => {
    const fault = commitAcknowledgementFixture(),
      f = await assessmentApiFixture(undefined, fault.decorate);
    try {
      const who = await f.session(),
        report = await f.report(who),
        owner = await f.ownerIdentity(who),
        commands: Command[] = [],
        send = transport(f, who, commands),
        client = createDeliveryPrivacyClient(f.server.origin, send),
        controller = deliveryPrivacyController(f.server.origin, send),
        old = await client.deliver(input(f, report.head.id), who.csrf, uid('command')),
        before = (
          await f.db.admin.query(
            'SELECT recipient_contact_id,revision::text FROM email.email_sends WHERE id=$1',
            [old.id],
          )
        ).rows[0],
        challenges = await f.db.admin.query(
          'SELECT challenge_id FROM privacy.contact_intents WHERE owner_subject_id=$1',
          [owner.subjectId],
        ),
        proofs: string[] = [];
      for (const row of challenges.rows) {
        const message = await f.contacts.verificationMessage(
          row.challenge_id as Id<'verification'>,
        );
        if (!message.ok) throw Error('Missing synthetic proof');
        proofs.push(message.value.verificationToken);
      }
      expect(proofs).toHaveLength(2);
      commands.length = 0;
      fault.arm('cancel', old.id, outcome);
      await expect(controller.cancel(old, 'correct_address')).rejects.toMatchObject({
        code: 'commit_unknown',
        retryable: false,
      });
      expect(commands).toHaveLength(1);
      expect(commands[0]!.key).toBeTruthy();
      expect((await client.delivery(old.id)).state).toBe(
        outcome === 'committed' ? 'cancelled' : 'scheduled',
      );
      await expect(controller.cancel(old, 'cancel')).rejects.toThrow(
        'Retry the unconfirmed request before changing it',
      );
      expect(commands).toHaveLength(1);
      const cancelled = await controller.cancel(old, 'correct_address');
      expect(cancelled.state).toBe('cancelled');
      expect(cancelled.revision).toBe((BigInt(before.revision) + 1n).toString());
      expect(commands).toHaveLength(2);
      expect(commands[1]).toEqual(commands[0]);
      expect(await count(f, owner.subjectId)).toBe(1);
      for (const token of proofs) {
        await expect(client.confirmation(token)).rejects.toMatchObject({ code: 'not_found' });
        await expect(client.confirmEmail(token)).rejects.toMatchObject({ code: 'not_found' });
      }
      const after = (
        await f.db.admin.query(
          'SELECT recipient_contact_id,revision::text FROM email.email_sends WHERE id=$1',
          [old.id],
        )
      ).rows[0];
      expect(after.recipient_contact_id).toBe(before.recipient_contact_id);
      expect(after.revision).toBe(cancelled.revision);
      const replacement = await controller.submit({
        kind: 'delivery',
        input: input(f, report.head.id, uid('corrected') + '@example.invalid'),
      });
      expect(replacement.kind).toBe('delivery');
      if (replacement.kind !== 'delivery') throw Error('Missing replacement receipt');
      expect(replacement.view.id).not.toBe(old.id);
      expect(await count(f, owner.subjectId)).toBe(2);
      expect(fault.observed).toMatchObject({ injected: 1, destroyed: 1 });
      expect(f.providerCalls()).toBe(0);
      expect(f.inbox).toHaveLength(0);
      evidence('cancel', outcome, fault.observed);
    } finally {
      await f.cleanup();
    }
  }, 45000);
}
