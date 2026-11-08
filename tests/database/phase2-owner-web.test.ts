import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { ownerWebFixture } from '../fixtures/phase2/owner-web.ts';
import { createP2OwnerClient } from '../../packages/contracts/src/phase2-owner-client.ts';
import { createP2PresentationClient } from '../../packages/contracts/src/phase2-presentation-client.ts';
import { createResultsClient } from '../../packages/contracts/src/results-client.ts';
import { createDeliveryPrivacyClient } from '../../packages/contracts/src/delivery-privacy-client.ts';
import { p2Id } from '../../packages/integrations/src/http/phase2-common.ts';
import { value } from '../fixtures/phase2/compose-partner-services.ts';
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
const path = () => ({ report: f.report, version: '1' });
beforeAll(async () => {
  f = await ownerWebFixture();
}, 90000);
afterAll(async () => {
  await f?.cleanup();
});
it('serves the opt-in private owner shell and authorizes metadata without processing or email on reads', async () => {
  const response = await f.web.request('/assisted-report'),
    html = await response.text();
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(html).toContain('Your report and optional assistance');
  expect(html).not.toContain(f.token);
  expect(html).not.toContain(f.report);
  const bundle = await f.web.request('/local-preview-assets/p2-owner-client.js');
  expect(bundle.status).toBe(200);
  expect(gzipSync(await bundle.text()).length).toBeLessThan(250000);
  const client = createP2PresentationClient(f.web.webOrigin, send(f.token));
  const p = (await client.p2AnalysisPresentation({ path: path() })).data;
  expect(p).toMatchObject({
    reportId: f.report,
    version: 1,
    latestRequest: null,
    selection: null,
    assistance: { available: true, noticeVersion: 'ai-processing-v1' },
  });
  const report = await createResultsClient(f.web.webOrigin, send(f.token)).read(f.report, 1);
  expect(report.output.issuanceAuthorized).toBe(false);
  expect(report.output.result.decisions.length).toBeGreaterThan(0);
  await expect(
    createP2PresentationClient(f.web.webOrigin, send(f.strangerToken)).p2AnalysisPresentation({
      path: path(),
    }),
  ).rejects.toBeDefined();
  expect(f.analysis.calls).toHaveLength(0);
  expect(f.delivery.provider.send).not.toHaveBeenCalled();
});
let revision: string;
it('shows pending, selected generation/reuse metadata and exact reuse without changing old report facts', async () => {
  const owner = createP2OwnerClient(f.web.webOrigin, send(f.token)),
    presentation = createP2PresentationClient(f.web.webOrigin, send(f.token));
  const original = (
    await f.f.admin.query(
      'SELECT input_snapshot,output_snapshot,snapshot_hash FROM app.report_versions WHERE report_id=$1',
      [f.report],
    )
  ).rows;
  const request = {
    path: path(),
    body: { policyId: f.example.policy, allowed: true, noticeVersion: 'ai-processing-v1' },
    command: command(),
  };
  const pending = (await owner.p2AnalysisRequest(request)).data;
  expect(pending.state).toBe('pending');
  expect((await presentation.p2AnalysisPresentation({ path: path() })).data.latestRequest).toBe(
    pending.id,
  );
  expect((await owner.p2AnalysisStatus({ path: { request: pending.id! } })).data.state).toBe(
    'pending',
  );
  value(await f.runtime.execute(p2Id('ai_request', pending.id)));
  const available = (await owner.p2AnalysisStatus({ path: { request: pending.id! } })).data;
  expect(available.state).toBe('available');
  const attached = (await owner.p2AnalysisAttachment({ path: path() })).data;
  expect(attached.state).toBe('available');
  if (attached.state !== 'available') throw Error('Attachment required');
  revision = attached.attachment.revision;
  const meta = (await presentation.p2AnalysisPresentation({ path: path() })).data;
  expect(meta.selection?.revision).toBe(revision);
  expect(Number.isFinite(Date.parse(meta.selection!.attachedAt))).toBe(true);
  const count = f.analysis.calls.length;
  expect((await owner.p2AnalysisRequest({ ...request, command: command() })).data.state).toBe(
    'available',
  );
  expect(f.analysis.calls).toHaveLength(count);
  expect(count).toBe(1);
  expect(
    (
      await f.f.admin.query(
        'SELECT input_snapshot,output_snapshot,snapshot_hash FROM app.report_versions WHERE report_id=$1',
        [f.report],
      )
    ).rows,
  ).toEqual(original);
  expect(f.delivery.provider.send).not.toHaveBeenCalled();
});
it('freezes only an explicitly selected revision, keeps send identity and permits owner cancellation', async () => {
  const owner = createP2OwnerClient(f.web.webOrigin, send(f.token)),
    delivery = createDeliveryPrivacyClient(f.web.webOrigin, send(f.token)),
    policy = await delivery.policy();
  const sent = (
    await owner.p2AnalysisDelivery({
      body: {
        email: 'owner-local@example.invalid',
        report: { id: f.report, version: 1 },
        offers: false,
        notices: { report: policy.notices.report },
        analysis: { attachmentRevision: revision, fallback: null },
      },
      command: command(),
    })
  ).data;
  expect(sent.state).toBe('scheduled');
  const row = await f.delivery.row(sent.id);
  expect(row.document.analysisIdentity.attachmentRevision).toBe(revision);
  expect(row.document.analysisIdentity.mode).toBe('artifact');
  const before = JSON.stringify(row.document);
  const status = await delivery.delivery(sent.id);
  expect(status.id).toBe(sent.id);
  const cancelled = await delivery.cancel(
    sent.id,
    { expectedRevision: status.revision, reason: 'cancel' },
    f.csrf,
    randomUUID(),
  );
  expect(cancelled.state).toBe('cancelled');
  expect(JSON.stringify((await f.delivery.row(sent.id)).document)).toBe(before);
  expect(f.delivery.provider.send).not.toHaveBeenCalled();
});
it('withdraws processing and redacts selection immediately while preserving deterministic and unconfigured fallback reads', async () => {
  const owner = createP2OwnerClient(f.web.webOrigin, send(f.token)),
    presentation = createP2PresentationClient(f.web.webOrigin, send(f.token));
  const p = (await presentation.p2AnalysisPresentation({ path: path() })).data,
    status = (await owner.p2AnalysisStatus({ path: { request: p.latestRequest! } })).data;
  expect(status.processing?.allowed).toBe(true);
  const choice = (
    await owner.p2AnalysisChoice({
      path: { scope: status.processing!.scopeId },
      body: {
        allowed: false,
        expectedRevision: status.processing!.permissionRevision,
        noticeVersion: 'ai-processing-v1',
      },
      command: command(),
    })
  ).data;
  expect(choice.allowed).toBe(false);
  expect((await owner.p2AnalysisAttachment({ path: path() })).data.state).toBe('unavailable');
  expect((await presentation.p2AnalysisPresentation({ path: path() })).data.selection).toBeNull();
  expect(
    (await createResultsClient(f.web.webOrigin, send(f.token)).read(f.report, 1)).reportId,
  ).toBe(f.report);
  await f.f.admin.query("UPDATE app.ai_policy_versions SET status='blocked' WHERE id=$1", [
    f.example.policy,
  ]);
  expect(
    (await presentation.p2AnalysisPresentation({ path: path() })).data.assistance,
  ).toMatchObject({ available: false, policyId: null });
  console.log(
    'P2_OWNER_WEB_EVIDENCE ' +
      JSON.stringify({
        actualNext: true,
        actualPostgreSQL: true,
        explicitChoice: true,
        immutableFacts: true,
        exactReuse: true,
        frozenDelivery: true,
        withdrawalRedacts: true,
        deterministicFallback: true,
        actualModelEvaluation: false,
        actualPrivacyAcceptance: false,
        actualS4S5Acceptance: false,
        productionActivation: false,
        providerDispatches: 0,
        actualRecipientNotifications: 0,
        casesClosed: 0,
        gatesClosed: 0,
      }),
  );
});

it('does not turn stale analysis sources into a report access failure', async () => {
  await f.f.admin.query(
    "UPDATE app.market_dataset_heads SET bundle_id=$1,revision=revision+1 WHERE market='US'",
    [f.previousBundle],
  );
  const p = (
    await createP2PresentationClient(f.web.webOrigin, send(f.token)).p2AnalysisPresentation({
      path: path(),
    })
  ).data;
  expect(p.assistance.available).toBe(false);
  expect(p.selection).toBeNull();
  expect(
    (await createResultsClient(f.web.webOrigin, send(f.token)).read(f.report, 1)).reportId,
  ).toBe(f.report);
});
