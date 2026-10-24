import { createHash } from 'node:crypto';
import type { ReportRepository } from '../../../application/src/ports/owner-report.ts';
import type {
  Version,
  Draft,
  Quote,
  CompareItem,
  ReportItem,
} from '../../../application/src/ports/private-records.ts';
import { reportHeadFromRow } from '../mappers.ts';
import { guarded, type WriteScope } from './mutations.ts';
import { boundedJson, cursor, nextCursor, pageLimit, reject } from './bounds.ts';
import {
  integer,
  jsonObject,
  obj,
  one,
  ownerGuard,
  reportGuard,
  rev,
  rid,
  stamp,
  text,
  type Row,
} from './private-values.ts';
import { stop } from './ingestion.ts';
function head(row: Row) {
  const r = reportHeadFromRow(row);
  return r.ok ? r.value : stop('integrity');
}
function version(row: Row): Version {
  if (row.schema_version !== 1) return stop('integrity');
  return {
    reportId: rid('report', row.report_id),
    version: integer(row.version),
    baseVersion: row.base_version === null ? null : integer(row.base_version),
    bundleId: rid('bundle', row.bundle_id),
    ruleVersionId: rid('rule', row.rule_version_id),
    engineVersion: text(row.engine_version),
    schemaVersion: 1,
    input: obj(row.input_snapshot),
    output: obj(row.output_snapshot, 524288),
  };
}
function draft(row: Row): Draft {
  if (row.schema_version !== 1) return stop('integrity');
  return {
    baseVersion: integer(row.base_version),
    input: obj(row.input),
    schemaVersion: 1,
    expiresAt: stamp(row.expires_at),
    revision: rev(row.revision),
  };
}
function quote(row: Row): Quote & { revision: ReturnType<typeof rev> } {
  if (
    !['per_tire', 'set', 'installed_set'].includes(String(row.basis)) ||
    !Array.isArray(row.components) ||
    typeof row.total_minor !== 'string' ||
    !/^[0-9]+$/.test(row.total_minor)
  )
    return stop('integrity');
  return {
    id: rid('quote', row.id),
    reportId: rid('report', row.report_id),
    sourceKey: text(row.source_key),
    skuId: row.sku_id === null ? null : rid('tire_sku', row.sku_id),
    currency: text(row.currency),
    totalMinor: BigInt(row.total_minor),
    quantity: integer(row.quantity),
    basis: row.basis as Quote['basis'],
    observedOn: text(row.observed_on),
    components: row.components.map((x) => obj(x)),
    expiresAt: stamp(row.expires_at),
    revision: rev(row.revision),
  };
}
export function createReportRepository(scope: WriteScope): ReportRepository {
  const q = scope.query;
  const repo: ReportRepository = {
    async items(tx, owner, id, n) {
      await reportGuard(scope, tx, owner, id);
      const r = await q(
        tx,
        'SELECT item_key,sku_id,kind,rank,snapshot FROM app.report_items WHERE report_id=$1 AND report_version=$2 ORDER BY item_key LIMIT 101',
        [id, integer(n)],
      );
      if (r.rows.length > 100) return stop('integrity');
      return r.rows.map((x): ReportItem => {
        if (!['picked', 'excluded'].includes(String(x.kind))) return stop('integrity');
        return {
          key: text(x.item_key),
          skuId: x.sku_id === null ? null : rid('tire_sku', x.sku_id),
          kind: x.kind as ReportItem['kind'],
          rank: x.rank === null ? null : integer(x.rank),
          snapshot: obj(x.snapshot),
        };
      });
    },
    async create(tx, owner, input) {
      await ownerGuard(scope, tx, owner);
      return head(
        one(
          (
            await q(
              tx,
              'INSERT INTO app.reports(id,owner_subject_id,market,locale,expires_at) VALUES($1,$2,$3,$4,$5) RETURNING id,owner_subject_id,current_version,status,revision,expires_at',
              [input.id, owner.subjectId, input.market, input.locale, input.expiresAt],
            )
          ).rows,
        ),
      );
    },
    async head(tx, owner, id) {
      await ownerGuard(scope, tx, owner);
      const r = await q(
        tx,
        "SELECT id,owner_subject_id,current_version,status,revision,expires_at FROM app.reports WHERE id=$1 AND owner_subject_id=$2 AND status<>'pending_deletion' AND expires_at>clock_timestamp()",
        [id, owner.subjectId],
      );
      return r.rows[0] ? head(r.rows[0]) : null;
    },
    async list(tx, owner, page) {
      await ownerGuard(scope, tx, owner);
      const s = ['reports', owner.subjectId],
        limit = pageLimit(page.limit),
        after = cursor(s, page.after);
      const r = await q(
        tx,
        "SELECT id,owner_subject_id,current_version,status,revision,expires_at FROM app.reports WHERE owner_subject_id=$1 AND ($2::uuid IS NULL OR id>$2) AND status<>'pending_deletion' AND expires_at>clock_timestamp() ORDER BY id LIMIT $3",
        [owner.subjectId, after, limit + 1],
      );
      const rows = r.rows.slice(0, limit).map(head);
      return { items: rows, next: r.rows.length > limit ? nextCursor(s, rows.at(-1)!.id) : null };
    },
    async version(tx, owner, id, n) {
      await reportGuard(scope, tx, owner, id);
      const r = await q(
        tx,
        'SELECT report_id,version,base_version,bundle_id,rule_version_id,engine_version,schema_version,input_snapshot,output_snapshot FROM app.report_versions WHERE report_id=$1 AND version=$2',
        [id, integer(n)],
      );
      return r.rows[0] ? version(r.rows[0]) : null;
    },
    async publish(tx, owner, expected, v, items) {
      const h = await reportGuard(scope, tx, owner, v.reportId);
      if (
        rev(h.revision) !== expected ||
        v.baseVersion !== h.current_version ||
        v.version !== (h.current_version === null ? 1 : integer(h.current_version) + 1)
      )
        stop('conflict');
      if (v.schemaVersion !== 1 || items.length > 100) reject();
      const input = jsonObject(v.input, 65536),
        output = jsonObject(v.output, 524288),
        hash = createHash('sha256')
          .update(input + '\n' + output)
          .digest('hex');
      const refs = await q(
        tx,
        "SELECT b.id FROM app.dataset_bundles b,app.rule_versions r WHERE b.id=$1 AND b.status='published' AND r.id=$2 AND r.status='published'",
        [v.bundleId, v.ruleVersionId],
      );
      if (!refs.rows.length) stop('conflict');
      await q(
        tx,
        'INSERT INTO app.report_versions(report_id,version,base_version,bundle_id,rule_version_id,engine_version,schema_version,input_snapshot,output_snapshot,snapshot_hash) VALUES($1,$2,$3,$4,$5,$6,1,$7,$8,$9)',
        [
          v.reportId,
          v.version,
          v.baseVersion,
          v.bundleId,
          v.ruleVersionId,
          text(v.engineVersion, 100),
          input,
          output,
          hash,
        ],
      );
      const records = items.map((i) => ({
        item_key: text(i.key),
        sku_id: i.skuId,
        kind: i.kind,
        rank: i.rank,
        snapshot: obj(i.snapshot),
      }));
      await q(
        tx,
        `INSERT INTO app.report_items(report_id,report_version,item_key,sku_id,kind,rank,snapshot) SELECT $1,$2,x.* FROM jsonb_to_recordset($3::jsonb) x(item_key text,sku_id uuid,kind text,rank smallint,snapshot jsonb)`,
        [v.reportId, v.version, boundedJson(records, 1048576)],
      );
      await q(tx, 'DELETE FROM app.report_drafts WHERE report_id=$1', [v.reportId]);
      return head(
        one(
          (
            await q(
              tx,
              "UPDATE app.reports SET current_version=$2,status='active',revision=revision+1,updated_at=clock_timestamp(),last_owner_activity_at=clock_timestamp() WHERE id=$1 RETURNING id,owner_subject_id,current_version,status,revision,expires_at",
              [v.reportId, v.version],
            )
          ).rows,
        ),
      );
    },
    async draft(tx, owner, id) {
      await reportGuard(scope, tx, owner, id);
      const r = await q(
        tx,
        'SELECT base_version,input,schema_version,expires_at,revision FROM app.report_drafts WHERE report_id=$1 AND expires_at>clock_timestamp()',
        [id],
      );
      return r.rows[0] ? draft(r.rows[0]) : null;
    },
    async saveDraft(tx, owner, id, expected, d) {
      const h = await reportGuard(scope, tx, owner, id);
      if (h.current_version !== d.baseVersion) stop('conflict');
      if (d.schemaVersion !== 1) reject();
      await q(
        tx,
        'DELETE FROM app.report_drafts WHERE report_id=$1 AND expires_at<=clock_timestamp()',
        [id],
      );
      const r = await q(
        tx,
        `INSERT INTO app.report_drafts(report_id,base_version,input,schema_version,expires_at) SELECT $1,$2,$3,1,$4 WHERE $5::bigint IS NULL
        ON CONFLICT (report_id) DO NOTHING RETURNING base_version,input,schema_version,expires_at,revision`,
        [id, d.baseVersion, jsonObject(d.input, 65536), d.expiresAt, expected?.toString() ?? null],
      );
      if (expected === null) return draft(one(r.rows));
      return draft(
        one(
          (
            await q(
              tx,
              `UPDATE app.report_drafts SET base_version=$2,input=$3,expires_at=$4,revision=revision+1,updated_at=clock_timestamp() WHERE report_id=$1 AND revision=$5 AND expires_at>clock_timestamp() RETURNING base_version,input,schema_version,expires_at,revision`,
              [id, d.baseVersion, jsonObject(d.input, 65536), d.expiresAt, expected.toString()],
            )
          ).rows,
        ),
      );
    },
    async compare(tx, owner, id, n, expected, scenario, items) {
      await reportGuard(scope, tx, owner, id);
      integer(n);
      if (items.length < 1 || items.length > 4) reject();
      const current = (
        await q(
          tx,
          'SELECT revision FROM app.comparisons WHERE report_id=$1 AND report_version=$2 ORDER BY revision DESC LIMIT 1',
          [id, n],
        )
      ).rows[0];
      if ((current ? rev(current.revision) : null) !== expected) stop('conflict');
      const next = rev(((expected ?? 0n) + 1n).toString());
      const content = jsonObject(scenario, 65536),
        records = items.map((i) => ({
          slot: i.slot,
          source_key: text(i.sourceKey),
          kind: i.kind,
          snapshot: obj(i.snapshot),
        }));
      await q(
        tx,
        'INSERT INTO app.comparisons(report_id,report_version,revision,scenario,schema_version,snapshot_hash) VALUES($1,$2,$3,$4,1,$5)',
        [
          id,
          n,
          next.toString(),
          content,
          createHash('sha256')
            .update(content + boundedJson(records, 262144))
            .digest('hex'),
        ],
      );
      await q(
        tx,
        'INSERT INTO app.comparison_items(report_id,report_version,comparison_revision,slot,source_key,kind,snapshot) SELECT $1,$2,$3,x.* FROM jsonb_to_recordset($4::jsonb) x(slot smallint,source_key text,kind text,snapshot jsonb)',
        [id, n, next.toString(), boundedJson(records, 262144)],
      );
      return { revision: next, scenario, items };
    },
    async comparison(tx, owner, id, n, r) {
      await reportGuard(scope, tx, owner, id);
      const rows = (
        await q(
          tx,
          `SELECT c.revision,c.scenario,i.slot,i.source_key,i.kind,i.snapshot FROM app.comparisons c JOIN app.comparison_items i ON (i.report_id,i.report_version,i.comparison_revision)=(c.report_id,c.report_version,c.revision) WHERE c.report_id=$1 AND c.report_version=$2 AND c.revision=$3 ORDER BY i.slot`,
          [id, integer(n), r.toString()],
        )
      ).rows;
      if (!rows.length) return null;
      const items = rows.map((row) => {
        if (!['catalog', 'quote'].includes(String(row.kind)) || integer(row.slot) > 4)
          return stop('integrity');
        return {
          slot: row.slot as CompareItem['slot'],
          sourceKey: text(row.source_key),
          kind: row.kind as CompareItem['kind'],
          snapshot: obj(row.snapshot),
        };
      });
      return { revision: rev(rows[0]!.revision), scenario: obj(rows[0]!.scenario), items };
    },
    async saveQuote(tx, owner, expected, v) {
      await reportGuard(scope, tx, owner, v.reportId);
      if (typeof v.totalMinor !== 'bigint' || v.totalMinor < 0n || v.totalMinor > 1000000000000n)
        reject();
      const values = [
        v.id,
        v.reportId,
        text(v.sourceKey),
        v.skuId,
        v.currency,
        v.totalMinor.toString(),
        v.quantity,
        v.basis,
        v.observedOn,
        boundedJson(v.components, 65536),
        v.expiresAt,
      ];
      const r =
        expected === null
          ? await q(
              tx,
              'INSERT INTO app.shop_quotes(id,report_id,source_key,sku_id,currency,total_minor,quantity,basis,observed_on,components,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING revision',
              values,
            )
          : await q(
              tx,
              'UPDATE app.shop_quotes SET source_key=$3,sku_id=$4,currency=$5,total_minor=$6,quantity=$7,basis=$8,observed_on=$9,components=$10,expires_at=$11,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 AND report_id=$2 AND revision=$12 RETURNING revision',
              [...values, expected.toString()],
            );
      return rev(one(r.rows).revision);
    },
    async quotes(tx, owner, id, page) {
      await reportGuard(scope, tx, owner, id);
      const s = ['quotes', owner.subjectId, id],
        limit = pageLimit(page.limit),
        after = cursor(s, page.after);
      const r = await q(
        tx,
        'SELECT id,report_id,source_key,sku_id,currency,total_minor,quantity,basis,observed_on::text,components,expires_at,revision FROM app.shop_quotes WHERE report_id=$1 AND ($2::uuid IS NULL OR id>$2) AND expires_at>clock_timestamp() ORDER BY id LIMIT $3',
        [id, after, limit + 1],
      );
      const items = r.rows.slice(0, limit).map(quote);
      return { items, next: r.rows.length > limit ? nextCursor(s, items.at(-1)!.id) : null };
    },
  };
  return guarded(scope, repo);
}
