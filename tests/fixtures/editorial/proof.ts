import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { editorialFixture } from './runtime.ts';
process.env.TT_EDITORIAL_TRACE = '1';
const f = await editorialFixture(),
  documentId = randomUUID(),
  key = randomUUID();
try {
  const { author, reviewer, publisher } = f.credentials;
  const command = { id: documentId, expectedRevision: 0, key, action: 'save', draft: f.draft };
  console.log('EDITORIAL_TRACE save');
  const first = await f.service.execute(author, command);
  console.log('EDITORIAL_TRACE saved');
  assert.equal(first.revision, 1);
  assert.deepEqual(await f.service.execute(author, command), first);
  assert.equal((await f.service.read(author, documentId)).versions.length, 1);
  await assert.rejects(
    () => f.service.execute(publisher, { ...command, key: randomUUID() }),
    /forbidden/,
  );
  await assert.rejects(
    () =>
      f.service.execute(author, {
        ...command,
        draft: { ...f.draft, title: 'Changed under same key' },
      }),
    /conflict/,
  );
  await f.service.execute(author, {
    id: documentId,
    expectedRevision: 1,
    key: randomUUID(),
    action: 'submit',
  });
  await f.service.execute(reviewer, {
    id: documentId,
    expectedRevision: 2,
    key: randomUUID(),
    action: 'approve',
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
  const publication = { id: documentId, expectedRevision: 3, key: randomUUID(), action: 'publish' };
  const live = await f.service.execute(publisher, publication);
  console.log('EDITORIAL_TRACE published');
  const publicPage = await f.content.services.readPage(f.draft.path, 'en-US', 'US');
  assert(publicPage.ok);
  assert.equal(publicPage.value.content.title, f.draft.title);
  assert.equal(publicPage.value.metadata.robots, 'noindex,nofollow');
  assert.equal(publicPage.value.content.references?.[0]?.url, f.draft.references[0]!.url);
  assert(!JSON.stringify(publicPage).includes(f.actors.author.id));
  assert(!JSON.stringify(publicPage).includes('editorial'));
  assert.deepEqual(await f.service.execute(publisher, publication), live);
  assert.equal(
    (
      await f.f.cmsAdmin.query(
        'SELECT count(*)::int n FROM public.publication_work WHERE document_id=$1',
        [documentId],
      )
    ).rows[0].n,
    1,
  );
  const history = await f.service.read(author, documentId),
    version = history.versions.find((v) => v.revision === 1);
  assert(version);
  await f.service.execute(publisher, {
    id: documentId,
    expectedRevision: 4,
    key: randomUUID(),
    action: 'rollback',
    versionId: version.id,
  });
  const rolled = await f.service.read(author, documentId);
  assert.equal(rolled.document!.revision, 5);
  assert.equal(rolled.document!.state, 'draft');
  assert.equal(rolled.document!.review, null);
  const attempts = await Promise.allSettled(
    [1, 2].map(() =>
      f.service.execute(author, {
        id: documentId,
        expectedRevision: 5,
        key: randomUUID(),
        action: 'save',
        draft: f.draft,
      }),
    ),
  );
  assert.equal(attempts.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter((x) => x.status === 'rejected').length, 1);
  f.revoked.add(author);
  await assert.rejects(() => f.service.list(author), /unauthenticated/);
  const denied = await f.handler(
    new Request('http://127.0.0.1:8380/local-editorial/api', {
      headers: { host: 'evil.test', authorization: 'Bearer ' + publisher },
    }),
  );
  assert.equal(denied.status, 403);
  console.log(
    'EDITORIAL_NATIVE_EVIDENCE ' +
      JSON.stringify({
        nativePayloadVersions: true,
        realPostgreSQL: true,
        atomicConcurrentWinners: 1,
        publishedPublicProjection: true,
        privateStaffIdsExcluded: true,
        unchangedPublicationReplay: true,
        rollbackRequiresFreshReview: true,
        roleRevocationRefused: true,
        actualEditorialAcceptance: false,
        providerDispatches: 0,
        actualRecipientNotifications: 0,
        casesClosed: 0,
        gatesClosed: 0,
      }),
  );
} catch (error) {
  console.error('EDITORIAL_PROOF_ERROR', error);
  throw error;
} finally {
  await f.cleanup();
}
process.exit(0);
