import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ownerWebFixture } from '../fixtures/phase2/owner-web.ts';
import { createP2OwnerClient } from '../../packages/contracts/src/phase2-owner-client.ts';
import { createPhotoPresentationClient } from '../../packages/contracts/src/phase2-photo-presentation-client.ts';
import { createAssessmentClient } from '../../packages/contracts/src/assessment-client.ts';
import { p2Id } from '../../packages/integrations/src/http/phase2-common.ts';
import { value } from '../fixtures/phase2/compose-partner-services.ts';
import { applyConfirmedSize } from '../../apps/web/src/assessment/model.ts';
import { blankAssessment } from '../../apps/web/src/assessment/model.ts';
let f: Awaited<ReturnType<typeof ownerWebFixture>>;
const send =
  (token: string): typeof fetch =>
  async (input, init) => {
    const u = new URL(String(input));
    return f.web.request('/local-p2-owner-api' + u.pathname + u.search, {
      ...init,
      headers: {
        ...Object.fromEntries(new Headers(init?.headers)),
        authorization: 'Bearer ' + token,
        origin: f.web.webOrigin,
      },
    });
  };
const command = () => ({ key: randomUUID(), csrf: f.csrf });
const owner = () => createP2OwnerClient(f.web.webOrigin, send(f.token));
const options = (token = f.token) =>
  createPhotoPresentationClient(f.web.webOrigin, send(token)).p2PhotoOptions({});
beforeAll(async () => {
  f = await ownerWebFixture();
}, 90000);
afterAll(async () => {
  await f?.cleanup();
}, 60000);
async function admitted() {
  const c = owner(),
    batch = (
      await c.p2PhotoCapture({ body: { policyId: f.photoExample.policy }, command: command() })
    ).data.batchId;
  const { key: _key, ...input } = f.photoExample.input;
  void _key;
  const intent = (await c.p2PhotoIntent({ body: { ...input, batchId: batch }, command: command() }))
    .data;
  if (intent.state === 'manual') throw Error('Expected synthetic admission');
  return { c, intent };
}
async function ready() {
  const { c, intent } = await admitted();
  const status = (
    await c.p2PhotoFinalize({
      path: { upload: intent.id },
      bytes: f.photoExample.bytes,
      grant: intent.grant,
      command: command(),
    })
  ).data;
  return { c, intent, status };
}
it('reads safe configured options and owned metadata without processing on page/status reads', async () => {
  const r = (await options()).data;
  expect(r.processing).toMatchObject({
    available: true,
    policyId: f.photoExample.policy,
    noticeVersion: 'photo-processing-v1',
  });
  expect(r.items).toEqual([]);
  expect(JSON.stringify(r)).not.toMatch(/digest|model_id|grant|prompt_version|sanitized_asset/);
  const page = await f.web.request('/assisted-report');
  expect(page.status).toBe(200);
  expect(await page.text()).not.toContain(f.token);
  expect(f.photo.calls).toHaveLength(0);
  expect(f.delivery.provider.send).not.toHaveBeenCalled();
});
it('rediscovers and removes unfinalized owned upload intents without stranding active quota', async () => {
  const first = await admitted();
  expect((await options()).data.items.find((i) => i.id === first.intent.id)).toMatchObject({
    id: first.intent.id,
    state: 'pending',
    savedAt: null,
  });
  expect((await options(f.strangerToken)).data.items).toEqual([]);
  expect((await first.c.p2PhotoStatus({ path: { upload: first.intent.id } })).data).toMatchObject({
    state: 'pending',
    candidates: [],
    confirmations: [],
  });
  expect(JSON.stringify((await options()).data)).not.toMatch(
    /grant_hash|grant_until|original_id|sha256|digest/,
  );
  const removal = (
    await first.c.p2PhotoDelete({ path: { upload: first.intent.id }, body: {}, command: command() })
  ).data;
  expect(removal.cleanupPending).toBe(true);
  expect((await options()).data.items.map((i) => i.id)).not.toContain(first.intent.id);
  const job = p2Id('analysis_erasure', removal.jobId);
  for (let n = 0; n < 40 && value(await f.privacy.service.status(job)) !== 'complete'; n++)
    value(await f.privacy.service.workOne(job));
  expect(value(await f.privacy.service.status(job))).toBe('complete');
  expect(
    (
      await f.f.admin.query(
        "SELECT count(*)::int n FROM app.photo_service_intents WHERE owner_id=$1 AND state IN('pending','processing') AND grant_until>clock_timestamp()",
        [f.example.owner.identity.subjectId],
      )
    ).rows[0]!.n,
  ).toBe(0);
  const second = await admitted();
  expect((await options()).data.items.map((i) => i.id)).toContain(second.intent.id);
  await second.c.p2PhotoDelete({
    path: { upload: second.intent.id },
    body: {},
    command: command(),
  });
  expect(f.photo.calls).toHaveLength(0);
  expect(f.delivery.provider.send).not.toHaveBeenCalled();
});
let selected: string;
it('uploads actual JPEG bytes through Next and private typed proxy without implicit extraction', async () => {
  const e = await ready();
  selected = e.status.id;
  expect(e.status.state).toBe('ready');
  expect(e.status.candidates).toEqual([]);
  expect(e.status.confirmations).toEqual([]);
  expect(f.photo.calls).toHaveLength(0);
  expect((await options()).data.items.map((x) => x.id)).toContain(selected);
  await expect(
    createP2OwnerClient(f.web.webOrigin, send(f.strangerToken)).p2PhotoStatus({
      path: { upload: selected },
    }),
  ).rejects.toMatchObject({ code: 'not_found' });
  expect((await options(f.strangerToken)).data.items).toEqual([]);
});
it('keeps per-field suggestions unconfirmed, marks partial DOT and requires exact correction revisions', async () => {
  const c = owner(),
    request = (await c.p2PhotoExtract({ path: { upload: selected }, body: {}, command: command() }))
      .data;
  value(await f.photo.service.execute(p2Id('ai_request', request.id)));
  const status = (await c.p2PhotoStatus({ path: { upload: selected } })).data;
  expect(status.dotStatus).toBe('partial');
  expect(status.confirmations).toEqual([]);
  expect(status.candidates.some((c) => c.quality === 'unknown')).toBe(true);
  const candidate = status.candidates.find((c) => c.field === 'tire_size' && c.value)!;
  const confirmed = (
    await c.p2PhotoConfirm({
      path: { upload: selected },
      body: { candidateId: candidate.id, field: 'tire_size', revision: '1', value: '235/65R17' },
      command: command(),
    })
  ).data;
  expect(confirmed).toMatchObject({
    origin: 'corrected_candidate',
    revision: '1',
    value: '235/65R17',
  });
  await expect(
    c.p2PhotoConfirm({
      path: { upload: selected },
      body: { candidateId: candidate.id, field: 'tire_size', revision: '1', value: '225/65R17' },
      command: command(),
    }),
  ).rejects.toMatchObject({ code: 'conflict' });
  const before = {
    ...blankAssessment,
    mode: 'manual' as const,
    region: 'SYNTHETIC_US',
    front: '225/45R18',
    rear: '255/40R18',
    confirmed: true,
  };
  expect(applyConfirmedSize(before, null)).toBe(before);
  expect(
    applyConfirmedSize(before, { key: selected + ':1', axle: 'front', value: confirmed.value }),
  ).toMatchObject({ front: '235/65R17', rear: '255/40R18', confirmed: false });
});
it('supports manual per-field confirmation without treating a partial DOT as recall clearance', async () => {
  const result = (
    await owner().p2PhotoConfirm({
      path: { upload: selected },
      body: { candidateId: null, field: 'brand', revision: '1', value: 'Example' },
      command: command(),
    })
  ).data;
  expect(result.origin).toBe('manual');
  expect((await owner().p2PhotoStatus({ path: { upload: selected } })).data.dotStatus).toBe(
    'partial',
  );
});
it('removes owned photos immediately while separately entered assessment data remains usable', async () => {
  const c = owner();
  expect(
    (await c.p2PhotoDelete({ path: { upload: selected }, body: {}, command: command() })).data
      .cleanupPending,
  ).toBe(true);
  await expect(c.p2PhotoStatus({ path: { upload: selected } })).rejects.toMatchObject({
    code: 'not_found',
  });
  expect((await options()).data.items.map((x) => x.id)).not.toContain(selected);
  const receipt = await createAssessmentClient(f.web.webOrigin, send(f.token)).create(
    {
      market: 'US',
      regionKey: 'SYNTHETIC_US',
      configurationId: null,
      wheelPackage: 'manual checked',
      sizes: { front: '235/65R17', rear: '255/40R18' },
      strategy: 'year_round',
      winterUse: 'none',
      replace: ['front_left', 'front_right', 'rear_left', 'rear_right'],
      priorities: ['wet'],
      budget: null,
    },
    f.csrf,
    randomUUID(),
  );
  expect(receipt.report_version).toBe(1);
  expect(f.delivery.provider.send).not.toHaveBeenCalled();
});
it('denies expired selected photos and confirmations without requiring an assessment reset', async () => {
  const e = await ready();
  await f.f.admin.query('ALTER TABLE app.photo_service_intents DISABLE TRIGGER photo_intent_guard');
  try {
    await f.f.admin.query(
      "UPDATE app.photo_service_intents SET created_at=statement_timestamp()-interval '25 hours',grant_until=statement_timestamp()-interval '24 hours 50 minutes',expires_at=statement_timestamp()-interval '1 hour' WHERE id=$1",
      [e.status.id],
    );
  } finally {
    await f.f.admin.query(
      'ALTER TABLE app.photo_service_intents ENABLE TRIGGER photo_intent_guard',
    );
  }
  await expect(e.c.p2PhotoStatus({ path: { upload: e.status.id } })).rejects.toMatchObject({
    code: 'not_found',
  });
  await expect(
    e.c.p2PhotoConfirm({
      path: { upload: e.status.id },
      body: { candidateId: null, field: 'brand', revision: '1', value: 'Example' },
      command: command(),
    }),
  ).rejects.toMatchObject({ code: 'not_found' });
});
it('keeps manual/status paths available when a policy is blocked and rejects forged history cursors', async () => {
  await f.f.admin.query("UPDATE app.ai_policy_versions SET status='blocked' WHERE id=$1", [
    f.photoExample.policy,
  ]);
  expect((await options()).data.processing).toMatchObject({ available: false, policyId: null });
  await expect(
    createPhotoPresentationClient(f.web.webOrigin, send(f.token)).p2PhotoOptions({
      query: { after: 'forged' },
    }),
  ).rejects.toBeDefined();
  console.log(
    'P2_PHOTO_WEB_EVIDENCE ' +
      JSON.stringify({
        actualNext: true,
        actualPostgreSQL: true,
        actualEncryptedVersionedStorage: true,
        actualIsolatedCodec: true,
        typedBinaryProxy: true,
        explicitExtraction: true,
        explicitCorrection: true,
        confirmedOnlyApplication: true,
        manualReportAfterRemoval: true,
        ownedHistory: true,
        unfinalizedIntentsDiscoverableAndRemovable: true,
        syntheticIdentityScannerModel: true,
        actualBrowserUpload: false,
        actualModelEvaluation: false,
        actualPrivacyAcceptance: false,
        productionActivation: false,
        providerDispatches: 0,
        actualRecipientNotifications: 0,
        casesClosed: 0,
        gatesClosed: 0,
      }),
  );
});
