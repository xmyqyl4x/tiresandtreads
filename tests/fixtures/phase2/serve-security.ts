import { securityWebFixture } from './security-web.ts';
import { value, uuid } from './compose-partner-services.ts';
import { composeAnalysisDelivery } from './compose-analysis-delivery.ts';
import { securityRenderer } from './security-renderer.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
if (process.argv.length !== 2)
  throw Error('Fixed disposable security preview accepts no arguments');
const f = await securityWebFixture('http://127.0.0.1:8380');
let rendered: Awaited<ReturnType<typeof composeAnalysisDelivery>> | undefined;
try {
  const csv = await f.csv.prepared(),
    receiptReview = await f.seedReceiptReview(),
    capture = value(
      await f.photo.service.capture(f.example.keys, {
        policyId: f.photoExample.policy,
        key: 'security-preview-capture',
      }),
    ),
    photo = value(
      await f.photo.service.intent(f.example.keys, {
        ...f.photoExample.input,
        batchId: capture.batchId,
        key: 'security-preview-photo',
      }),
    );
  if (photo.state === 'manual') throw Error('Synthetic admission required');
  value(
    await f.photo.service.finalize(
      f.example.keys,
      { uploadId: photo.id, grant: photo.grant },
      f.photoExample.bytes,
    ),
  );
  // Separate renderer scenario leaves the primary report pending for explicit browser processing.
  const copy = value(
      await f.reports.reports.create(f.example.keys, 'security-render-' + uuid('command'), {
        market: 'US',
        regionKey: 'SYNTHETIC_PDF',
        configurationId: null,
        wheelPackage: null,
        sizes: { front: '225/45R18', rear: '255/40R18' },
        strategy: 'year_round',
        winterUse: 'none',
        replace: ['front_left', 'front_right', 'rear_left', 'rear_right'],
        priorities: ['wet'],
        budget: null,
      }),
    ),
    report = copy.report_id;
  if (!report) throw Error('Synthetic report receipt required');
  const request = value(
    await f.runtime.request(f.example.keys, {
      ...f.example.input,
      reportId: report,
      key: 'security-preview-render',
    }),
  );
  value(await f.runtime.execute(request.id!));
  const attachment = value(
    await f.runtime.attachment(f.example.keys, { reportId: report, version: 1 }),
  );
  if (attachment.state !== 'available' || !attachment.attachment)
    throw Error('Synthetic render attachment required');
  rendered = await composeAnalysisDelivery(
    f.f,
    undefined,
    { owner: f.example.owner, report },
    { baseRenderer: securityRenderer() },
  );
  const send = await rendered.request(undefined, {
    ...rendered.input,
    analysis: { attachmentRevision: attachment.attachment.revision.toString(), fallback: null },
  });
  await rendered.due(send.id);
  value(await rendered.service.dispatch(send.id));
  const mail = rendered.provider.send.mock.calls[0]![1].mail,
    pdf = Buffer.from(mail.pdf, 'base64');
  mkdirSync('.local', { recursive: true });
  writeFileSync('.local/security-report.pdf', pdf);
  writeFileSync('.local/security-report.html', mail.html);
  console.log(
    'LOCAL_P2_SECURITY_READY ' +
      JSON.stringify({
        origin: f.web.webOrigin,
        operator: f.operator.handle,
        observer: f.observer.handle,
        owner: f.token,
        report: f.report,
        company: f.company,
        otherCompany: f.otherCompany,
        verifier: f.p.verifier,
        moderator: f.p.moderator,
        pending: f.pending.org,
        uploader: f.uploader,
        reviewer: f.reviewer,
        publisher: f.publisher,
        csv: { intake: csv.id, template: csv.template.id },
        preparedPhoto: photo.id,
        syntheticReceiptReview: receiptReview,
        renderedPdfSha256: createHash('sha256').update(pdf).digest('hex'),
        renderedPdfBytes: pdf.length,
        startupSyntheticModelCalls: f.analysis.calls.length,
        syntheticOnly: true,
        disposable: true,
        actualAcceptance: false,
        providerDispatches: 0,
        actualRecipientNotifications: 0,
        casesClosed: 0,
        gatesClosed: 0,
      }),
  );
  const originals = {
    operator: f.operator.handle,
    observer: f.observer.handle,
    uploader: f.uploader,
    reviewer: f.reviewer,
    publisher: f.publisher,
    verifier: f.p.verifier,
    moderator: f.p.moderator,
  };
  let renewals = 0;
  function renewSyntheticStaff() {
    // An explicit owned-process signal models the fixture issuer giving the SAME actors
    // new short-lived credentials. No role/DB/MFA policy change, HTTP endpoint or real IdP.
    if (renewals >= 8) {
      console.error('Synthetic issuer renewal bound reached');
      return;
    }
    const handles: Record<string, string> = {};
    for (const [name, handle] of Object.entries(originals)) {
      const principal = f.p.sessions.get(handle);
      if (!principal?.staffId) throw Error('Fixed synthetic staff identity missing');
      handles[name] = f.p.session(principal.subject, principal.staffId, principal.emailDomain);
    }
    console.log(
      'LOCAL_P2_SECURITY_REAUTH ' +
        JSON.stringify({
          ...handles,
          round: ++renewals,
          syntheticOnly: true,
          actualAuthenticationAccepted: false,
          roleAssignmentsChanged: false,
        }),
    );
  }
  process.on('SIGUSR2', renewSyntheticStaff);
  try {
    await new Promise<void>((resolve) => {
      process.once('SIGINT', resolve);
      process.once('SIGTERM', resolve);
    });
  } finally {
    process.off('SIGUSR2', renewSyntheticStaff);
  }
} finally {
  try {
    await rendered?.cleanup();
  } finally {
    await f.cleanup();
  }
}
