import type {
  StaffCsvRepository,
  CsvCommand,
  CsvPreview,
  CsvPublication,
} from '../../../application/src/ports/staff-csv.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import {
  uid,
  word,
  num,
  hash,
  at,
  object,
  bool,
  big,
  revisionValue,
  choice,
} from './analysis-values.ts';
import { csvReviewFromRow } from './csv-review-mappers.ts';
import { stored } from './analysis-values.ts';
import { boundedJson } from './bounds.ts';
function command(raw: unknown): CsvCommand {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return stop('integrity');
  const r = raw as Record<string, unknown>,
    m = object(r.registration, 16384);
  if (m.schemaVersion !== '1' || m.mappingVersion !== '1' || m.semantics !== 'complete_snapshot')
    return stop('integrity');
  return Object.freeze({
    id: uid('csv_intake', r.id),
    actorId: uid('staff', r.actor_id),
    templateId: uid('csv_template', r.template_id),
    assetId: uid('asset', r.asset_id),
    jobId: uid('job', r.job_id),
    providerId: uid('provider', r.provider_id),
    licenseId: uid('license', r.license_id),
    market: word(r.market, 10),
    rawHash: hash(r.raw_hash),
    packetHash: hash(r.packet_hash),
    fingerprint: hash(r.fingerprint),
    expiresAt: at(r.expires_at),
    runId: r.run_id === null ? null : uid('import_run', r.run_id),
    phase: choice(r.phase, [
      'uploading',
      'registered',
      'prepared',
      'rejected',
      'cancelled',
      'published',
    ]),
    registration: Object.freeze({
      id: uid('dataset', m.id),
      providerId: uid('provider', m.providerId),
      licenseId: uid('license', m.licenseId),
      kind: word(m.kind, 80),
      externalVersion: word(m.externalVersion, 200),
      checksum: hash(m.checksum),
      effectiveAt: at(m.effectiveAt),
      fetchedAt: at(m.fetchedAt),
      upstreamRunKey: word(m.upstreamRunKey, 200),
      schemaVersion: '1',
      mappingVersion: '1',
      semantics: 'complete_snapshot',
      expectedRows: num(m.expectedRows, 1, 100000),
    }),
  });
}
function members(raw: unknown): CsvPreview['members'] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 16) return stop('integrity');
  return Object.freeze(
    raw.map((v) => {
      const m = object(v);
      return Object.freeze({
        key: word(m.key, 80),
        kind: word(m.kind, 80),
        datasetId: uid('dataset', m.datasetId),
      });
    }),
  );
}
function preview(raw: unknown): CsvPreview {
  const r = object(raw, 32768);
  return Object.freeze({
    id: uid('csv_preview', r.id),
    intakeId: uid('csv_intake', r.intake_id),
    runId: uid('import_run', r.run_id),
    runRevision: revisionValue(r.run_revision),
    fence: big(r.run_fence, 1n),
    head:
      r.head_bundle === null
        ? null
        : Object.freeze({
            bundleId: uid('bundle', r.head_bundle),
            revision: revisionValue(r.head_revision),
          }),
    diffId: uid('import_artifact', r.diff_id),
    validationId: uid('import_artifact', r.validation_id),
    diffAssetId: uid('asset', r.diff_asset),
    validationAssetId: uid('asset', r.validation_asset),
    members: members(r.members),
    expiresAt: at(r.expires_at),
    complete: bool(r.complete),
  });
}
function publication(raw: unknown): CsvPublication {
  const r = object(raw, 32768),
    head = r.head === null ? null : object(r.head);
  return Object.freeze({
    runId: uid('import_run', r.runId),
    bundleId: uid('bundle', r.bundleId),
    market: word(r.market, 10),
    head: head
      ? Object.freeze({
          bundleId: uid('bundle', head.bundleId),
          revision: revisionValue(head.revision),
        })
      : null,
    approvalId: uid('audit_event', r.approvalId),
    members: members(r.members),
    published: bool(r.published),
  });
}
export function createStaffCsvRepository(s: WriteScope): StaffCsvRepository {
  const q = s.query;
  return guarded<StaffCsvRepository>(s, {
    async rollbackMarket(tx, actor, intake) {
      const row = (
        await s.query(tx, 'SELECT admin.csv_http_rollback_market($1,$2) AS market', [
          uid('staff', actor),
          uid('csv_intake', intake),
        ])
      ).rows[0];
      return word(row?.market, 2);
    },
    async authorize(tx, actor, permission) {
      return revisionValue(
        (
          await q(tx, 'SELECT admin.csv_service_actor($1,$2)::text AS revision', [
            uid('staff', actor),
            choice(permission, ['data.review', 'data.publish']),
          ])
        ).rows[0]?.revision,
      );
    },
    async reserve(tx, actor, input) {
      return command(
        (
          await q(tx, 'SELECT * FROM admin.csv_service_reserve($1,$2)', [
            uid('staff', actor),
            boundedJson(input, 24576),
          ])
        ).rows[0],
      );
    },
    async command(tx, actor, id) {
      return command(
        (
          await q(tx, 'SELECT * FROM admin.csv_service_command($1,$2)', [
            uid('staff', actor),
            uid('csv_intake', id),
          ])
        ).rows[0],
      );
    },
    async bind(tx, actor, id, run) {
      await q(tx, 'SELECT admin.csv_service_bind($1,$2,$3)', [
        uid('staff', actor),
        uid('csv_intake', id),
        uid('import_run', run),
      ]);
    },
    async prepared(tx, actor, id) {
      await q(tx, 'SELECT admin.csv_service_prepared($1,$2)', [
        uid('staff', actor),
        uid('csv_intake', id),
      ]);
    },
    async cancel(tx, actor, id, evidence) {
      await q(tx, 'SELECT admin.csv_service_cancel($1,$2,$3)', [
        uid('staff', actor),
        uid('csv_intake', id),
        hash(evidence),
      ]);
    },
    async preview(tx, actor, id, key, pid) {
      return preview(
        (
          await q(tx, 'SELECT admin.csv_service_preview($1,$2,$3,$4) AS value', [
            uid('staff', actor),
            uid('csv_intake', id),
            hash(key),
            uid('csv_preview', pid),
          ])
        ).rows[0]?.value,
      );
    },
    async completePreview(tx, actor, p, diff, validation) {
      return preview(
        (
          await q(tx, 'SELECT admin.csv_service_complete_preview($1,$2,$3,$4) AS value', [
            uid('staff', actor),
            uid('csv_preview', p.id),
            hash(diff),
            hash(validation),
          ])
        ).rows[0]?.value,
      );
    },
    async reviewReplay(tx, actor, id) {
      const r = (
        await q(tx, 'SELECT admin.csv_service_review_replay($1,$2) AS value', [
          uid('staff', actor),
          uid('csv_review', id),
        ])
      ).rows[0]?.value;
      return r === null ? null : stored(csvReviewFromRow(object(r)));
    },
    async reviewBasis(tx, actor, pid) {
      const p = preview(
        (
          await q(tx, 'SELECT admin.csv_service_review_basis($1,$2) AS value', [
            uid('staff', actor),
            uid('csv_preview', pid),
          ])
        ).rows[0]?.value,
      );
      return Object.freeze({
        intakeId: p.intakeId,
        runRevision: p.runRevision,
        fence: p.fence,
        expectedHead: p.head?.revision ?? 0n,
        diffId: p.diffId,
        validationId: p.validationId,
      });
    },
    async publication(tx, actor, id, review, key, bundle) {
      return publication(
        (
          await q(tx, 'SELECT admin.csv_service_publication($1,$2,$3,$4,$5) AS value', [
            uid('staff', actor),
            uid('csv_intake', id),
            uid('csv_review', review),
            hash(key),
            uid('bundle', bundle),
          ])
        ).rows[0]?.value,
      );
    },
  });
}
