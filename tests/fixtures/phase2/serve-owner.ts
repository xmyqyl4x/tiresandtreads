import { ownerWebFixture } from './owner-web.ts';
import { p2Id } from '../../../packages/integrations/src/http/phase2-common.ts';
if (process.argv.length !== 2) throw Error('Disposable owner preview accepts no arguments');
const f = await ownerWebFixture('http://127.0.0.1:8380');
let running: Promise<unknown> | null = null;
// Only this fixed synthetic owner's queued report work. The provider is an in-memory fixture.
const worker = setInterval(() => {
  if (running) return;
  running = (async () => {
    const row = (
      await f.f.admin.query(
        "SELECT w.request_id FROM app.ai_report_work w JOIN app.ai_analysis_requests r ON r.id=w.request_id WHERE w.owner_subject_id=$1 AND w.report_id=$2 AND w.report_version=1 AND r.state='queued' ORDER BY w.request_id LIMIT 1",
        [f.example.owner.identity.subjectId, f.report],
      )
    ).rows[0];
    if (row) await f.runtime.execute(p2Id('ai_request', row.request_id));
  })()
    .catch(() => console.log('LOCAL_P2_OWNER_WORKER_REFUSED'))
    .finally(() => {
      running = null;
    });
}, 5000);
try {
  console.log(
    'LOCAL_P2_OWNER_READY ' +
      JSON.stringify({
        origin: f.web.webOrigin,
        token: f.token,
        report: f.report,
        version: 1,
        disposable: true,
        syntheticIdentity: true,
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
  clearInterval(worker);
  await running;
  await f.cleanup();
}
