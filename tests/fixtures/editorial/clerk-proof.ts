import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startEditorialPreview } from './web.ts';
import { syntheticEditorialSessions } from './clerk.ts';
import { createEditorialClient } from '../../../packages/contracts/src/editorial-client.ts';
import {
  createEditorialAppIdentityRepository,
  createEditorialCmsIdentityRepository,
} from '../../../packages/db/src/repositories/editorial-identity.ts';
import { ok } from '../../../packages/domain/src/values/core.ts';
const sessions = syntheticEditorialSessions(),
  f = await startEditorialPreview('http://127.0.0.1:3000', false, {
    authorization: sessions.authorization,
  });
try {
  const fixture = f.fixture,
    client = (credential: string) =>
      createEditorialClient(f.web.webOrigin, credential, async (input, options = {}) => {
        const u = new URL(String(input));
        return f.web.request('/local-editorial/api' + u.search, {
          ...options,
          headers: { ...Object.fromEntries(new Headers(options.headers)), origin: f.web.webOrigin },
        });
      }),
    author = client(fixture.credentials.author),
    reviewer = client(fixture.credentials.reviewer),
    publisher = client(fixture.credentials.publisher),
    document = f.records[0]!;
  assert.match(await (await f.web.request('/editorial')).text(), /maxLength="8185"/i);
  assert.deepEqual((await author.identity()).roles, ['author']);
  assert.equal((await author.list()).length, 32);
  await assert.rejects(author.redirects(), /forbidden/);
  await author.execute({
    id: document.id,
    expectedRevision: 1,
    key: randomUUID(),
    action: 'submit',
  });
  await reviewer.execute({
    id: document.id,
    expectedRevision: 2,
    key: randomUUID(),
    action: 'approve',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  });
  assert.equal(
    (
      await publisher.execute({
        id: document.id,
        expectedRevision: 3,
        key: randomUUID(),
        action: 'publish',
      })
    ).revision,
    4,
  );
  assert.equal((await f.web.request(document.path)).status, 200);
  const current = await publisher.redirects();
  assert.equal(
    (
      await publisher.publishRedirects({
        action: 'redirects',
        reviewerCredential: fixture.credentials.reviewer,
        revision: current.latestRevision + 1,
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        csv:
          'source,target,code,mode\n/learn/old-verified-editorial,' + document.path + ',301,exact',
      })
    ).revision,
    1,
  );
  // Current application role loss, not JWT roles, removes authority on the next command.
  await fixture.f.owner.query(
    "UPDATE admin.staff_role_assignments SET revoked_at=clock_timestamp() WHERE staff_id=$1 AND role_id IN (SELECT id FROM admin.roles WHERE code='synthetic_editorial_author')",
    [fixture.actors.author.id],
  );
  await assert.rejects(author.identity(), /forbidden/);
  // CMS identity loss also fails closed despite a still valid signed publisher session.
  await fixture.f.cmsAdmin.query('UPDATE public.cms_staff SET app_staff_id=$2 WHERE id=$1', [
    fixture.actors.publisher.cmsId,
    randomUUID(),
  ]);
  await assert.rejects(publisher.identity(), /forbidden/);
  sessions.revoke('reviewer');
  await assert.rejects(reviewer.identity(), /unauthenticated/);
  const reads = sessions.reads();
  await assert.rejects(client('a.b.c').identity(), /unauthenticated/);
  assert.equal(sessions.reads(), reads);
  const appWrong = createEditorialAppIdentityRepository(fixture.f.appScope),
    cmsWrong = createEditorialCmsIdentityRepository(fixture.f.appScope);
  assert.equal(
    (
      await fixture.f.appScope.unitOfWork.run(async (tx) =>
        ok(
          await appWrong.permissions(tx, fixture.actors.author.id as never, [
            'editorial.author',
            'editorial.review',
            'editorial.publish',
          ]),
        ),
      )
    ).ok,
    false,
  );
  assert.equal(
    (
      await fixture.f.appScope.unitOfWork.run(async (tx) =>
        ok(await cmsWrong.resolve(tx, fixture.actors.author.id as never)),
      )
    ).ok,
    false,
  );
  await assert.rejects(
    fixture.payload.find({ collection: 'articles', overrideAccess: false }),
    /not allowed|forbidden|access/i,
  );
  console.log(
    'EDITORIAL_VERIFIED_SESSION_EVIDENCE ' +
      JSON.stringify({
        scope: 'disposable-local-generated-sessions',
        builtNextProxy: true,
        realSdkSignatureVerification: true,
        currentAppRoleAndCmsMapping: true,
        independentlyReviewedRedirect: true,
        nativePayloadAccessDenied: true,
        providerRevocationRefused: true,
        providerReads: sessions.reads(),
        actualProviderCalls: 0,
        actualRecipientNotifications: 0,
        hostedIdentityAccepted: false,
        policyChanged: false,
        casesClosed: 0,
        gatesClosed: 0,
      }),
  );
} finally {
  await f.cleanup();
}
