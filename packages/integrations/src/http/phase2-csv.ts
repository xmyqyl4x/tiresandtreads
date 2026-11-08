import { z } from '../../../contracts/src/phase2-partners.ts';
import { csvApiContracts, csvApiInputs as inputs } from '../../../contracts/src/phase2-partners.ts';
import type { createStaffCsvServices } from '../../../application/src/imports/staff-csv.ts';
import {
  p2Commands,
  p2Parse,
  p2Query,
  p2Project,
  p2Id,
  type P2HttpAdmission,
} from './phase2-common.ts';
import { HttpFailure, type HttpContext, type HttpRoute } from './core.ts';
export function staffCsvRoutes(
  d: Readonly<{
    service: ReturnType<typeof createStaffCsvServices>;
    admission: P2HttpAdmission;
    secret: Uint8Array;
  }>,
): readonly HttpRoute[] {
  const command = p2Commands(d.admission, d.secret),
    s = d.service,
    actor = (c: HttpContext) => {
      if (!c.actor?.staff) throw new HttpFailure(401, 'unauthorized');
      return c.actor.staff;
    },
    intake = (c: HttpContext) => p2Id('csv_intake', c.params.intake),
    routes: HttpRoute[] = [];
  function add<T>(
    operationId: string,
    schema: z.ZodType<T>,
    work: (c: HttpContext, v: T) => ReturnType<HttpRoute['handle']>,
    fields: readonly string[],
  ) {
    const contract = csvApiContracts.find((x) => x.operationId === operationId)!;
    routes.push({
      ...contract,
      handle: async (c) => {
        p2Query(c, z.strictObject({}));
        const value = p2Parse(schema, c.body);
        return command.execute(c, operationId, value, async () =>
          p2Project(await work(c, value), fields),
        );
      },
    });
  }
  function get(operationId: string, work: HttpRoute['handle'], fields: readonly string[]) {
    const contract = csvApiContracts.find((x) => x.operationId === operationId)!;
    routes.push({
      ...contract,
      handle: async (c) => {
        p2Query(c, z.strictObject({}));
        return p2Project(await work(c), fields);
      },
    });
  }
  add('p2CsvTemplate', inputs.template, (c, v) => s.createTemplate(actor(c), v), [
    'id',
    'key',
    'version',
    'sourceKind',
    'schemaVersion',
    'mappingVersion',
    'columns',
    'maxBytes',
    'maxRows',
    'state',
    'definitionHash',
  ]);
  get('p2CsvSchema', (c) => s.template(actor(c), p2Id('csv_template', c.params.template)), [
    'template.id',
    'template.key',
    'template.version',
    'template.columns',
    'template.maxBytes',
    'template.maxRows',
    'template.state',
    'filename',
    'csv',
  ]);
  add(
    'p2CsvRetire',
    inputs.empty,
    (c) => s.retire(actor(c), p2Id('csv_template', c.params.template)),
    [],
  );
  const upload = csvApiContracts.find((x) => x.operationId === 'p2CsvUpload')!;
  routes.push({
    ...upload,
    handle: async (c) => {
      const v = p2Query(c, inputs.upload);
      if (!(c.body instanceof Uint8Array)) throw new HttpFailure(400, 'invalid_input');
      return command.execute(c, upload.operationId, { v, bytes: c.body }, async () =>
        p2Project(await s.upload(actor(c), { ...v, command: c.key }, c.body as Uint8Array), [
          'id',
          'phase',
          'runId',
          'errors',
        ]),
      );
    },
  });
  get('p2CsvStatus', (c) => s.status(actor(c), intake(c)), ['id', 'phase', 'runId', 'expiresAt']);
  get('p2CsvErrors', (c) => s.errors(actor(c), intake(c)), ['filename', 'mime', 'csv']);
  add('p2CsvValidate', inputs.empty, (c) => s.validate(actor(c), intake(c)), [
    'id',
    'phase',
    'runId',
    'errors',
  ]);
  add(
    'p2CsvPreview',
    inputs.empty,
    (c) => s.preview(actor(c), { intakeId: intake(c), command: c.key }),
    [
      'id',
      'intakeId',
      'runId',
      'runRevision',
      'fence',
      'head',
      'diffId',
      'validationId',
      'expiresAt',
      'complete',
    ],
  );
  add('p2CsvReview', inputs.review, (c, v) => s.review(actor(c), { ...v, command: c.key }), [
    'id',
    'intakeId',
    'runId',
    'decision',
    'reason',
    'runRevision',
    'fence',
    'expectedHead',
    'diffId',
    'validationId',
  ]);
  add(
    'p2CsvPublish',
    inputs.publish,
    (c, v) => s.publish(actor(c), { ...v, intakeId: intake(c), command: c.key }),
    [],
  );
  add(
    'p2CsvCancel',
    inputs.empty,
    (c) => s.cancel(actor(c), { intakeId: intake(c), command: c.key }),
    [],
  );
  add(
    'p2CsvRollback',
    inputs.rollback,
    (c, v) => s.rollback(actor(c), { ...v, intakeId: intake(c) }),
    [],
  );
  return routes;
}
