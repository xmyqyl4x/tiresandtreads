import { beforeAll, afterAll, it, expect } from 'vitest';
import { operationsApiFixture } from '../fixtures/http/operations-api.ts';
import { fixtureReportServices } from '../fixtures/http/report-services.ts';
import { publicOwnerRoutes } from '../../packages/integrations/src/http/public-owner.ts';
import { createReferenceQuery } from '../../packages/application/src/queries/reference.ts';
import { ok, fail } from '../../packages/domain/src/values/core.ts';
import { failure } from '../../packages/application/src/ports/transactions.ts';
import { engineFixture } from '../fixtures/engine/base.ts';
let f: Awaited<ReturnType<typeof operationsApiFixture>>;
beforeAll(async () => {
  f = await operationsApiFixture(async ({ db, services }) => {
    const { reports, crypto } = fixtureReportServices(db);
    services.reports = reports;
    return publicOwnerRoutes({
      reports,
      shareKeys: (t) => crypto.lookup('share', t),
      lookup: createReferenceQuery(db.readScope.unitOfWork, db.catalog),
      content: async () => ok({ coverage: 'unavailable' }),
      download: async () => fail(failure('not_found')),
    });
  });
}, 45000);
afterAll(async () => {
  await f?.cleanup();
});
it('UC01–UC06/UC10 completes assessment, stored report, refine, compare, schedule/cancel and erasure over one real HTTP/SQL composition', async () => {
  const who = await f.session();
  let n = 0;
  const command = async (path: string, body: unknown) => {
    const r = await f.call(path, who, body, 'full_journey_' + String(++n).padStart(8, '0'));
    expect(r.status, await r.clone().text()).toBe(200);
    return (await r.json()).data;
  };
  const created = await command('/reports', engineFixture().request),
    id = created.report_id;
  const original = (await (await f.call('/reports/' + id, who)).json()).data;
  const draft = await command('/reports/' + id + '/draft', {
    baseVersion: 1,
    expectedRevision: null,
    input: { ...engineFixture().request, priorities: ['noise'] },
  });
  const refined = await command('/reports/' + id + '/refine', {
    baseVersion: 1,
    draftRevision: draft.result_revision,
    expectedRevision: original.revision,
  });
  expect(refined.report_version).toBe(2);
  const quote = await command('/reports/' + id + '/quotes', {
    id: null,
    expectedRevision: null,
    skuId: null,
    productText: 'Synthetic quote',
    shopName: null,
    currency: 'USD',
    totalMinor: '74900',
    quantity: 4,
    basis: 'installed_set',
    observedOn: new Date().toISOString().slice(0, 10),
    taxContextConfirmed: false,
    taxIncluded: true,
    components: [],
  });
  const compared = await command('/reports/' + id + '/compare', {
    version: 2,
    expectedRevision: null,
    items: [{ kind: 'quote', key: quote.resource_id }],
  });
  expect(
    (
      await f.call(
        '/reports/' + id + '/comparisons/' + compared.result_revision + '?version=2',
        who,
      )
    ).status,
  ).toBe(200);
  const receipt = await command('/deliveries', {
    email: id + '@example.invalid',
    report: { id, version: 2 },
    offers: false,
    notices: { report: f.notices.report },
  });
  const status = (await (await f.call('/deliveries/' + receipt.id, who)).json()).data;
  await command('/deliveries/' + receipt.id + '/cancel', {
    expectedRevision: String(status.revision),
    reason: 'cancel',
  });
  expect(f.providerCalls()).toBe(0);
  const deletion = await command('/privacy/owner-requests', {
    kind: 'delete',
    jurisdiction: 'synthetic',
  });
  expect((await f.call('/reports/' + id, who)).status).toBe(401);
  // Existing internal worker service completes the request accepted over HTTP; no public executor is introduced.
  let completed = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    await f.db.admin.query(
      'UPDATE privacy.request_work SET barrier_until=clock_timestamp(),next_attempt_at=clock_timestamp() WHERE request_id=$1',
      [deletion.id],
    );
    const worked = await f.privacy.workOne(deletion.id);
    expect(worked.ok).toBe(true);
    if (worked.ok && worked.value?.status === 'completed') {
      completed = true;
      break;
    }
  }
  expect(completed).toBe(true);
  const result = await fetch(f.server.origin + '/api/v1/privacy/status', {
    headers: { authorization: 'Bearer ' + deletion.proof },
  });
  expect(result.status).toBe(200);
  expect((await result.json()).data.status).toBe('completed');
  expect(
    (await f.db.admin.query('SELECT 1 FROM app.report_versions WHERE report_id=$1', [id])).rowCount,
  ).toBe(0);
  expect(f.providerCalls()).toBe(0);
});
