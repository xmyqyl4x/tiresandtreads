import type { operationsApiFixture } from './operations-api.ts';
import { callbackRoutes } from '../../../packages/integrations/src/http/callbacks.ts';
import { createEmailActionsRuntime } from '../../../packages/integrations/src/mail-events-runtime.ts';
import { createEmailLinkCrypto } from '../../../packages/integrations/src/email-link-crypto.ts';
import { createConfirmationQuery } from '../../../packages/application/src/queries/confirmation.ts';
import { createContactServiceRepository } from '../../../packages/db/src/repositories/contact-services.ts';
import { createPrivacyRepository } from '../../../packages/db/src/repositories/privacy.ts';
import { time } from '../private/database.ts';
type Context = Parameters<NonNullable<Parameters<typeof operationsApiFixture>[0]>>[0];
// Only four existing purpose-control handlers are composed into this disposable product fixture.
// Mail/workflow callbacks, analytics collection, affiliate effects and actual notifications are absent.
export async function emailControlRoutes({ db, services, crypto }: Context) {
  const actions = createEmailActionsRuntime({
    scope: db.scope,
    crypto: createEmailLinkCrypto(
      'synthetic-link',
      { 'synthetic-link': new Uint8Array(32).fill(61) },
      crypto,
    ),
    contacts: services.contacts,
    origin: 'https://tiresandtreads.test',
  });
  const confirmation = createConfirmationQuery({
    uow: db.scope.unitOfWork,
    contacts: createContactServiceRepository(db.scope, crypto.lookupVersions),
    privacy: createPrivacyRepository(db.scope, crypto.lookupVersions),
    crypto,
    now: () => time(),
  });
  const allowed = new Set([
    'getEmailPreferences',
    'getEmailConfirmation',
    'confirmEmail',
    'withdrawEmail',
  ]);
  const routes = callbackRoutes({
    services: { ...services, actions },
    confirmation,
    keys: { mail: [], workflow: [] },
    wake: async () => {
      throw Error('Workflow wake is absent in this fixture');
    },
    now: () => time(),
  }).filter((r) => allowed.has(r.operationId));
  if (routes.length !== 4) throw Error('Unexpected private email-control route inventory');
  return routes;
}
