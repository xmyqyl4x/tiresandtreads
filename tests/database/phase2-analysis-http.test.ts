import { createLocalReportAnalysisRuntime } from '../../packages/integrations/src/analysis-http-runtime.ts';
import { createAnalysisErasureRepository } from '../../packages/db/src/repositories/analysis-lifecycle.ts';
import { beforeAll, afterAll, afterEach, it, expect } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { httpAdmissionFixture } from '../fixtures/phase2/http-admission.ts';
import { composePhotoServices } from '../fixtures/phase2/compose-photo-services.ts';
import { composeReportAnalysis } from '../fixtures/phase2/compose-report-analysis.ts';
import {
  composePartnerServices,
  value,
  uuid,
} from '../fixtures/phase2/compose-partner-services.ts';
import { composeHttpPrivacy } from '../fixtures/phase2/compose-http-privacy.ts';
import { analysisPhotoRoutes } from '../../packages/integrations/src/http/phase2-analysis.ts';
import { createP2HttpAdmission } from '../../packages/integrations/src/http/phase2-admission.ts';
import { createHttpApi, type HttpActor } from '../../packages/integrations/src/http/core.ts';
import { listenLocalApi } from '../../packages/integrations/src/http/server.ts';
import type { KeyDigest } from '../../packages/application/src/ports/private-records.ts';
let f: Awaited<ReturnType<typeof httpAdmissionFixture>>,
  photo: Awaited<ReturnType<typeof composePhotoServices>>,
  analysis: Awaited<ReturnType<typeof composeReportAnalysis>>,
  privacy: ReturnType<typeof composeHttpPrivacy>,
  host: Awaited<ReturnType<typeof listenLocalApi>>;
let reportService: Awaited<ReturnType<typeof createLocalReportAnalysisRuntime>>;
const sessions = new Map<string, HttpActor>();
let limited = false,
  readClockOffset = 0;
const token = (keys: readonly KeyDigest[]) => {
  const raw = randomBytes(32).toString('base64url');
  sessions.set(raw, { keys, csrf: 'synthetic-owner-csrf' });
  return raw;
};
async function call(
  raw: string,
  path: string,
  body?: unknown,
  o: {
    key?: string;
    bytes?: Uint8Array;
    grant?: string;
    headers?: Record<string, string>;
    method?: string;
  } = {},
) {
  const mutation = body !== undefined || o.bytes !== undefined,
    headers = {
      authorization: 'Bearer ' + raw,
      ...(mutation
        ? {
            origin: host.origin,
            'x-csrf-token': 'synthetic-owner-csrf',
            'idempotency-key': o.key ?? randomUUID(),
            'content-type': o.bytes ? 'application/octet-stream' : 'application/json',
          }
        : {}),
      ...(o.grant ? { 'x-upload-grant': o.grant } : {}),
      ...o.headers,
    };
  const response = await fetch(host.origin + '/api/v1/' + path, {
      method: o.method ?? (mutation ? 'POST' : 'GET'),
      headers,
      ...(o.bytes
        ? { body: Buffer.from(o.bytes) }
        : body === undefined
          ? {}
          : { body: JSON.stringify(body) }),
    }),
    result = await response.json();
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  return { status: response.status, body: result, data: result.data };
}
beforeAll(async () => {
  f = await httpAdmissionFixture();
  photo = await composePhotoServices(f);
  analysis = await composeReportAnalysis(f);
  privacy = composeHttpPrivacy(f, photo);
  reportService = await createLocalReportAnalysisRuntime({
    mode: 'local-opt-in',
    scope: analysis.adapter,
    dependencies: {
      ...analysis.d,
      now: () => new Date(Date.now() + readClockOffset).toISOString(),
    },
    rights: createAnalysisErasureRepository(analysis.adapter, photo.bucket, [photo.key]),
  });
  const partner = await composePartnerServices(f),
    admission = createP2HttpAdmission(partner.service),
    routes = analysisPhotoRoutes({
      analysis: reportService,
      photos: photo.service,
      privacy: privacy.service,
      admission,
      secret: randomBytes(32),
    });
  host = await listenLocalApi((origin) =>
    createHttpApi({
      origin,
      routes,
      security: {
        authenticate: async (r) =>
          sessions.get(r.headers.get('authorization')?.slice(7) ?? '') ?? null,
        quota: async () => ({ allowed: !limited }),
      },
    }),
  );
}, 90000);
afterEach(() => {
  photo?.reset();
  analysis?.resetBehavior();
  limited = false;
  readClockOffset = 0;
});
afterAll(async () => {
  try {
    await host?.close();
  } finally {
    privacy?.cleanup();
    try {
      await photo?.cleanup();
    } finally {
      await f?.cleanup();
    }
  }
  console.log(
    'P2_ANALYSIS_HTTP_EVIDENCE ' +
      JSON.stringify({
        actualListeningLoopback: true,
        actualPostgreSQL: true,
        applicationMigrations: 54,
        actualIsolatedPhotoCodec: true,
        actualEncryptedVersionedStorage: true,
        identityScannerModelJournal: 'synthetic-ports',
        actualAuthenticationAccepted: false,
        actualModelEvaluation: false,
        actualPrivacyAcceptance: false,
        providerDispatches: 0,
        actualRecipientNotifications: 0,
        casesClosed: 0,
        gatesClosed: 0,
      }),
  );
}, 60000);
async function requested() {
  const e = await example(),
    raw = token(e.keys),
    input = { policyId: e.policy, allowed: e.input.allowed, noticeVersion: e.input.noticeVersion };
  const r = await call(raw, 'reports/' + e.report + '/versions/1/analysis', input, {
    key: e.input.key,
  });
  expect(r.status).toBe(200);
  return { ...e, raw, response: r };
}
async function intent() {
  const e = await photo.example(),
    raw = token(e.keys),
    { key: sourceKey, ...input } = e.input;
  const capture = await call(raw, 'photo-batches', { policyId: e.policy });
  expect(capture.status).toBe(200);
  const r = await call(
    raw,
    'photos',
    { ...input, batchId: capture.data.batchId },
    { key: sourceKey },
  );
  expect(r.status).toBe(200);
  return { ...e, raw, response: r };
}
async function ready() {
  const e = await intent();
  const r = await call(e.raw, 'photos/' + e.response.data.id + '/finalize', undefined, {
    bytes: e.bytes,
    grant: e.response.data.grant,
  });
  expect(r.status).toBe(200);
  return { ...e, uploaded: r };
}
it('creates a bounded owner request, reads safe status and exact attachment while retaining deterministic facts', async () => {
  const e = await requested(),
    before = (
      await f.admin.query(
        'SELECT input_snapshot,output_snapshot,snapshot_hash FROM app.report_versions WHERE report_id=$1',
        [e.report],
      )
    ).rows;
  expect(e.response.data.state).toBe('pending');
  expect((await call(e.raw, 'analysis/' + e.response.data.id)).data.state).toBe('pending');
  expect(value(await reportService.execute(e.response.data.id)).state).toBe('available');
  const status = await call(e.raw, 'analysis/' + e.response.data.id);
  expect(status.data.state).toBe('available');
  expect(JSON.stringify(status.body)).not.toMatch(
    /PRIVATE_ZIP|omit-this-note|providerRequestId|prompt_version|manifest|inputTokens/,
  );
  const attachment = await call(e.raw, 'reports/' + e.report + '/versions/1/analysis/attachment');
  expect(attachment.status).toBe(200);
  expect(attachment.data).toMatchObject({
    state: 'available',
    attachment: { revision: '1', kind: 'owner' },
  });
  expect(
    (
      await f.admin.query(
        'SELECT input_snapshot,output_snapshot,snapshot_hash FROM app.report_versions WHERE report_id=$1',
        [e.report],
      )
    ).rows,
  ).toEqual(before);
});
it('refuses anonymous, other-owner and share-only inference or invocation without creating requests or charging', async () => {
  const e = await requested(),
    other = token([(await f.owner()).token]),
    before = analysis.calls.length,
    requestsBefore = (await f.admin.query('SELECT count(*)::int n FROM app.ai_analysis_requests'))
      .rows[0]!.n;
  expect((await call('unknown', 'analysis/' + e.response.data.id)).status).toBe(401);
  expect((await call(other, 'analysis/' + e.response.data.id)).status).toBe(404);
  expect(
    (await call(other, 'reports/' + e.report + '/versions/1/analysis/attachment')).status,
  ).toBe(404);
  expect(
    (
      await call(token([]), 'reports/' + e.report + '/versions/1/analysis', {
        policyId: e.policy,
        allowed: true,
        noticeVersion: 'ai-processing-v1',
      })
    ).status,
  ).not.toBe(200);
  expect(
    (
      await call(other, 'reports/' + e.report + '/versions/1/analysis', {
        policyId: e.policy,
        allowed: true,
        noticeVersion: 'ai-processing-v1',
      })
    ).status,
  ).toBe(404);
  expect((await call(e.raw, 'analysis/' + e.response.data.id + '?token=share-only')).status).toBe(
    400,
  );
  expect(analysis.calls.length).toBe(before);
  expect(
    (await f.admin.query('SELECT count(*)::int n FROM app.ai_analysis_requests')).rows[0]!.n,
  ).toBe(requestsBefore);
});
it('does not repeat command effects and exact parameter reuse adds no model call', async () => {
  const e = await requested(),
    path = 'reports/' + e.report + '/versions/1/analysis',
    body = { policyId: e.policy, allowed: true, noticeVersion: 'ai-processing-v1' };
  expect((await call(e.raw, path, body, { key: e.input.key })).status).toBe(409);
  expect(value(await reportService.execute(e.response.data.id)).state).toBe('available');
  const before = analysis.calls.length;
  const reused = await call(e.raw, path, body);
  expect(reused.status).toBe(200);
  expect(reused.data.state).toBe('available');
  expect(analysis.calls.length).toBe(before);
});
it('commits withdrawal before cleanup and refuses attachment reads after permission is withdrawn', async () => {
  const e = await requested();
  value(await reportService.execute(e.response.data.id));
  const permission = (await call(e.raw, 'analysis/' + e.response.data.id)).data.processing;
  expect(permission).toMatchObject({ allowed: true, permissionRevision: '1' });
  const r = await call(e.raw, 'analysis/scopes/' + permission.scopeId + '/choice', {
    allowed: false,
    expectedRevision: permission.permissionRevision,
    noticeVersion: 'ai-processing-v1',
  });
  expect(r.status).toBe(200);
  expect(r.data.allowed).toBe(false);
  expect((await call(e.raw, 'analysis/' + e.response.data.id)).data.state).toBe('unavailable');
  expect(
    (await call(e.raw, 'reports/' + e.report + '/versions/1/analysis/attachment')).data.state,
  ).toBe('unavailable');
});
it('terminalizes exhausted reviewed cost admission without model dispatch or charge', async () => {
  const e = await example(0n),
    raw = token(e.keys),
    r = await call(raw, 'reports/' + e.report + '/versions/1/analysis', {
      policyId: e.policy,
      allowed: true,
      noticeVersion: 'ai-processing-v1',
    }),
    before = analysis.calls.length;
  expect(r.status).toBe(200);
  expect(value(await reportService.execute(r.data.id)).state).toBe('deferred');
  expect((await call(raw, 'analysis/' + r.data.id)).data).toMatchObject({
    state: 'unavailable',
    output: null,
  });
  expect(
    (
      await f.admin.query('SELECT count(*)::int n FROM app.ai_attempts WHERE request_id=$1', [
        r.data.id,
      ])
    ).rows[0]!.n,
  ).toBe(0);
  expect(analysis.calls.length).toBe(before);
});
it('uploads privately, extracts sanitized suggestions and applies only an explicit corrected confirmation', async () => {
  const e = await ready(),
    id = e.response.data.id,
    before = (await call(e.raw, 'photos/' + id)).data;
  expect(before.confirmations).toEqual([]);
  expect(before.candidates).toEqual([]);
  const extracted = await call(e.raw, 'photos/' + id + '/extract', {});
  expect(extracted.status).toBe(200);
  value(await photo.service.execute(extracted.data.id));
  const status = await call(e.raw, 'photos/' + id);
  expect(status.data.confirmations).toEqual([]);
  const candidate = status.data.candidates.find((c: { field: string }) => c.field === 'tire_size');
  expect(candidate).toBeDefined();
  const confirmed = await call(e.raw, 'photos/' + id + '/confirm', {
    candidateId: candidate.id,
    field: 'tire_size',
    revision: '1',
    value: '235/65R17',
  });
  expect(confirmed.status).toBe(200);
  expect(confirmed.data).toMatchObject({
    value: '235/65R17',
    origin: 'corrected_candidate',
    revision: '1',
  });
  expect((await call(e.raw, 'photos/' + id)).data.confirmations).toHaveLength(1);
  expect(JSON.stringify(status.body)).not.toMatch(
    /bucket|objectKey|sanitizedId|scopeId|providerRequestId|grant/,
  );
});
it('refuses wrong-owner upload/status/confirm/delete and a forged grant before codec or provider work', async () => {
  const e = await intent(),
    id = e.response.data.id,
    other = token([(await f.owner()).token]),
    before = photo.calls.length;
  expect((await call(other, 'photos/' + id)).status).toBe(404);
  expect(
    (
      await call(other, 'photos/' + id + '/finalize', undefined, {
        bytes: e.bytes,
        grant: e.response.data.grant,
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await call(e.raw, 'photos/' + id + '/finalize', undefined, {
        bytes: e.bytes,
        grant: 'f'.repeat(64),
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await call(other, 'photos/' + id + '/confirm', {
        candidateId: null,
        field: 'brand',
        revision: '1',
        value: 'Example',
      })
    ).status,
  ).toBe(404);
  expect((await call(other, 'photos/' + id, {}, { method: 'DELETE' })).status).toBe(404);
  expect(photo.calls.length).toBe(before);
});
it('deletes through the full journaled lifecycle, immediately denies reads and drains all owned object versions', async () => {
  const e = await ready(),
    id = e.response.data.id,
    r = await call(e.raw, 'photos/' + id, {}, { method: 'DELETE' });
  expect(r.status).toBe(202);
  expect(r.data.cleanupPending).toBe(true);
  expect((await call(e.raw, 'photos/' + id)).status).toBe(404);
  for (let n = 0; n < 80; n++) {
    const state = value(await privacy.service.status(r.data.jobId));
    if (state === 'complete') break;
    expect(state).toBe('pending');
    value(await privacy.service.workOne(r.data.jobId));
  }
  expect(value(await privacy.service.status(r.data.jobId))).toBe('complete');
  expect(privacy.journal.size).toBeGreaterThan(0);
  expect(
    (await f.admin.query('SELECT count(*)::int n FROM app.photo_service_intents WHERE id=$1', [id]))
      .rows[0]!.n,
  ).toBe(0);
});
it('refuses invalid notices, forged owner fields, unsupported condition claims, URLs, CSRF, quotas and noncanonical versions', async () => {
  const e = await example(),
    raw = token(e.keys),
    path = 'reports/' + e.report + '/versions/1/analysis',
    body = { policyId: e.policy, allowed: true, noticeVersion: 'ai-processing-v1' };
  expect((await call(raw, path, { ...body, noticeVersion: 'unknown' })).status).toBe(400);
  expect((await call(raw, path, { ...body, prompt: 'injected' })).status).toBe(400);
  expect((await call(raw, path, body, { headers: { 'x-csrf-token': 'bad' } })).status).toBe(403);
  expect(
    (await call(raw, path, body, { headers: { origin: 'https://elsewhere.example' } })).status,
  ).toBe(403);
  expect((await call(raw, 'reports/' + e.report + '/versions/1e0/analysis', body)).status).toBe(
    400,
  );
  expect(
    (
      await call(raw, 'photos/' + uuid('photo_upload') + '/confirm', {
        candidateId: null,
        field: 'safe_to_drive',
        revision: '1',
        value: 'yes',
      })
    ).status,
  ).toBe(400);
  limited = true;
  expect((await call(raw, path, body)).status).toBe(429);
  limited = false;
});
it('keeps declined processing unrequested and reports an expired queued request without model work', async () => {
  const e = await example(),
    raw = token(e.keys),
    path = 'reports/' + e.report + '/versions/1/analysis',
    body = { policyId: e.policy, allowed: false, noticeVersion: 'ai-processing-v1' },
    before = analysis.calls.length;
  expect((await call(raw, path, body)).data.state).toBe('not_requested');
  const pending = await call(raw, path, { ...body, allowed: true });
  expect(pending.data.state).toBe('pending');
  readClockOffset = 180000;
  expect((await call(raw, 'analysis/' + pending.data.id)).data.state).toBe('expired');
  expect(analysis.calls.length).toBe(before);
});
it('maps a validated provider refusal to unavailable without exposing provider output', async () => {
  const e = await requested();
  analysis.setBehavior(async () => ({
    state: 'refused',
    providerRequestId: 'synthetic-private-reference',
    inputTokens: 1n,
    outputTokens: 1n,
    costMinor: 1n,
  }));
  expect(value(await reportService.execute(e.response.data.id)).state).toBe('unavailable');
  const result = await call(e.raw, 'analysis/' + e.response.data.id);
  expect(result.data).toMatchObject({ state: 'unavailable', output: null });
  expect(JSON.stringify(result.body)).not.toContain('synthetic-private-reference');
});

async function example(limit = 100000n) {
  const e = await analysis.example(limit),
    cap = limit > 0n ? limit : 1n;
  await f.admin.query(
    `INSERT INTO app.ai_cost_plans(policy_id,configuration_hash,input_ceiling,output_ceiling,input_per_million_minor,output_per_million_minor,daily_limit,hourly_limit,owner_daily_limit,max_concurrency,status,reviewed_by) SELECT id,configuration_hash,65536,4096,100,100,$2,$2,$2,2,'active',$3 FROM app.ai_policy_versions WHERE id=$1`,
    [e.policy, cap.toString(), f.staff],
  );
  return e;
}

it('returns only current owner permission metadata and supports HTTP-only stale-revision recovery', async () => {
  const callsBefore = analysis.calls.length;
  const e = await requested(),
    path = 'analysis/' + e.response.data.id;
  const first = (await call(e.raw, path)).data.processing;
  expect(first).toMatchObject({ allowed: true, permissionRevision: '1' });
  const changed = await call(e.raw, 'analysis/scopes/' + first.scopeId + '/choice', {
    allowed: false,
    expectedRevision: first.permissionRevision,
    noticeVersion: 'ai-processing-v1',
  });
  expect(changed.status).toBe(200);
  const latest = (await call(e.raw, path)).data.processing;
  expect(latest).toEqual({
    scopeId: first.scopeId,
    permissionRevision: changed.data.permissionRevision,
    allowed: false,
  });
  expect(latest.permissionRevision).not.toBe(first.permissionRevision);
  expect(
    (
      await call(e.raw, 'analysis/scopes/' + first.scopeId + '/choice', {
        allowed: true,
        expectedRevision: first.permissionRevision,
        noticeVersion: 'ai-processing-v1',
      })
    ).status,
  ).toBe(409);
  const other = await call(token([(await f.owner()).token]), path);
  expect(other.status).toBe(404);
  expect(JSON.stringify(other.body)).not.toContain(first.scopeId);
  expect((await call('unknown', path)).status).toBe(401);
  expect(analysis.calls).toHaveLength(callsBefore);
});
