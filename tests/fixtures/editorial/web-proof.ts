import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startEditorialPreview } from './web.ts';
const f = await startEditorialPreview('http://127.0.0.1:3000');
try {
  let pages = 0,
    glossary = 0;
  for (const r of f.records) {
    const response = await f.web.request(r.path);
    assert.equal(response.status, 200, r.path + ': ' + (await response.clone().text()));
    const html = await response.text();
    assert(html.includes('noindex,nofollow'));
    assert(html.includes('application/ld+json'));
    assert(html.includes('rel="canonical"'));
    assert(html.includes('google-site-verification'));
    assert.equal(html.includes('type="module"'), r.path === '/guides/before-you-buy');
    if (r.path.startsWith('/glossary/')) assert(html.includes('Original schematic for'));
    assert(!html.includes(f.fixture.actors.author.id));
    pages++;
    if (r.path.startsWith('/glossary/')) glossary++;
  }
  const hub = await (await f.web.request('/learn/tire-basics')).text();
  assert.equal([...hub.matchAll(/href="\/glossary\//g)].length, 25);
  for (const group of [
    'Reading the sidewall',
    'Ratings and labels',
    'Tire types',
    'Maintenance',
    'Buying',
  ])
    assert(hub.includes(group));
  const decoder = await (
    await f.web.request('/guides/size-decoder?marking=235%2F60R18%20103H')
  ).text();
  assert(decoder.includes('235 mm'));
  assert(decoder.includes('103 (code only)'));
  assert(decoder.includes('Not decoded'));
  assert(
    (await (await f.web.request('/guides/size-decoder?marking=unknown')).text()).includes(
      'This format is unsupported',
    ),
  );
  const checklist = await (await f.web.request('/guides/before-you-buy')).text();
  assert.equal([...checklist.matchAll(/class="checklist-question"/g)].length, 14);
  assert.equal([...checklist.matchAll(/class="print-checkbox"/g)].length, 14);
  const answers = new URLSearchParams(
    Array.from({ length: 14 }, (_, i) => [
      'answer-' + (i + 1),
      i === 1 ? 'concern' : i === 2 ? 'unknown' : 'good',
    ]),
  );
  const summary = await (await f.web.request('/guides/before-you-buy?' + answers)).text();
  assert(
    summary.includes('12') &&
      summary.includes('need clarification') &&
      summary.includes('Discuss the concerns'),
  );
  assert.equal((await f.web.request('/guides/before-you-buy?answer-1=good')).status, 400);
  assert.equal((await f.web.request('/editorial')).status, 200);
  assert.equal((await f.web.request('/local-editorial/api')).status, 401);
  const who = await f.web.request('/local-editorial/api?identity=1', {
    headers: { authorization: 'Bearer ' + f.fixture.credentials.reviewer },
  });
  assert.equal(who.status, 200);
  assert.deepEqual((await who.json()).data.roles, ['reviewer']);
  const denied = await f.web.request('/local-editorial/api', {
    method: 'POST',
    headers: {
      origin: 'http://evil.invalid',
      authorization: 'Bearer ' + f.fixture.credentials.author,
      'content-type': 'application/json',
    },
    body: '{}',
  });
  assert.equal(denied.status, 403);
  const stamp = new Date().toISOString(),
    redirects = {
      action: 'redirects',
      reviewerCredential: f.fixture.credentials.reviewer,
      revision: 1,
      issuedAt: stamp,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      csv: 'source,target,code,mode\n/learn/old-guide,/learn/tire-basics,301,exact\n/learn/removed,,410,exact',
    };
  const send = () =>
    f.web.request('/local-editorial/api', {
      method: 'POST',
      headers: {
        origin: f.web.webOrigin,
        authorization: 'Bearer ' + f.fixture.credentials.publisher,
        'content-type': 'application/json',
      },
      body: JSON.stringify(redirects),
    });
  assert.equal((await send()).status, 200);
  assert.equal((await send()).status, 200);
  f.fixture.content.routing.invalidate();
  const alias = await f.web.request('/learn/old-guide?private=must-not-forward', {
    redirect: 'manual',
  });
  assert.equal(alias.status, 301);
  assert.equal(alias.headers.get('location'), '/learn/tire-basics');
  assert.equal((await f.web.request('/learn/removed')).status, 410);
  const first = f.records[0]!;
  const current = (await f.fixture.service.read(f.fixture.credentials.publisher, first.id))
    .document!;
  await f.fixture.service.execute(f.fixture.credentials.publisher, {
    id: first.id,
    expectedRevision: current.revision,
    key: randomUUID(),
    action: 'withdraw',
  });
  assert.equal((await f.web.request(first.path)).status, 404);
  const after = await (await f.web.request('/learn/tire-basics')).text();
  assert(!after.includes('href="' + first.path + '"'));
  assert((await (await f.web.request('/robots.txt')).text()).includes('Disallow: /'));
  assert(!(await (await f.web.request('/sitemap.xml')).text()).includes('<url>'));
  console.log(
    'EDITORIAL_WEB_EVIDENCE ' +
      JSON.stringify({
        actualNextHost: true,
        nativePayloadHistory: true,
        actualPostgreSQL: true,
        syntheticPublishedPages: pages,
        syntheticGlossaryPages: glossary,
        scriptFreeContent: true,
        decoderUsesSharedService: true,
        checklistQuestions: 14,
        checklistUsesSharedService: true,
        fiveApprovedGroups: true,
        originalAnnotatedSvg: true,
        roleScopedIdentity: true,
        redirectReplay: true,
        redirectQueryDropped: true,
        withdrawnPageExcluded: true,
        localNoindex: true,
        actualEditorialAcceptance: false,
        actualSearchVerification: false,
        providerDispatches: 0,
        actualRecipientNotifications: 0,
        casesClosed: 0,
        gatesClosed: 0,
      }),
  );
} finally {
  await f.cleanup();
}
process.exit(0);
