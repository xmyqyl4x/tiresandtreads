import { operationsWebFixture } from './operations-web.ts';
import { value } from './compose-partner-services.ts';
if (process.argv.length !== 2)
  throw Error('Fixed disposable operations preview accepts no arguments');
const f = await operationsWebFixture('http://127.0.0.1:8380');
try {
  const receiptReview = await f.seedReceiptReview();
  const capture = value(
    await f.photo.service.capture(f.example.keys, {
      policyId: f.photoExample.policy,
      key: 'preview-operations-capture',
    }),
  );
  const photo = value(
    await f.photo.service.intent(f.example.keys, {
      ...f.photoExample.input,
      batchId: capture.batchId,
      key: 'preview-operations-upload',
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
  value(
    await f.photo.service.confirm(f.example.keys, {
      uploadId: photo.id,
      candidateId: null,
      field: 'tire_size',
      value: '235/65R17',
      revision: '1',
    }),
  );
  const request = value(
    await f.runtime.request(f.example.keys, {
      policyId: f.example.policy,
      reportId: f.report,
      version: 1,
      allowed: true,
      noticeVersion: 'ai-processing-v1',
      key: 'preview-operations-request',
    }),
  );
  console.log(
    'LOCAL_P2_OPERATIONS_READY ' +
      JSON.stringify({
        origin: f.web.webOrigin,
        operator: f.operator.handle,
        observer: f.observer.handle,
        photoObserver: f.photoObserver.handle,
        owner: f.token,
        report: f.report,
        preparedPhoto: photo.id,
        queuedRequest: request.id,
        syntheticReceiptReview: receiptReview,
        disposable: true,
        syntheticOnly: true,
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
