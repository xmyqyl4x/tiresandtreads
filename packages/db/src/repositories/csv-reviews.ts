import type { CsvReviewRepository } from '../../../application/src/ports/csv-review-repositories.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { uid, at, hash, word, stored, num, big, revisionValue, choice } from './analysis-values.ts';
import {
  columns,
  csvTemplateFromRow,
  csvWorkflowFromRow,
  csvReviewFromRow,
} from './csv-review-mappers.ts';
import { cursor, nextCursor, pageLimit, boundedJson, reject } from './bounds.ts';
import type { TransactionContext as Tx } from '../../../application/src/ports/transactions.ts';
async function actor(s: WriteScope, tx: Tx, input: unknown) {
  const id = uid('staff', input);
  const row = (
    await s.query(
      tx,
      "SELECT set_config('tt.p2_csv_actor',$1,true),admin.csv_staff_current($1::uuid) AS allowed",
      [id],
    )
  ).rows[0];
  if (row?.allowed !== true) return stop('forbidden');
  return id;
}
export function createCsvReviewRepository(s: WriteScope): CsvReviewRepository {
  return guarded<CsvReviewRepository>(s, {
    async template(tx, person, id) {
      await actor(s, tx, person);
      const r = (
        await s.query(tx, 'SELECT * FROM admin.csv_template_versions WHERE id=$1', [
          uid('csv_template', id),
        ])
      ).rows[0];
      return r ? stored(csvTemplateFromRow(r)) : null;
    },
    async createTemplate(tx, person, input) {
      const i = {
        id: uid('csv_template', input.id),
        key: word(input.key, 64),
        version: num(input.version, 1),
        source: word(input.sourceKind, 80),
        schema: word(input.schemaVersion, 80),
        mapping: word(input.mappingVersion, 80),
        parser: word(input.parserRevision, 40),
        hash: hash(input.definitionHash),
        columns: columns(input.columns),
        bytes: num(input.maxBytes, 1, 20971520),
        rows: num(input.maxRows, 1, 100000),
        state: choice(input.state, ['draft', 'active']),
      };
      if (!/^[a-z][a-z0-9_]{0,63}$/.test(i.key) || !/^[a-f0-9]{40}$/.test(i.parser))
        return reject();
      const personId = await actor(s, tx, person);
      await s.query(
        tx,
        'INSERT INTO admin.csv_template_versions(id,template_key,version,source_kind,schema_version,mapping_version,parser_revision,definition_hash,columns,max_bytes,max_rows,state,reviewed_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
        [
          i.id,
          i.key,
          i.version,
          i.source,
          i.schema,
          i.mapping,
          i.parser,
          i.hash,
          boundedJson(i.columns, 65536),
          i.bytes,
          i.rows,
          i.state,
          personId,
        ],
      );
      return stored(
        csvTemplateFromRow(
          (await s.query(tx, 'SELECT * FROM admin.csv_template_versions WHERE id=$1', [i.id]))
            .rows[0]!,
        ),
      );
    },
    async retire(tx, person, id) {
      await actor(s, tx, person);
      if (
        !(
          await s.query(
            tx,
            "UPDATE admin.csv_template_versions SET state='retired' WHERE id=$1 AND state IN ('draft','active') RETURNING id",
            [uid('csv_template', id)],
          )
        ).rowCount
      )
        return stop('conflict');
    },
    async intake(tx, person, input) {
      const i = {
        id: uid('csv_intake', input.id),
        template: uid('csv_template', input.templateId),
        run: uid('import_run', input.runId),
        job: uid('job', input.jobId),
        provider: uid('provider', input.providerId),
        license: uid('license', input.licenseId),
        market: word(input.market, 10),
        asset: uid('asset', input.assetId),
        raw: hash(input.rawHash),
        packet: hash(input.packetHash),
        until: at(input.expiresAt),
      };
      const personId = await actor(s, tx, person);
      await s.query(
        tx,
        'INSERT INTO admin.csv_intakes(id,template_id,run_id,job_id,provider_id,license_id,market,asset_id,raw_sha256,packet_sha256,uploader_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [
          i.id,
          i.template,
          i.run,
          i.job,
          i.provider,
          i.license,
          i.market,
          i.asset,
          i.raw,
          i.packet,
          personId,
          i.until,
        ],
      );
    },
    async workflows(tx, person, page) {
      const who = await actor(s, tx, person),
        limit = pageLimit(page.limit),
        binding = { kind: 'csv_workflow', actor: who },
        after = cursor(binding, page.after),
        rows = (
          await s.query(
            tx,
            'SELECT * FROM admin.csv_workflow_status WHERE ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT $2',
            [after, limit + 1],
          )
        ).rows,
        items = rows.slice(0, limit).map((r) => stored(csvWorkflowFromRow(r)));
      return Object.freeze({
        items: Object.freeze(items),
        next: rows.length > limit ? nextCursor(binding, items.at(-1)!.id) : null,
      });
    },
    async review(tx, person, input) {
      const i = {
        id: uid('csv_review', input.id),
        intake: uid('csv_intake', input.intakeId),
        revision: big(input.runRevision, 1n).toString(),
        fence: big(input.fence).toString(),
        head: big(input.expectedHead).toString(),
        diff: uid('import_artifact', input.diffId),
        validation: uid('import_artifact', input.validationId),
        reviewer: uid('staff', input.reviewerId),
        role: big(input.roleRevision, 1n).toString(),
        decision: choice(input.decision, ['approved', 'rejected']),
        reason: word(input.reason, 64),
      };
      if (!/^[a-z][a-z0-9_]{0,63}$/.test(i.reason) || i.diff === i.validation) return reject();
      const who = await actor(s, tx, person);
      if (who !== i.reviewer) return stop('forbidden');
      const r = (
        await s.query(
          tx,
          'INSERT INTO admin.csv_review_decisions(id,intake_id,run_revision,run_fence,expected_head_revision,diff_artifact_id,validation_artifact_id,reviewer_id,reviewer_role_revision,decision,reason_code) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',
          [
            i.id,
            i.intake,
            i.revision,
            i.fence,
            i.head,
            i.diff,
            i.validation,
            i.reviewer,
            i.role,
            i.decision,
            i.reason,
          ],
        )
      ).rows[0]!;
      return stored(csvReviewFromRow(r));
    },
    async approval(tx, person, intake) {
      await actor(s, tx, person);
      const r = (
        await s.query(
          tx,
          'SELECT * FROM admin.csv_current_approvals WHERE intake_id=$1 ORDER BY reviewed_at DESC,id DESC LIMIT 1',
          [uid('csv_intake', intake)],
        )
      ).rows[0];
      return r ? stored(csvReviewFromRow(r)) : null;
    },
    async evidence(tx, person, intake) {
      await actor(s, tx, person);
      const rows = (
        await s.query(
          tx,
          'SELECT * FROM admin.csv_repository_evidence WHERE intake_id=$1 ORDER BY kind,artifact_id LIMIT 101',
          [uid('csv_intake', intake)],
        )
      ).rows;
      if (rows.length > 100) return stop('integrity');
      return Object.freeze(
        rows.map((r) =>
          Object.freeze({
            kind: choice(r.kind, ['diff', 'validation']),
            artifactId: uid('import_artifact', r.artifact_id),
            asset: Object.freeze({
              id: uid('asset', r.id),
              revision: revisionValue(r.revision),
              key: word(r.object_key, 2048),
              mime: word(r.mime_type, 100),
              sha256: hash(r.sha256),
              size: num(Number(r.size_bytes), 1, 20971520),
              version: word(r.object_version, 1024),
              state: choice(r.state, ['ready']),
            }),
          }),
        ),
      );
    },
  });
}
