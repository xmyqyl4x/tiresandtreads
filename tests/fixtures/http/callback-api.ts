import { operationsApiFixture } from './operations-api.ts';
import { uid, time, success, key } from '../private/database.ts';
import { createHmac } from 'node:crypto';
import { callbackRoutes } from '../../../packages/integrations/src/http/callbacks.ts';
import {
  createMailEventsRuntime,
  createEmailActionsRuntime,
} from '../../../packages/integrations/src/mail-events-runtime.ts';
import { createEmailLinkCrypto } from '../../../packages/integrations/src/email-link-crypto.ts';
import { createAnalyticsRuntime } from '../../../packages/integrations/src/analytics-runtime.ts';
import {
  createCollectionCrypto,
  createQuotaCrypto,
} from '../../../packages/integrations/src/analytics-crypto.ts';
import { createDurability } from '../../../packages/application/src/services/durability.ts';
import {
  createJobRepository,
  createCommandRepository,
  createRelayRepository,
} from '../../../packages/db/src/repositories/jobs.ts';
import { ok, type Id } from '../../../packages/domain/src/values/core.ts';
import { createConfirmationQuery } from '../../../packages/application/src/queries/confirmation.ts';
import { createContactServiceRepository } from '../../../packages/db/src/repositories/contact-services.ts';
import { createPrivacyRepository } from '../../../packages/db/src/repositories/privacy.ts';
import { createCommercialRuntime } from '../../../packages/integrations/src/commercial-runtime.ts';
const mailKey = 'whsec_' + Buffer.alloc(32, 31).toString('base64'),
  workflowKey = 'whsec_' + Buffer.alloc(32, 32).toString('base64');
export async function callbackApiFixture() {
  let ports:
    | undefined
    | {
        mail: Awaited<ReturnType<typeof createMailEventsRuntime>>;
        actions: ReturnType<typeof createEmailActionsRuntime>;
        commercial: Awaited<ReturnType<typeof createCommercialRuntime>>['commercial'];
        analytics: Awaited<ReturnType<typeof createAnalyticsRuntime>>;
        job: () => Promise<{ id: Id<'job'>; eventId: Id<'event'> }>;
      };
  let loseAck = false;
  const f = await operationsApiFixture(async ({ db, services, crypto, policy }) => {
    const mail = await createMailEventsRuntime({
        scope: db.scope,
        lookupVersions: crypto.lookupVersions,
        retrieve: async () => null,
      }),
      actions = createEmailActionsRuntime({
        scope: db.scope,
        crypto: createEmailLinkCrypto(
          'link-v1',
          { 'link-v1': new Uint8Array(32).fill(61) },
          crypto,
        ),
        contacts: services.contacts,
        origin: 'https://tiresandtreads.test',
      });
    await db.admin.query(
      "UPDATE app.rate_limit_policies SET enabled=true WHERE policy_key='analytics_ip'",
    );
    // Synthetic consented collection is enabled only in this disposable fixture. The real local service host keeps collection disabled.
    const analytics = await createAnalyticsRuntime({
      scopes: {
        report: db.scope,
        collector: db.adapter('tt_analytics_runtime'),
        aggregate: db.adapter('tt_analytics_runtime'),
        limiter: db.adapter('tt_limiter_runtime'),
        operations: db.adapter('tt_operations_runtime'),
      },
      crypto: createCollectionCrypto(
        'collection-v1',
        { 'collection-v1': new Uint8Array(32).fill(62) },
        new Uint8Array(32).fill(63),
      ),
      quotaCrypto: createQuotaCrypto({ 'http-v1': new Uint8Array(32).fill(99) }),
      enabled: true,
      policy: policy.version,
      noticeId: policy.notices.analytics,
      now: () => time(),
    });
    const jobs = createJobRepository(db.scope),
      durability = createDurability({
        uow: db.scope.unitOfWork,
        jobs,
        commands: createCommandRepository(db.scope),
        relay: createRelayRepository(db.scope),
        publisher: {
          publish: async () => {
            throw Error('External publication disabled');
          },
        },
        telemetry: { record() {} },
      });
    const events = new Map<string, Id<'event'>>();
    async function job() {
      const resourceId = uid('resource'),
        eventId = uid('event'),
        id = await success(db.scope.unitOfWork, (tx) =>
          jobs.register(tx, {
            type: 'synthetic.http_callback',
            businessKey: uid('business'),
            version: 1,
            resourceId,
          }),
        );
      events.set(id, eventId);
      return { id, eventId };
    }
    async function wake(id: Id<'job'>) {
      const result = await durability.runJob(id, async (tx, input) => {
        const eventId = events.get(id);
        if (!eventId) throw Error('Unregistered synthetic handler');
        await db.reliability.append(tx, {
          eventId,
          aggregateId: input.resourceId as string as Id<'aggregate'>,
          aggregateKind: 'job',
          type: 'fixture.callback_applied',
          version: 1,
          payload: { resource_id: input.resourceId, resource_kind: 'job' },
        });
        return ok(undefined);
      });
      if (!result.ok) throw Error('Fixture job deferred');
      if (loseAck) {
        loseAck = false;
        throw Error('Synthetic response lost after commit');
      }
    }
    const confirmation = createConfirmationQuery({
      uow: db.scope.unitOfWork,
      contacts: createContactServiceRepository(db.scope, crypto.lookupVersions),
      privacy: createPrivacyRepository(db.scope, crypto.lookupVersions),
      crypto,
      now: () => time(),
    });
    // Destination health/terms are synthetic fixtures, not real retailer or network acceptance.
    const commerce = await createCommercialRuntime({
      scopes: {
        staff: db.adapter('tt_staff_service_runtime'),
        commercial: db.adapter('tt_commercial_runtime'),
        public: db.adapter('tt_public_runtime'),
      },
      mail: {
        reconcile: (target) => mail.reconcile(target),
        replay: (target) => mail.replay(target),
      },
      privacy: services.privacy,
      checker: { check: async () => 'valid' },
      externalActivationApproved: false,
      now: () => time(),
    });
    ports = { mail, actions, analytics, commercial: commerce.commercial, job };
    return callbackRoutes({
      services: {
        ...services,
        mail,
        actions,
        commercial: commerce.commercial,
        analytics: analytics.analytics,
      },
      confirmation,
      keys: { mail: [mailKey], workflow: [workflowKey] },
      wake,
      now: () => time(),
    });
  });
  function signed(body: string, purpose: 'mail' | 'workflow', eventId: string, offset = 0) {
    const stamp = String(Math.floor(Date.now() / 1000) + offset),
      secret = purpose === 'mail' ? mailKey : workflowKey;
    return {
      'svix-id': eventId,
      'svix-timestamp': stamp,
      'svix-signature':
        'v1,' +
        createHmac('sha256', Buffer.from(secret.slice(6), 'base64'))
          .update(eventId + '.' + stamp + '.')
          .update(body)
          .digest('base64'),
    };
  }
  async function signedPost(
    path: string,
    body: string,
    purpose: 'mail' | 'workflow',
    eventId: string,
    offset = 0,
  ) {
    return fetch(f.server.origin + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...signed(body, purpose, eventId, offset) },
      body,
    });
  }
  async function send(state: 'accepted' | 'uncertain' = 'accepted') {
    const owner = await f.db.owner(),
      contact = await f.db.contact(),
      templateId = await f.db.template('necessary'),
      messageId = uid('message');
    const send = await success(f.db.scope.unitOfWork, (tx) =>
      f.db.delivery.schedule(tx, {
        id: uid('send'),
        owner: owner.identity,
        contactId: contact.value.id,
        kind: 'confirmation',
        reportId: null,
        reportVersion: null,
        comparisonRevision: null,
        templateId,
        provider: 'resend',
        providerKey: key().digest,
        delaySeconds: 60,
        policyVersion: 'synthetic',
        noticeId: null,
        purposes: ['necessary'],
      }),
    );
    const asset = await f.db.asset('email_payload');
    await f.db.admin.query('ALTER TABLE email.email_sends DISABLE TRIGGER email_sends_identity');
    try {
      await f.db.admin.query(
        "UPDATE email.email_sends SET created_at=now()-interval '2 minutes',send_after=now()-interval '1 minute',cancel_deadline=now()-interval '1 minute' WHERE id=$1",
        [send.id],
      );
    } finally {
      await f.db.admin.query('ALTER TABLE email.email_sends ENABLE TRIGGER email_sends_identity');
    }
    await f.db.admin.query(
      "UPDATE email.email_sends SET dispatch_state='dispatching',claimed_at=clock_timestamp(),payload_asset_id=$2,payload_hash=$3 WHERE id=$1",
      [send.id, asset.id, asset.hash],
    );
    await f.db.admin.query(
      "UPDATE email.email_sends SET dispatch_state=$2,accepted_at=CASE WHEN $2='accepted' THEN clock_timestamp() ELSE NULL END,provider_message_id=$3 WHERE id=$1",
      [send.id, state, state === 'accepted' ? messageId : null],
    );
    return {
      send,
      messageId,
      body: (type = 'email.delivered') =>
        JSON.stringify({
          type,
          created_at: time(),
          data: {
            email_id: messageId,
            tags: { tt_delivery_key: send.providerKey },
            to: ['unretained@example.invalid'],
          },
        }),
    };
  }
  return {
    ...f,
    ...ports!,
    signed,
    signedPost,
    send,
    loseNextJobAck() {
      loseAck = true;
    },
  };
}
