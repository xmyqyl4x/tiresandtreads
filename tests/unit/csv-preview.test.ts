import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { decodeCsvPreviewEvidence } from '../../packages/domain/src/csv-preview.ts';
const binding = {
    intakeId: randomUUID(),
    head: { bundleId: randomUUID(), revision: '1' },
    runRevision: '3',
    fence: '2',
    templateId: randomUUID(),
    rawHash: 'a'.repeat(64),
    packetHash: 'b'.repeat(64),
    parserRevision: 'installed-v1',
  },
  diff = {
    schema: 1,
    intakeId: binding.intakeId,
    head: binding.head,
    changes: [{ kind: 'tire_models', added: '9007199254740993', removed: '0', changed: '1' }],
  },
  validation = { schema: 1, ...binding, accepted: '9007199254740993', rejected: '0' };
delete (validation as Record<string, unknown>).head;
const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
it('returns exact review counts and validation provenance from matching immutable artifacts', () => {
  const result = decodeCsvPreviewEvidence(bytes(diff), bytes(validation), binding);
  expect(result.ok).toBe(true);
  if (result.ok)
    expect(result.value).toMatchObject({
      changes: [{ added: '9007199254740993' }],
      validation: { accepted: '9007199254740993', rejected: '0', runRevision: '3' },
    });
});
it('refuses artifacts for a different intake, source, head or validation revision', () => {
  for (const patch of [
    { intakeId: randomUUID() },
    { head: null },
    { head: { ...binding.head, revision: '2' } },
  ])
    expect(
      decodeCsvPreviewEvidence(bytes({ ...diff, ...patch }), bytes(validation), binding).ok,
    ).toBe(false);
  for (const patch of [
    { rawHash: 'c'.repeat(64) },
    { packetHash: 'c'.repeat(64) },
    { fence: '3' },
    { templateId: randomUUID() },
    { parserRevision: 'other' },
  ])
    expect(
      decodeCsvPreviewEvidence(bytes(diff), bytes({ ...validation, ...patch }), binding).ok,
    ).toBe(false);
});
it('refuses unknown fields, unbounded or malformed JSON and lossy counter values', () => {
  expect(
    decodeCsvPreviewEvidence(bytes({ ...diff, sql: 'injected' }), bytes(validation), binding).ok,
  ).toBe(false);
  expect(decodeCsvPreviewEvidence(new Uint8Array(65537), bytes(validation), binding).ok).toBe(
    false,
  );
  expect(decodeCsvPreviewEvidence(new Uint8Array([255]), bytes(validation), binding).ok).toBe(
    false,
  );
  for (const n of [1.2, '-1', '1.5', '184467440737095516160'])
    expect(
      decodeCsvPreviewEvidence(
        bytes({ ...diff, changes: [{ ...diff.changes[0], added: n }] }),
        bytes(validation),
        binding,
      ).ok,
    ).toBe(false);
});
