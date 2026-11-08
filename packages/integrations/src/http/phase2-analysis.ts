import {
  analysisStatusView,
  analysisAttachmentView,
  photoStatusView,
  photoConfirmationView,
} from '../../../contracts/src/phase2-analysis.ts';
import { privateAnalysisView } from './phase2-analysis-views.ts';
import { z } from '../../../contracts/src/phase2-wire.ts';
import {
  analysisApiContracts,
  analysisApiInputs,
  photoApiInputs,
} from '../../../contracts/src/phase2-analysis.ts';
import type { createReportAnalysisServices } from '../../../application/src/analysis/report-analysis.ts';
import type { createPhotoServices } from '../../../application/src/analysis/photo-services.ts';
import type { createAnalysisErasureServices } from '../../../application/src/analysis/analysis-lifecycle.ts';
import {
  p2Commands,
  p2Id,
  p2Parse,
  p2Query,
  p2Project,
  type P2HttpAdmission,
} from './phase2-common.ts';
import { HttpSuccess, type HttpContext, type HttpRoute } from './core.ts';
import { ok } from '../../../domain/src/values/core.ts';
export function analysisPhotoRoutes(
  d: Readonly<{
    analysis: ReturnType<typeof createReportAnalysisServices>;
    photos: ReturnType<typeof createPhotoServices>;
    privacy: Pick<ReturnType<typeof createAnalysisErasureServices>, 'removeScope' | 'save'>;
    admission: P2HttpAdmission;
    secret: Uint8Array;
  }>,
): readonly HttpRoute[] {
  const command = p2Commands(d.admission, d.secret),
    routes: HttpRoute[] = [],
    empty = z.strictObject({}),
    upload = (c: HttpContext) => p2Id('photo_upload', c.params.upload),
    version = (c: HttpContext) =>
      p2Parse(
        z.number().int().min(1).max(2147483647),
        Number(p2Parse(z.string().regex(/^[1-9][0-9]{0,9}$/), c.params.version)),
      );
  function post<T>(
    name: string,
    schema: z.ZodType<T>,
    work: (c: HttpContext, v: T) => ReturnType<HttpRoute['handle']>,
    fields: readonly string[],
    view?: z.ZodType,
  ) {
    const contract = analysisApiContracts.find((x) => x.operationId === name)!;
    routes.push({
      ...contract,
      handle: async (c) => {
        p2Query(c, empty);
        const value = p2Parse(schema, c.body);
        return command.execute(c, name, value, async () => {
          const result = await work(c, value);
          return view ? privateAnalysisView(view, result) : p2Project(result, fields);
        });
      },
    });
  }
  function get(
    name: string,
    work: HttpRoute['handle'],
    fields: readonly string[],
    view?: z.ZodType,
  ) {
    const contract = analysisApiContracts.find((x) => x.operationId === name)!;
    routes.push({
      ...contract,
      handle: async (c) => {
        p2Query(c, empty);
        const result = await work(c);
        return view ? privateAnalysisView(view, result) : p2Project(result, fields);
      },
    });
  }
  post(
    'p2AnalysisRequest',
    analysisApiInputs.request,
    (c, v) =>
      d.analysis.request(c.actor!.keys, {
        ...v,
        reportId: p2Id('report', c.params.report),
        version: version(c),
        key: c.key,
      }),
    ['id', 'state', 'reportId', 'version', 'output'],
    analysisStatusView,
  );
  get(
    'p2AnalysisStatus',
    (c) => d.analysis.status(c.actor!.keys, p2Id('ai_request', c.params.request)),
    ['id', 'state', 'reportId', 'version', 'output', 'processing'],
    analysisStatusView,
  );
  get(
    'p2AnalysisAttachment',
    (c) =>
      d.analysis.attachment(c.actor!.keys, {
        reportId: p2Id('report', c.params.report),
        version: version(c),
      }),
    ['state', 'reportId', 'version', 'attachment'],
    analysisAttachmentView,
  );
  post(
    'p2AnalysisChoice',
    analysisApiInputs.choice,
    (c, v) => d.analysis.choice(c.actor!.keys, { ...v, scopeId: p2Id('ai_scope', c.params.scope) }),
    ['allowed', 'permissionRevision', 'cleanupPending'],
  );
  post(
    'p2PhotoCapture',
    photoApiInputs.capture,
    (c, v) => d.photos.capture(c.actor!.keys, { ...v, key: c.key }),
    ['batchId'],
  );
  post(
    'p2PhotoIntent',
    photoApiInputs.intent,
    (c, v) => d.photos.intent(c.actor!.keys, { ...v, key: c.key }),
    ['state', 'id', 'grant', 'grantUntil'],
  );
  const finalize = analysisApiContracts.find((x) => x.operationId === 'p2PhotoFinalize')!;
  routes.push({
    ...finalize,
    handle: async (c) => {
      p2Query(c, empty);
      const id = upload(c),
        grant = p2Parse(photoApiInputs.finalize, c.request.headers.get('x-upload-grant'));
      const bytes = p2Parse(z.instanceof(Uint8Array), c.body);
      return command.execute(c, finalize.operationId, { id, grant, bytes }, async () =>
        privateAnalysisView(
          photoStatusView,
          await d.photos.finalize(c.actor!.keys, { uploadId: id, grant }, bytes),
        ),
      );
    },
  });
  post(
    'p2PhotoExtract',
    photoApiInputs.extract,
    (c) => d.photos.extract(c.actor!.keys, { uploadId: upload(c), key: c.key }),
    ['id', 'state'],
  );
  get(
    'p2PhotoStatus',
    (c) => d.photos.get(c.actor!.keys, upload(c)),
    ['id', 'state', 'expiresAt', 'dotStatus', 'candidates', 'confirmations', 'limitations'],
    photoStatusView,
  );
  post(
    'p2PhotoConfirm',
    photoApiInputs.confirm,
    (c, v) => d.photos.confirm(c.actor!.keys, { ...v, uploadId: upload(c) }),
    ['uploadId', 'field', 'revision', 'candidateId', 'origin', 'value', 'confirmedAt'],
    photoConfirmationView,
  );
  const remove = analysisApiContracts.find((x) => x.operationId === 'p2PhotoDelete')!;
  routes.push({
    ...remove,
    handle: async (c) => {
      p2Query(c, empty);
      p2Parse(photoApiInputs.remove, c.body);
      const id = upload(c);
      return command.execute(c, remove.operationId, {}, async () => {
        const target = await d.photos.deletionTarget(c.actor!.keys, id);
        if (!target.ok) return p2Project(target, []);
        const job = await d.privacy.removeScope(c.actor!.keys, target.value, c.key);
        if (!job.ok) return p2Project(job, []);
        return ok(new HttpSuccess(202, { id, jobId: job.value, cleanupPending: true }));
      });
    },
  });
  post(
    'p2PhotoSave',
    photoApiInputs.save,
    (c, v) => d.privacy.save(c.actor!.keys, { ...v, uploadId: upload(c), command: c.key }),
    [],
  );
  return routes;
}
