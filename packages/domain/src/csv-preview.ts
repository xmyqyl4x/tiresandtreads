import { invalid, ok, id, type Result } from './values/core.ts';
export interface CsvEvidenceBinding {
  readonly intakeId: string;
  readonly head: Readonly<{ bundleId: string; revision: string }> | null;
  readonly runRevision: string;
  readonly fence: string;
  readonly templateId: string;
  readonly rawHash: string;
  readonly packetHash: string;
  readonly parserRevision: string;
}
export interface CsvEvidenceView {
  readonly changes: readonly Readonly<{
    kind: string;
    added: string;
    removed: string;
    changed: string;
  }>[];
  readonly validation: Readonly<{
    accepted: string;
    rejected: string;
    runRevision: string;
    fence: string;
    templateId: string;
    parserRevision: string;
  }>;
}
export function decodeCsvPreviewEvidence(
  diff: Uint8Array,
  validation: Uint8Array,
  binding: CsvEvidenceBinding,
): Result<CsvEvidenceView> {
  try {
    function demand(value: unknown): asserts value {
      if (!value) throw Error('Invalid evidence');
    }
    function object(value: unknown, keys: string) {
      demand(
        value &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          Object.keys(value).sort().join(',') === keys,
      );
      return value as Record<string, unknown>;
    }
    function count(value: unknown) {
      demand(
        typeof value === 'string' &&
          /^(0|[1-9][0-9]{0,18})$/.test(value) &&
          BigInt(value) <= 9223372036854775807n,
      );
      return value;
    }
    function word(value: unknown, max: number) {
      demand(
        typeof value === 'string' &&
          value.length >= 1 &&
          value.length <= max &&
          !/[<>]/.test(value) &&
          !Array.from(value).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127),
      );
      return value;
    }
    function parse(bytes: Uint8Array, max: number) {
      demand(bytes instanceof Uint8Array && bytes.byteLength >= 1 && bytes.byteLength <= max);
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
    }
    const d = object(parse(diff, 65536), 'changes,head,intakeId,schema'),
      v = object(
        parse(validation, 16384),
        'accepted,fence,intakeId,packetHash,parserRevision,rawHash,rejected,runRevision,schema,templateId',
      );
    demand(id('csv_intake', binding.intakeId).ok && id('csv_template', binding.templateId).ok);
    demand(
      d.schema === 1 &&
        v.schema === 1 &&
        d.intakeId === binding.intakeId &&
        v.intakeId === binding.intakeId,
    );
    if (binding.head === null) demand(d.head === null);
    else {
      const head = object(d.head, 'bundleId,revision');
      demand(
        id('bundle', head.bundleId).ok &&
          head.bundleId === binding.head.bundleId &&
          count(head.revision) === binding.head.revision,
      );
    }
    for (const key of [
      'runRevision',
      'fence',
      'templateId',
      'rawHash',
      'packetHash',
      'parserRevision',
    ] as const)
      demand(v[key] === binding[key]);
    demand(/^[a-f0-9]{64}$/.test(binding.rawHash) && /^[a-f0-9]{64}$/.test(binding.packetHash));
    demand(Array.isArray(d.changes) && d.changes.length <= 128);
    const changes = d.changes.map((value) => {
      const row = object(value, 'added,changed,kind,removed');
      return Object.freeze({
        kind: word(row.kind, 80),
        added: count(row.added),
        removed: count(row.removed),
        changed: count(row.changed),
      });
    });
    demand(new Set(changes.map((x) => x.kind)).size === changes.length);
    return ok(
      Object.freeze({
        changes: Object.freeze(changes),
        validation: Object.freeze({
          accepted: count(v.accepted),
          rejected: count(v.rejected),
          runRevision: count(v.runRevision),
          fence: count(v.fence),
          templateId: binding.templateId,
          parserRevision: word(binding.parserRevision, 200),
        }),
      }),
    );
  } catch {
    return invalid('csv_evidence');
  }
}
