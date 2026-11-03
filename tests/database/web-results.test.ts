import { beforeAll, afterAll, it, expect } from 'vitest';
import { assessmentApiFixture } from '../fixtures/http/assessment-api.ts';
import { engineFixture } from '../fixtures/engine/base.ts';
let f: Awaited<ReturnType<typeof assessmentApiFixture>>;
beforeAll(async () => {
  f = await assessmentApiFixture();
}, 45000);
afterAll(async () => {
  await f?.cleanup();
});
async function seed() {
  const owner = await f.session(),
    r = await f.call(
      '/reports',
      owner,
      engineFixture().request,
      'results_create_' + crypto.randomUUID(),
    );
  expect(r.status).toBe(200);
  return { owner, id: (await r.json()).data.report_id };
}
it('exposes owner-only draft read and preserves missing/expired draft semantics', async () => {
  const { owner, id } = await seed();
  expect((await (await f.call('/reports/' + id + '/draft', owner)).json()).data.draft).toBeNull();
  const saved = (
    await (
      await f.call(
        '/reports/' + id + '/draft',
        owner,
        {
          baseVersion: 1,
          expectedRevision: null,
          input: { ...engineFixture().request, annualMiles: 15000 },
        },
        'results_draft_command_0001',
      )
    ).json()
  ).data;
  const d = (await (await f.call('/reports/' + id + '/draft', owner)).json()).data.draft;
  expect(d).toMatchObject({
    baseVersion: 1,
    revision: saved.result_revision,
    input: { annualMiles: 15000 },
  });
  const other = await f.session();
  expect((await f.call('/reports/' + id + '/draft', other)).status).not.toBe(200);
  expect((await f.call('/reports/' + id + '/draft')).status).toBe(401);
  await f.db.admin.query(
    "UPDATE app.report_drafts SET created_at=clock_timestamp()-interval '3 days',updated_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 day' WHERE report_id=$1",
    [id],
  );
  expect((await (await f.call('/reports/' + id + '/draft', owner)).json()).data.draft).toBeNull();
});
it('publishes confidence/provenance only to the owner and retains redaction for a shared capability', async () => {
  const { owner, id } = await seed(),
    view = (await (await f.call('/reports/' + id, owner)).json()).data;
  expect(view.output.result.decisions[0].confidence).toBe(3);
  expect(view.output.sources).toHaveLength(5);
  expect(view.output.followUp.maintenance).toBe('not_assessed');
  const share = (
    await (
      await f.call(
        '/reports/' + id + '/shares',
        owner,
        { version: 1, comparisonRevision: null },
        'results_share_command_0001',
      )
    ).json()
  ).data;
  const shared = await fetch(f.server.origin + '/api/v1/shared', {
    headers: { authorization: 'Bearer ' + share.token },
  });
  expect(shared.status).toBe(200);
  const text = await shared.text();
  expect(text).not.toMatch(/annualMiles|confidence|followUp|shopName/);
});
it('recovers a saved draft, rejects a stale revision and creates a new immutable version with a truthful diff', async () => {
  const { owner, id } = await seed(),
    original = (await (await f.call('/reports/' + id, owner)).json()).data;
  const d = (
    await (
      await f.call(
        '/reports/' + id + '/draft',
        owner,
        {
          baseVersion: 1,
          expectedRevision: null,
          input: { ...engineFixture().request, priorities: ['noise'] },
        },
        'results_draft_command_0002',
      )
    ).json()
  ).data;
  expect(
    (
      await f.call(
        '/reports/' + id + '/draft',
        owner,
        { baseVersion: 1, expectedRevision: null, input: engineFixture().request },
        'results_stale_command_0002',
      )
    ).status,
  ).toBe(409);
  const refined = await f.call(
    '/reports/' + id + '/refine',
    owner,
    { baseVersion: 1, draftRevision: d.result_revision, expectedRevision: original.revision },
    'results_refine_command_0002',
  );
  expect(refined.status).toBe(200);
  const current = (await (await f.call('/reports/' + id, owner)).json()).data,
    old = (await (await f.call('/reports/' + id + '?version=1', owner)).json()).data;
  expect(current.version).toBe(2);
  expect(current.diff).toMatchObject({
    answersChanged: true,
    rulesChanged: false,
    scoresComparable: true,
  });
  expect(old.input.priorities).toEqual([]);
  expect(current.input.priorities).toEqual(['noise']);
});

it('returns five explicitly synthetic supported options without inventing available prices', async () => {
  const owner = await f.session();
  const created = await f.call(
    '/reports',
    owner,
    { ...engineFixture().request, regionKey: 'SYNTHETIC_FIVE' },
    'results_five_command_0001',
  );
  expect(created.status).toBe(200);
  const id = (await created.json()).data.report_id;
  const view = (await (await f.call('/reports/' + id, owner)).json()).data;
  expect(view.output.result.picks).toHaveLength(5);
  expect(view.output.products).toHaveLength(5);
  expect(view.output.prices).toEqual([]);
});
