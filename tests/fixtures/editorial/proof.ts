import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { editorialFixture } from './runtime.ts';
process.env.TT_EDITORIAL_TRACE = '1';
const raceId = randomUUID(),
  expiredId = randomUUID();
let clockOffset = 0,
  failDelayedWithdrawal = true;
let paused = false,
  release!: () => void,
  entered!: () => void;
const reached = new Promise<void>((resolve) => {
    entered = resolve;
  }),
  resume = new Promise<void>((resolve) => {
    release = resolve;
  });
const f = await editorialFixture(undefined, {
    now: () => new Date(Date.now() + clockOffset).toISOString(),
    beforeDelivery: async (_actor, ref, action) => {
      if (ref.id === expiredId && action === 'publish') throw Error('unavailable');
      if (ref.id === documentId && action === 'withdraw' && failDelayedWithdrawal) {
        failDelayedWithdrawal = false;
        throw Error('unavailable');
      }
      if (ref.id === raceId && action === 'withdraw' && !paused) {
        paused = true;
        entered();
        await resume;
      }
    },
  }),
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
  // Hold the first executor after withdrawal commits. A later author save must first
  // reconcile the exact durable withdrawal, before replacing its native command receipt.
  const raceDraft = { ...f.draft, key: 'withdrawal-race', path: '/glossary/withdrawal-race' };
  for (const [credential, input] of [
    [author, { action: 'save', draft: raceDraft }],
    [author, { action: 'submit' }],
    [reviewer, { action: 'approve', expiresAt: new Date(Date.now() + 86400000).toISOString() }],
    [publisher, { action: 'publish' }],
  ] as const) {
    const revision =
      input.action === 'save'
        ? 0
        : input.action === 'submit'
          ? 1
          : input.action === 'approve'
            ? 2
            : 3;
    await f.service.execute(credential, {
      id: raceId,
      expectedRevision: revision,
      key: randomUUID(),
      ...input,
    });
  }
  const withdrawal = f.service.execute(publisher, {
    id: raceId,
    expectedRevision: 4,
    key: randomUUID(),
    action: 'withdraw',
  });
  await reached;
  try {
    const saved = await f.service.execute(author, {
      id: raceId,
      expectedRevision: 5,
      key: randomUUID(),
      action: 'save',
      draft: raceDraft,
    });
    assert.equal(saved.revision, 6);
    const withdrawn = await f.content.services.readPage(raceDraft.path, 'en-US', 'US');
    assert.equal(withdrawn.ok, false);
    if (!withdrawn.ok) assert.equal(withdrawn.error.code, 'not_found');
  } finally {
    release();
  }
  await withdrawal;
  assert.equal((await f.service.read(author, raceId)).document!.state, 'draft');
  assert.equal(
    (
      await f.f.cmsAdmin.query(
        "SELECT count(*)::int n FROM public.publication_work WHERE document_id=$1 AND content_revision=5 AND state='published'",
        [raceId],
      )
    ).rows[0].n,
    1,
  );
  // A newer draft/rollback leaves the earlier projection independently withdrawable.
  assert.equal((await f.content.services.readPage(f.draft.path, 'en-US', 'US')).ok, true);
  await assert.rejects(
    () =>
      f.service.execute(publisher, {
        id: documentId,
        expectedRevision: 6,
        key: randomUUID(),
        action: 'withdraw',
      }),
    /unavailable/,
  );
  const expiredDraft = {
    ...f.draft,
    key: 'expired-publication',
    path: '/glossary/expired-publication',
  };
  await f.service.execute(author, {
    id: expiredId,
    expectedRevision: 0,
    key: randomUUID(),
    action: 'save',
    draft: expiredDraft,
  });
  await f.service.execute(author, {
    id: expiredId,
    expectedRevision: 1,
    key: randomUUID(),
    action: 'submit',
  });
  await f.service.execute(reviewer, {
    id: expiredId,
    expectedRevision: 2,
    key: randomUUID(),
    action: 'approve',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  });
  await assert.rejects(
    () =>
      f.service.execute(publisher, {
        id: expiredId,
        expectedRevision: 3,
        key: randomUUID(),
        action: 'publish',
      }),
    /unavailable/,
  );
  clockOffset = 2 * 86400000;
  // Delayed tombstones retain their removal authority after the packet's freshness timestamp.
  await f.service.execute(author, {
    id: documentId,
    expectedRevision: 7,
    key: randomUUID(),
    action: 'save',
    draft: f.draft,
  });
  assert.equal(
    (
      await f.f.owner.query(
        'SELECT document FROM app.public_page_details WHERE document_id=$1 AND generation=7',
        [documentId],
      )
    ).rows[0].document,
    null,
  );
  // An expired, never-delivered publication must not block editing or safe no-op withdrawal.
  await f.service.execute(author, {
    id: expiredId,
    expectedRevision: 4,
    key: randomUUID(),
    action: 'save',
    draft: expiredDraft,
  });
  await f.service.execute(publisher, {
    id: expiredId,
    expectedRevision: 5,
    key: randomUUID(),
    action: 'withdraw',
  });
  await f.service.execute(author, {
    id: expiredId,
    expectedRevision: 6,
    key: randomUUID(),
    action: 'save',
    draft: expiredDraft,
  });
  assert.equal(
    (
      await f.f.cmsAdmin.query(
        'SELECT state FROM public.publication_work WHERE document_id=$1 AND content_revision=6',
        [expiredId],
      )
    ).rows[0].state,
    'published',
  );
  assert.equal((await f.content.services.readPage(expiredDraft.path, 'en-US', 'US')).ok, false);
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
        withdrawalSurvivesConcurrentDraft: true,
        newerDraftWithdrawable: true,
        expiredPublicationEditable: true,
        delayedWithdrawalRecoverable: true,
        neverPublishedWithdrawalConfirmed: true,
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
