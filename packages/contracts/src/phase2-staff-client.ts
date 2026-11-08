import { z, p2Uuid as id, p2Revision as rev } from './phase2-wire.ts';
import { csvApiContracts, csvApiInputs as inputs } from './phase2-partners.ts';
import { p2Operation, createP2Client } from './phase2-client.ts';
const empty = z.strictObject({}),
  text = z.string().max(2048),
  count = z.string().regex(/^[0-9]{1,19}$/),
  stamp = z.iso.datetime();
const column = z.object({
  name: text,
  type: z.enum(['text', 'integer', 'decimal', 'boolean', 'date', 'https_url']),
  required: z.boolean(),
  unit: z.enum(['none', 'mm', 'inch', 'minor_currency', 'percent']).optional(),
});
const template = {
  id,
  key: text,
  version: z.number().int().min(1),
  columns: z.array(column).max(128),
  maxBytes: z.number().int().min(1).max(16777216),
  maxRows: z.number().int().min(1).max(100000),
  state: z.enum(['draft', 'active', 'retired']),
};
const intake = z.object({
  id: id.nullable(),
  phase: z.enum([
    'invalid',
    'uploading',
    'registered',
    'prepared',
    'rejected',
    'cancelled',
    'published',
  ]),
  runId: id.nullable().optional(),
  errors: z.string().max(1048576),
});
const head = z.object({ bundleId: id, revision: count }).nullable();
const preview = z.object({
  id,
  intakeId: id,
  runId: id,
  runRevision: rev,
  fence: count,
  head,
  diffId: id,
  validationId: id,
  expiresAt: stamp,
  complete: z.boolean(),
  evidence: z.object({
    changes: z
      .array(z.object({ kind: text, added: count, removed: count, changed: count }))
      .max(64),
    validation: z.object({
      accepted: count,
      rejected: count,
      runRevision: rev,
      fence: count,
      templateId: id,
      parserRevision: text,
    }),
  }),
});
const contract = (name: string) => {
  const c = csvApiContracts.find((x) => x.operationId === name);
  if (!c) throw Error('Unknown staff operation');
  return c;
};
const post = <I extends z.ZodType, O extends z.ZodType>(name: string, input: I, output: O) =>
  p2Operation(contract(name), input, output, empty, true);
const get = <O extends z.ZodType>(name: string, output: O) =>
  p2Operation(contract(name), undefined, output, empty, false);
export const staffP2Operations = {
  p2CsvReceipt: get('p2CsvReceipt', z.object({ id, publicationBundleId: id })),
  p2CsvTemplate: post(
    'p2CsvTemplate',
    inputs.template,
    z.object({
      ...template,
      sourceKind: text,
      schemaVersion: text,
      mappingVersion: text,
      definitionHash: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  ),
  p2CsvSchema: get(
    'p2CsvSchema',
    z.object({ template: z.object(template), filename: text, csv: z.string().max(1048576) }),
  ),
  p2CsvRetire: post('p2CsvRetire', inputs.empty, z.object({})),
  p2CsvUpload: p2Operation(contract('p2CsvUpload'), undefined, intake, inputs.upload, true, true),
  p2CsvStatus: get(
    'p2CsvStatus',
    z.object({
      id,
      phase: text,
      runId: id.nullable(),
      expiresAt: stamp,
      publicationBundleId: id.nullable(),
    }),
  ),
  p2CsvErrors: get(
    'p2CsvErrors',
    z.object({ filename: text, mime: z.literal('text/csv'), csv: z.string().max(1048576) }),
  ),
  p2CsvValidate: post('p2CsvValidate', inputs.empty, intake),
  p2CsvPreview: post('p2CsvPreview', inputs.empty, preview),
  p2CsvReview: post(
    'p2CsvReview',
    inputs.review,
    z.object({
      id,
      intakeId: id,
      runRevision: rev,
      fence: count,
      decision: z.enum(['approved', 'rejected']),
      reason: text,
      expectedHead: count,
      diffId: id,
      validationId: id,
    }),
  ),
  p2CsvPublish: post('p2CsvPublish', inputs.publish, z.object({ value: id })),
  p2CsvCancel: post('p2CsvCancel', inputs.empty, z.object({})),
  p2CsvRollback: post(
    'p2CsvRollback',
    inputs.rollback,
    z.object({ value: z.union([z.string().max(100), z.boolean(), z.null()]).optional() }),
  ),
} as const;
export const createP2StaffClient = (base: string, transport: typeof fetch = fetch) =>
  createP2Client(staffP2Operations, base, transport);
