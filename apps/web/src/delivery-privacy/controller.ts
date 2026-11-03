import {
  createDeliveryPrivacyClient,
  type DeliveryChoice,
  type DeliveryReceipt,
  type DeliveryView,
  type OwnerRightsInput,
  type EmailRightsInput,
} from '@tt/contracts/delivery-privacy';
import {
  contactRequestSchema,
  deliveryRequestSchema,
  ownerRightsSchema,
  emailRightsSchema,
} from '../../../../packages/contracts/src/delivery-privacy-inputs.ts';
import { ownerSession } from '../owner-session.ts';
import { commandAttempts } from '../command-attempts.ts';
export function deliveryPrivacyController(
  origin: string,
  send: typeof fetch = fetch,
  key = () => crypto.randomUUID(),
) {
  const client = createDeliveryPrivacyClient(origin, send),
    run = commandAttempts(key);
  let emailAttempt:
    { body: string; promise: Promise<{ accepted: true }>; uncertain: boolean } | undefined;
  return {
    policy: client.policy,
    status: client.delivery,
    submit(raw: DeliveryChoice): Promise<DeliveryReceipt> {
      const request: DeliveryChoice =
        raw.kind === 'delivery'
          ? { kind: 'delivery', input: deliveryRequestSchema.parse(raw.input) }
          : { kind: 'offers', input: contactRequestSchema.parse(raw.input) };
      return run('submit', request, async (snapshot, k) => {
        const { csrf } = await ownerSession(origin, send);
        return snapshot.kind === 'delivery'
          ? { kind: 'delivery', view: await client.deliver(snapshot.input, csrf, k) }
          : { kind: 'offers', view: await client.contact(snapshot.input, csrf, k) };
      });
    },
    cancel(view: Pick<DeliveryView, 'id' | 'revision'>, reason: 'cancel' | 'correct_address') {
      return run(
        'cancel',
        { id: view.id, expectedRevision: view.revision, reason },
        async (input, k) =>
          client.cancel(
            input.id,
            { expectedRevision: input.expectedRevision, reason: input.reason },
            (await ownerSession(origin, send)).csrf,
            k,
          ),
      );
    },
    ownerRights(raw: OwnerRightsInput) {
      return run('owner-rights', ownerRightsSchema.parse(raw), async (input, k) =>
        client.ownerRights(input, (await ownerSession(origin, send)).csrf, k),
      );
    },
    emailRights(raw: EmailRightsInput) {
      const input = emailRightsSchema.parse(raw),
        body = JSON.stringify(input);
      if (emailAttempt) {
        if (emailAttempt.body !== body || emailAttempt.uncertain)
          return Promise.reject(Error('An email request is unconfirmed; do not duplicate it'));
        return emailAttempt.promise;
      }
      const attempt = {
        body,
        promise: Promise.resolve({ accepted: true as const }),
        uncertain: false,
      };
      attempt.promise = client.emailRights(input).catch((error) => {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'invalid_input' &&
          'retryable' in error &&
          error.retryable === false
        )
          emailAttempt = undefined;
        else attempt.uncertain = true;
        throw error;
      });
      emailAttempt = attempt;
      return attempt.promise;
    },
  };
}
