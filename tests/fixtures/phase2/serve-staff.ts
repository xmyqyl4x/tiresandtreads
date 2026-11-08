import { staffWebFixture } from './staff-web.ts';
if (process.argv.length !== 2) throw Error('Disposable staff preview accepts no arguments');
const f = await staffWebFixture('http://127.0.0.1:8380');
try {
  const prepared = await f.csv.prepared(),
    reviewed = await f.csv.reviewed();
  console.log(
    'LOCAL_P2_STAFF_READY ' +
      JSON.stringify({
        origin: f.web.webOrigin,
        intake: prepared.id,
        reviewedIntake: reviewed.id,
        reviewId: reviewed.review.id,
        template: f.example.template.id,
        provider: f.example.input.providerId,
        license: f.example.input.licenseId,
        uploader: f.uploader,
        reviewer: f.reviewer,
        publisher: f.publisher,
        verifier: f.p.verifier,
        moderator: f.p.moderator,
        pendingBusiness: f.pending.org,
        syntheticIdentity: true,
        disposable: true,
        actualAcceptance: false,
        providerDispatches: 0,
        actualRecipientNotifications: 0,
        casesClosed: 0,
        gatesClosed: 0,
      }),
  );
  await new Promise<void>((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
} finally {
  await f.cleanup();
}
