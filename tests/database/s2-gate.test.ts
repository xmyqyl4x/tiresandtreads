import { beforeAll, afterAll, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { storageColumns, renderStorageModels } from '../../scripts/database/storage-models.ts';
import { privateFixture, success, result } from '../fixtures/private/database.ts';
import { facts, type Field } from '../../packages/db/src/repositories/facts.ts';
import { pageRequest } from '../../packages/application/src/ports/pagination.ts';
import { getTableConfig, getViewConfig, type PgColumn } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
let f: Awaited<ReturnType<typeof privateFixture>>;
beforeAll(async () => {
  f = await privateFixture();
}, 30000);
afterAll(async () => {
  await f?.cleanup();
});
it('S2 verifies every application storage column and generated Drizzle model against real migrated PostgreSQL', async () => {
  const columns = await storageColumns(f.admin),
    source = await renderStorageModels(columns);
  if (process.env.TT_GENERATE_STORAGE_MODELS === '1') {
    console.log('S2_MODEL_SOURCE_BASE64:' + Buffer.from(source).toString('base64'));
    return;
  }
  expect(source).toBe(readFileSync('packages/db/src/models/application.generated.ts', 'utf8'));
  const inventory = JSON.parse(readFileSync('infra/database/s1-contract.json', 'utf8')) as {
    app: { tables: string[]; views: string[] };
  };
  expect([
    ...new Set(columns.filter((c) => c.kind === 'r').map((c) => c.schema + '.' + c.relation)),
  ]).toEqual(inventory.app.tables);
  expect([
    ...new Set(columns.filter((c) => c.kind === 'v').map((c) => c.schema + '.' + c.relation)),
  ]).toEqual(inventory.app.views);
  const models = await import('../../packages/db/src/models/application.generated.ts');
  const modeled = [
    ...Object.values(models.storageTables).flatMap((t) => {
      const config = getTableConfig(t);
      return config.columns.map((c) => ({
        schema: config.schema,
        relation: config.name,
        column: c,
      }));
    }),
    ...Object.values(models.storageViews).flatMap((v) => {
      const config = getViewConfig(v);
      return Object.values(config.selectedFields).map((c) => ({
        schema: config.schema,
        relation: config.name,
        column: c as PgColumn,
      }));
    }),
  ];
  expect(modeled).toHaveLength(columns.length);
  for (const c of columns) {
    const model = modeled.find(
      (m) => m.schema === c.schema && m.relation === c.relation && m.column.name === c.column,
    )!;
    expect(model, c.schema + '.' + c.relation + '.' + c.column).toBeDefined();
    expect(model.column.getSQLType()).toBe(c.type);
    expect(model.column.notNull).toBe(!c.nullable);
    expect(Boolean(model.column.generated)).toBe(c.generated);
    // Drizzle represents generated expressions separately from ordinary INSERT defaults.
    expect(model.column.hasDefault).toBe(c.expression !== null && !c.generated);
  }
  const db = drizzle(f.admin);
  const owner = await f.owner();
  const [subject] = await db
    .select()
    .from(models.appSubjects)
    .where(eq(models.appSubjects.id, owner.identity.subjectId));
  expect(subject!.permission_revision).toBe(1n);
  expect(subject!.created_at).toBeInstanceOf(Date);
  const raw = await f.admin.query('SELECT permission_revision FROM app.subjects WHERE id=$1', [
    owner.identity.subjectId,
  ]);
  expect(raw.rows[0].permission_revision).toBe('1');
  console.log(
    'S2_STORAGE_EVIDENCE',
    JSON.stringify({
      tables: inventory.app.tables.length,
      views: inventory.app.views.length,
      columns: columns.length,
      drizzle: '0.45.2',
      status: 'match',
    }),
  );
});
it('S2 checks the SQL type, nullability and public-view exposure of every fact codec field', async () => {
  const columns = await storageColumns(f.admin);
  const types = {
    uuid: ['uuid'],
    text: ['text'],
    integer: ['integer', 'smallint'],
    bigint: ['bigint'],
    decimal: ['numeric'],
    boolean: ['boolean'],
    date: ['date'],
    instant: ['timestamp with time zone'],
    object: ['jsonb'],
    array: ['jsonb', 'text[]'],
  };
  let checked = 0;
  for (const [kind, spec] of Object.entries(facts))
    for (const [field, codec] of Object.entries(spec.fields as Readonly<Record<string, Field>>)) {
      const stored = columns.find(
        (c) => c.schema === 'app' && c.relation === spec.table && c.column === codec.column,
      );
      expect(stored, kind + '.' + field).toBeDefined();
      expect(types[codec.codec], kind + '.' + field).toContain(stored!.type);
      expect(stored!.nullable, kind + '.' + field).toBe(codec.nullable);
      const view = columns.find(
        (c) =>
          c.schema === 'app' && c.relation === 'catalog_' + spec.table && c.column === codec.column,
      );
      expect(Boolean(view), kind + '.' + field).toBe(
        !['reviewedBy', 'sourceDetails', 'sourceNote'].includes(field),
      );
      checked++;
    }
  console.log(
    'S2_FACT_EVIDENCE',
    JSON.stringify({ families: Object.keys(facts).length, fields: checked }),
  );
});
it('S2 bounds owner report queries and keeps private grant scope isolated at representative cardinality', async () => {
  const a = await f.owner(),
    b = await f.owner();
  await f.admin.query(
    "INSERT INTO app.reports(owner_subject_id,market,locale,expires_at) SELECT CASE WHEN n<=2000 THEN $1::uuid ELSE $2::uuid END,'US','en-US',now()+interval '1 day' FROM generate_series(1,20000)n",
    [a.identity.subjectId, b.identity.subjectId],
  );
  await f.admin.query('ANALYZE app.reports');
  const p = pageRequest(100);
  if (!p.ok) throw Error('page');
  const first = await success(f.scope.unitOfWork, (tx) => f.reports.list(tx, a.identity, p.value));
  expect(first.items).toHaveLength(100);
  expect(first.items.every((x) => x.ownerId === a.identity.subjectId)).toBe(true);
  const next = pageRequest(100, first.next);
  if (!next.ok) throw Error('page');
  expect(
    await result(f.scope.unitOfWork, (tx) => f.reports.list(tx, b.identity, next.value)),
  ).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  const plan = await f.admin.query(
    "EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT id,owner_subject_id,current_version,status,revision,expires_at FROM app.reports WHERE owner_subject_id=$1 AND id>$2 AND status<>'pending_deletion' AND expires_at>clock_timestamp() ORDER BY id LIMIT 101",
    [a.identity.subjectId, first.items.at(-1)!.id],
  );
  const text = JSON.stringify(plan.rows);
  expect(text).toContain('reports_owner_cursor_idx');
  const root = plan.rows[0]['QUERY PLAN'][0];
  expect(root.Plan['Actual Rows']).toBe(101);
  expect(root['Execution Time']).toBeLessThan(1000);
  console.log(
    'S2_OWNER_QUERY_EVIDENCE',
    JSON.stringify({
      syntheticReports: 20000,
      ownerReports: 2000,
      returned: 101,
      executionMs: root['Execution Time'],
      indexed: true,
    }),
  );
});
