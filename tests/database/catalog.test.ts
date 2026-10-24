import { beforeAll, afterAll, it, expect } from 'vitest';
import { catalogFixture, uid, time, success, result } from '../fixtures/catalog/database.ts';
import { pageRequest } from '../../packages/application/src/ports/pagination.ts';
import { revision, ok } from '../../packages/domain/src/values/index.ts';
import type { FactRecords } from '../../packages/application/src/ports/catalog-records.ts';
import type { FactKind } from '../../packages/application/src/ports/catalog-records.ts';
import { graph } from '../fixtures/catalog/graph.ts';
import { createCatalogRepository } from '../../packages/db/src/repositories/catalog.ts';
let f: Awaited<ReturnType<typeof catalogFixture>>;
beforeAll(async () => {
  f = await catalogFixture();
}, 30000);
afterAll(async () => {
  await f?.cleanup();
});
function page(limit = 25, after: string | null = null) {
  const p = pageRequest(limit, after);
  if (!p.ok) throw new Error('bad page');
  return p.value;
}
function model(name = 'Synthetic'): FactRecords['tireModels'] {
  return {
    id: uid('tire_model'),
    sourceRecordKey: uid('source'),
    brand: name,
    model: 'Unknown road performance',
    category: 'unknown',
    seasonalClass: 'unknown',
  };
}
async function head() {
  const h = (
    await f.owner.query("SELECT bundle_id,revision FROM app.market_dataset_heads WHERE market='US'")
  ).rows[0];
  if (!h) return null;
  const r = revision(h.revision);
  if (!r.ok) throw new Error('revision');
  return { bundleId: h.bundle_id, revision: r.value };
}
it('registers exact repeats once and rejects changed content or a second run for one dataset', async () => {
  const r = await f.run();
  const again = await success(f.ingestScope.unitOfWork, (tx) =>
    f.ingest.register(tx, r.registration),
  );
  expect(again.id).toBe(r.lease.runId);
  const changed = {
    ...r.registration,
    identity: { ...r.registration.identity, checksum: 'b'.repeat(64) },
  };
  expect(
    await result(f.ingestScope.unitOfWork, (tx) => f.ingest.register(tx, changed)),
  ).toMatchObject({ ok: false, error: { code: 'conflict' } });
  expect(
    await result(f.ingestScope.unitOfWork, (tx) =>
      f.ingest.register(tx, {
        ...r.registration,
        identity: { ...r.registration.identity, upstreamRunKey: 'other' },
      }),
    ),
  ).toMatchObject({ ok: false, error: { code: 'conflict' } });
});
it('checkpoints bounded batches, resumes exact duplicates and materializes each source row once', async () => {
  const r = await f.run(),
    record = model();
  const rows = await f.stage(r, 'tireModels', [record]);
  const again = await success(f.ingestScope.unitOfWork, (tx) =>
    f.ingest.batch(tx, r.lease, rows, time(3600000)),
  );
  expect(again.accepted).toBe(1n);
  expect(again.throughRow).toBe(1n);
  await success(f.ingestScope.unitOfWork, (tx) =>
    f.ingest.append(tx, r.lease, 'tireModels', [{ rowNumber: 1n, record }]),
  );
  expect(
    (
      await f.owner.query(
        'SELECT count(*)::int AS n FROM app.import_materializations WHERE run_id=$1',
        [r.lease.runId],
      )
    ).rows[0].n,
  ).toBe(1);
  expect(
    await result(f.ingestScope.unitOfWork, (tx) =>
      f.ingest.batch(tx, r.lease, [{ ...rows[0]!, normalized: { changed: true } }], time(3600000)),
    ),
  ).toMatchObject({ ok: false, error: { code: 'conflict' } });
  expect(
    await result(f.ingestScope.unitOfWork, (tx) =>
      f.ingest.batch(tx, r.lease, [{ ...rows[0]!, rowNumber: 3n }], time(3600000)),
    ),
  ).toMatchObject({ ok: false, error: { code: 'conflict' } });
});
it('refuses incomplete materialization, unknown completeness and rejected/duplicate source rows', async () => {
  const r = await f.run();
  await success(f.ingestScope.unitOfWork, (tx) =>
    f.ingest.batch(
      tx,
      r.lease,
      [{ rowNumber: 1n, sourceKey: 'a', normalized: { a: 1 }, status: 'accepted' }],
      time(3600000),
    ),
  );
  expect(
    await result(f.publishScope.unitOfWork, (tx) => f.publish.validate(tx, r.lease, 1n, true)),
  ).toMatchObject({ ok: false, error: { code: 'integrity' } });
  expect(
    await result(f.publishScope.unitOfWork, (tx) => f.publish.validate(tx, r.lease, 1n, false)),
  ).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  const state = await success(f.ingestScope.unitOfWork, (tx) =>
    f.ingest.batch(
      tx,
      r.lease,
      [{ rowNumber: 2n, sourceKey: 'a', normalized: { a: 1 }, status: 'accepted' }],
      time(3600000),
    ),
  );
  expect(state.rejected).toBe(1n);
  expect(
    (await success(f.ingestScope.unitOfWork, (tx) => f.ingest.staged(tx, r.lease, 1n, 25)))[0]
      ?.status,
  ).toBe('duplicate');
});
it('fences expired workers and resumes from a persisted checkpoint', async () => {
  const r = await f.run();
  const rows = await f.stage(r, 'tireModels', [model()]);
  await f.owner.query(
    "UPDATE app.import_runs SET lease_until=now()-interval '1 second' WHERE id=$1",
    [r.lease.runId],
  );
  const leased = await success(f.ingestScope.unitOfWork, (tx) =>
    f.ingest.lease(tx, r.lease.runId, 30),
  );
  expect(leased.fence).toBe(r.lease.fence + 1n);
  expect(leased.throughRow).toBe(1n);
  expect(
    await result(f.ingestScope.unitOfWork, (tx) =>
      f.ingest.batch(tx, r.lease, rows, time(3600000)),
    ),
  ).toMatchObject({ ok: false, error: { code: 'conflict' } });
});
it('publishes atomically, preserves a pinned keyset and records exactly one outbox event on replay', async () => {
  const r = await f.run(),
    records = [model("Literal ' OR true --"), model(), model()];
  await f.stage(r, 'tireModels', records);
  const input = await f.candidate(r, 3n);
  input.expectedHead = await head();
  expect(
    await success(f.readScope.unitOfWork, (tx) => f.catalog.pin(tx, 'US', input.bundleId)),
  ).toBeNull();
  await success(f.publishScope.unitOfWork, (tx) => f.publish.publish(tx, input));
  await success(f.publishScope.unitOfWork, (tx) => f.publish.publish(tx, input));
  const pin = await success(f.readScope.unitOfWork, (tx) =>
    f.catalog.pin(tx, 'US', input.bundleId),
  );
  expect(pin?.coverage).toBe('available');
  expect(pin?.components[0]?.source.rights.api).toBe(true);
  const first = await success(f.readScope.unitOfWork, (tx) =>
    f.catalog.page(tx, {
      kind: 'tireModels',
      bundleId: input.bundleId,
      market: 'US',
      filters: {},
      page: page(2),
    }),
  );
  const next = await success(f.readScope.unitOfWork, (tx) =>
    f.catalog.page(tx, {
      kind: 'tireModels',
      bundleId: input.bundleId,
      market: 'US',
      filters: {},
      page: page(2, first.next),
    }),
  );
  expect(new Set([...first.items, ...next.items].map((r) => r.fact.id)).size).toBe(3);
  expect(next.next).toBeNull();
  expect(
    await result(f.readScope.unitOfWork, (tx) =>
      f.catalog.page(tx, {
        kind: 'tireModels',
        bundleId: uid('bundle'),
        market: 'US',
        filters: {},
        page: page(2, first.next),
      }),
    ),
  ).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  expect(
    (
      await f.owner.query('SELECT count(*)::int AS n FROM app.outbox WHERE aggregate_id=$1', [
        input.bundleId,
      ])
    ).rows[0].n,
  ).toBe(1);
  expect(
    (
      await success(f.publishScope.unitOfWork, (tx) =>
        f.publish.affectedBundles(tx, r.datasetId, 'US', page()),
      )
    ).items,
  ).toContain(input.bundleId);
});
it('rolls back a losing head CAS even if the caller catches the repository exception', async () => {
  const r = await f.run();
  await f.stage(r, 'tireModels', [model()]);
  const input = await f.candidate(r, 1n); // absent-head expectation is now stale
  const outcome = await f.publishScope.unitOfWork.run(async (tx) => {
    await f.publish.publish(tx, input).catch(() => {});
    return ok('must not commit');
  });
  expect(outcome).toMatchObject({ ok: false, error: { code: 'conflict' } });
  expect(
    (await f.owner.query('SELECT status FROM app.dataset_versions WHERE id=$1', [r.datasetId]))
      .rows[0].status,
  ).toBe('validated');
  expect(
    (
      await f.owner.query('SELECT count(*)::int AS n FROM app.outbox WHERE aggregate_id=$1', [
        input.bundleId,
      ])
    ).rows[0].n,
  ).toBe(0);
});
it('gives concurrent publishers one head winner and rejects stale revisions including ABA', async () => {
  const a = await f.run(),
    b = await f.run();
  await f.stage(a, 'tireModels', [model()]);
  await f.stage(b, 'tireModels', [model()]);
  const left = await f.candidate(a, 1n),
    right = await f.candidate(b, 1n);
  left.expectedHead = right.expectedHead = await head();
  const outcomes = await Promise.all(
    [left, right].map((input) =>
      result(f.publishScope.unitOfWork, (tx) => f.publish.publish(tx, input)),
    ),
  );
  expect(outcomes.filter((r) => r.ok)).toHaveLength(1);
  const loser = outcomes[0]!.ok ? right : left;
  const actual = await head();
  await f.owner.query(
    "UPDATE app.market_dataset_heads SET bundle_id=$1,revision=revision+1,updated_at=clock_timestamp() WHERE market='US'",
    [loser.expectedHead!.bundleId],
  );
  expect(
    await result(f.publishScope.unitOfWork, (tx) => f.publish.publish(tx, loser)),
  ).toMatchObject({ ok: false, error: { code: 'conflict' } });
  expect(actual).not.toBeNull();
});
it('checks required manifest components, license changes and approval binding before publication', async () => {
  const r = await f.run();
  await f.stage(r, 'tireModels', [model()]);
  const input = await f.candidate(r, 1n);
  input.expectedHead = await head();
  expect(
    await result(f.publishScope.unitOfWork, (tx) =>
      f.publish.publish(tx, { ...input, required: [{ key: 'missing', kind: 'catalog' }] }),
    ),
  ).toMatchObject({ ok: false, error: { code: 'integrity' } });
  expect(
    await result(f.publishScope.unitOfWork, (tx) =>
      f.publish.publish(tx, { ...input, approvalId: uid('audit_event') }),
    ),
  ).toMatchObject({ ok: false, error: { code: 'forbidden' } });
  await f.owner.query(
    "UPDATE app.data_licenses SET rights=jsonb_set(rights,'{api}','false') WHERE id=$1",
    [f.license],
  );
  expect(
    await result(f.publishScope.unitOfWork, (tx) => f.publish.publish(tx, input)),
  ).toMatchObject({ ok: false, error: { code: 'integrity' } });
  const pin = await success(f.readScope.unitOfWork, (tx) => f.catalog.pin(tx, 'US', null));
  expect(pin?.coverage).toBe('unavailable');
  const items = await success(f.readScope.unitOfWork, (tx) =>
    f.catalog.page(tx, {
      kind: 'tireModels',
      bundleId: pin!.bundleId,
      market: 'US',
      filters: {},
      page: page(),
    }),
  );
  expect(items.items).toEqual([]);
  const revokedDataset = (
    await f.owner.query(
      'SELECT dataset_version_id FROM app.bundle_members WHERE bundle_id=$1 LIMIT 1',
      [pin!.bundleId],
    )
  ).rows[0].dataset_version_id;
  expect(
    (
      await success(f.publishScope.unitOfWork, (tx) =>
        f.publish.affectedBundles(tx, revokedDataset, 'US', page()),
      )
    ).items,
  ).toContain(pin!.bundleId);
  await f.owner.query(
    "UPDATE app.data_licenses SET rights=jsonb_set(rights,'{api}','true') WHERE id=$1",
    [f.license],
  );
});
it('separates reader, ingestion and publication capabilities from private data and DDL', async () => {
  for (const [scope, statements] of [
    [
      f.readScope,
      [
        'SELECT * FROM app.import_staging_rows',
        'SELECT * FROM app.data_licenses',
        'SELECT * FROM app.tire_models',
        'SELECT * FROM admin.staff_identities',
        'SELECT * FROM privacy.contact_points',
        'CREATE TABLE app.forbidden(id int)',
      ],
    ],
    [
      f.ingestScope,
      [
        'UPDATE app.market_dataset_heads SET revision=revision+1',
        "UPDATE app.dataset_versions SET status='published',published_at=now()",
        'SELECT * FROM admin.audit_events',
      ],
    ],
    [
      f.publishScope,
      [
        "INSERT INTO app.tire_models(brand) VALUES('forbidden')",
        "UPDATE app.data_licenses SET rights='{}'",
        'SELECT * FROM privacy.contact_points',
      ],
    ],
  ] as const) {
    for (const statement of statements)
      expect((await result(scope.unitOfWork, (tx) => scope.query(tx, statement))).ok).toBe(false);
  }
});

it('round-trips all 25 fact families with unknowns, exact money, staggered fitment and unresolved recalls', async () => {
  const g = await graph(f),
    input = await f.candidate(g.run, g.total);
  input.expectedHead = await head();
  await success(f.publishScope.unitOfWork, (tx) => f.publish.publish(tx, input));
  for (const kind of Object.keys(g.records) as FactKind[]) {
    const found = await success(f.readScope.unitOfWork, (tx) =>
      f.catalog.page(tx, {
        kind,
        bundleId: input.bundleId,
        market: 'US',
        filters: {},
        page: page(100),
      }),
    );
    const expected = g.records[kind]
      .map((record) =>
        Object.fromEntries(
          Object.entries(record).filter(
            ([key]) => !['reviewedBy', 'sourceDetails', 'sourceNote'].includes(key),
          ),
        ),
      )
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    expect(
      found.items.map((r) => r.fact),
      kind,
    ).toEqual(expected);
  }
  const axles = await success(f.readScope.unitOfWork, (tx) =>
    f.catalog.page(tx, {
      kind: 'fitmentAxles',
      bundleId: input.bundleId,
      market: 'US',
      filters: { configurationId: g.configuration },
      page: page(),
    }),
  );
  expect(axles.items.map((r) => r.fact.sizeCode).sort()).toEqual(['225/45R18', '255/40R18']);
  expect(
    axles.items.every((r) => r.fact.minLoadIndex === null && r.fact.runFlatRequired === false),
  ).toBe(true);
  const aliases = await success(f.readScope.unitOfWork, (tx) =>
    f.catalog.page(tx, {
      kind: 'domainAliases',
      bundleId: input.bundleId,
      market: 'US',
      filters: { normalizedAlias: 'ambiguous brand', locale: 'en-US' },
      page: page(),
    }),
  );
  expect(aliases.items).toHaveLength(2);
  const injection = await success(f.readScope.unitOfWork, (tx) =>
    f.catalog.page(tx, {
      kind: 'domainAliases',
      bundleId: input.bundleId,
      market: 'US',
      filters: { normalizedAlias: "' OR true --" },
      page: page(),
    }),
  );
  expect(injection.items).toEqual([]);
  const r = await f.run();
  const priceRecord = { ...g.records.prices[0]!, id: uid('price'), sourceRecordKey: uid('source') };
  await f.stage(r, 'prices', [priceRecord]);
  const partial = await f.candidate(r, 1n);
  partial.expectedHead = await head();
  expect(
    await result(f.publishScope.unitOfWork, (tx) => f.publish.publish(tx, partial)),
  ).toMatchObject({ ok: false, error: { code: 'integrity' } });
  const complete = uid('bundle');
  await success(f.publishScope.unitOfWork, (tx) =>
    f.publish.bundle(tx, {
      id: complete,
      market: 'US',
      members: [
        { key: 'catalog', datasetId: g.run.datasetId },
        { key: 'pricing', datasetId: r.datasetId },
      ],
    }),
  );
  const approval = uid('audit_event');
  await f.owner.query(
    "INSERT INTO admin.audit_events(id,action,resource_kind,result,occurred_at,change_digest,field_names) SELECT $1,'import.publish','dataset_bundle','approved',now(),manifest_hash,'[]' FROM app.dataset_bundles WHERE id=$2",
    [approval, complete],
  );
  await success(f.publishScope.unitOfWork, (tx) =>
    f.publish.publish(tx, {
      ...partial,
      bundleId: complete,
      approvalId: approval,
      required: [
        { key: 'catalog', kind: 'catalog' },
        { key: 'pricing', kind: 'catalog' },
      ],
    }),
  );
  // The earlier pin does not drift when a later coherent bundle becomes the head.
  const old = await success(f.readScope.unitOfWork, (tx) =>
    f.catalog.page(tx, {
      kind: 'prices',
      bundleId: input.bundleId,
      market: 'US',
      filters: { skuId: g.sku },
      page: page(),
    }),
  );
  expect(old.items.map((r) => r.fact.id)).toEqual([g.records.prices[0]!.id]);
}, 30000);

it('rolls back a whole materialization batch on one bad fact and enforces batch bounds', async () => {
  const r = await f.run(),
    a = model(),
    b = { ...model(), id: a.id };
  const rows = [a, b].map((record, n) => ({
    rowNumber: BigInt(n + 1),
    sourceKey: record.sourceRecordKey,
    normalized: { kind: 'tireModels', record },
    status: 'accepted' as const,
  }));
  await success(f.ingestScope.unitOfWork, (tx) => f.ingest.batch(tx, r.lease, rows, time(3600000)));
  expect(
    await result(f.ingestScope.unitOfWork, (tx) =>
      f.ingest.append(tx, r.lease, 'tireModels', [
        { rowNumber: 1n, record: a },
        { rowNumber: 2n, record: b },
      ]),
    ),
  ).toMatchObject({ ok: false, error: { code: 'conflict' } });
  expect(
    (
      await f.owner.query(
        'SELECT count(*)::int AS n FROM app.tire_models WHERE dataset_version_id=$1',
        [r.datasetId],
      )
    ).rows[0].n,
  ).toBe(0);
  expect(
    (
      await f.owner.query(
        'SELECT count(*)::int AS n FROM app.import_materializations WHERE run_id=$1',
        [r.lease.runId],
      )
    ).rows[0].n,
  ).toBe(0);
  expect(
    await result(f.ingestScope.unitOfWork, (tx) =>
      f.ingest.batch(
        tx,
        r.lease,
        Array.from({ length: 101 }, (_, n) => ({ ...rows[0]!, rowNumber: BigInt(n + 1) })),
        time(3600000),
      ),
    ),
  ).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  expect(
    await result(f.ingestScope.unitOfWork, (tx) =>
      f.ingest.batch(
        tx,
        r.lease,
        [{ ...rows[0]!, normalized: { payload: 'x'.repeat(17000) } }],
        time(3600000),
      ),
    ),
  ).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
});

it('rejects mismatched staging identities and expired materialization without accepting partial facts', async () => {
  for (const expired of [false, true]) {
    const r = await f.run(),
      record = model();
    await success(f.ingestScope.unitOfWork, (tx) =>
      f.ingest.batch(
        tx,
        r.lease,
        [
          {
            rowNumber: 1n,
            sourceKey: expired ? record.sourceRecordKey : 'wrong-source-key',
            normalized: { kind: 'tireModels', record },
            status: 'accepted',
          },
        ],
        time(3600000),
      ),
    );
    if (expired)
      await f.owner.query(
        "UPDATE app.import_staging_rows SET created_at=now()-interval '2 seconds',expires_at=now()-interval '1 second' WHERE run_id=$1",
        [r.lease.runId],
      );
    expect(
      await result(f.ingestScope.unitOfWork, (tx) =>
        f.ingest.append(tx, r.lease, 'tireModels', [{ rowNumber: 1n, record }]),
      ),
    ).toMatchObject({ ok: false, error: { code: 'integrity' } });
    expect(
      (
        await f.owner.query(
          'SELECT count(*)::int AS n FROM app.tire_models WHERE dataset_version_id=$1',
          [r.datasetId],
        )
      ).rows[0].n,
    ).toBe(0);
  }
});

it('enforces stored row and published manifest bounds even for privileged direct writes', async () => {
  const r = await f.run();
  await expect(
    f.owner.query(
      "INSERT INTO app.recalls(dataset_version_id,source_record_key,authority,recall_number,announced_on,status,source_url,summary,product_type) VALUES($1,'huge','synthetic','TEST',current_date,'unknown','https://example.invalid/recall',$2,'tire')",
      [r.datasetId, 'x'.repeat(70000)],
    ),
  ).rejects.toMatchObject({ code: '23514', constraint: 'recalls_read_size_ck' });
  await f.owner.query(
    "UPDATE app.dataset_versions SET status='published',published_at=now() WHERE id=$1",
    [r.datasetId],
  );
  const bundleId = uid('bundle');
  await f.owner.query(
    "INSERT INTO app.dataset_bundles(id,market,manifest_hash,status) VALUES($1,'US',$2,'staging')",
    [bundleId, bundleId.replaceAll('-', '').repeat(2)],
  );
  await f.owner.query(
    "INSERT INTO app.bundle_members(bundle_id,component_key,dataset_version_id) SELECT $1,'component-'||n,$2 FROM generate_series(1,17) n",
    [bundleId, r.datasetId],
  );
  await expect(
    f.owner.query(
      "UPDATE app.dataset_bundles SET status='published',published_at=now() WHERE id=$1",
      [bundleId],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  expect(
    await success(f.readScope.unitOfWork, (tx) => f.catalog.pin(tx, 'US', bundleId)),
  ).toBeNull();
});

it('measures indexed keyset reads on 20,000 synthetic SKUs with bounded page memory and query counts', async () => {
  const r = await f.run(),
    m = model();
  await f.owner.query(
    'INSERT INTO app.tire_models(id,dataset_version_id,source_record_key,brand,model,category,seasonal_class) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [m.id, r.datasetId, m.sourceRecordKey, m.brand, m.model, m.category, m.seasonalClass],
  );
  await f.owner.query(
    `INSERT INTO app.tire_skus(dataset_version_id,model_id,source_record_key,manufacturer_sku,size_code,construction,rim_inches,status)
 SELECT $1,$2,'benchmark-'||n,'benchmark-'||n,CASE WHEN n%20=0 THEN 'TARGET' ELSE 'OTHER-'||(n%20) END,'radial',18,'unknown' FROM generate_series(1,20000) n`,
    [r.datasetId, m.id],
  );
  await f.owner.query(
    "UPDATE app.dataset_versions SET status='published',published_at=now(),row_count=20001 WHERE id=$1",
    [r.datasetId],
  );
  const bundleId = uid('bundle');
  await f.owner.query(
    "INSERT INTO app.dataset_bundles(id,market,manifest_hash,status) VALUES($1,'US',$2,'staging')",
    [bundleId, bundleId.replaceAll('-', '').repeat(2)],
  );
  await f.owner.query("INSERT INTO app.bundle_members VALUES($1,'catalog',$2,now())", [
    bundleId,
    r.datasetId,
  ]);
  await f.owner.query(
    "UPDATE app.dataset_bundles SET status='published',published_at=now() WHERE id=$1",
    [bundleId],
  );
  await f.owner.query('ANALYZE app.tire_skus');
  await f.owner.query('ANALYZE app.dataset_versions');
  let queries = 0,
    maxRows = 0,
    firstSql = '',
    firstValues: readonly unknown[] = [];
  const repository = createCatalogRepository(async (tx, sql, values = []) => {
    queries++;
    firstSql ||= sql;
    if (!firstValues.length) firstValues = values;
    const response = await f.readScope.query(tx, sql, values);
    maxRows = Math.max(maxRows, response.rowCount);
    return response;
  });
  let after: string | null = null,
    peak = process.memoryUsage().heapUsed;
  const initial = peak,
    ids = new Set<string>(),
    started = performance.now();
  do {
    const found = await success(f.readScope.unitOfWork, (tx) =>
      repository.page(tx, {
        kind: 'tireSkus',
        bundleId,
        market: 'US',
        filters: { sizeCode: 'TARGET' },
        page: page(100, after),
      }),
    );
    for (const item of found.items) ids.add(item.fact.id);
    after = found.next;
    peak = Math.max(peak, process.memoryUsage().heapUsed);
  } while (after);
  const explained = await success(f.readScope.unitOfWork, (tx) =>
    f.readScope.query(tx, 'EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ' + firstSql, firstValues),
  );
  const plan = explained.rows[0]?.['QUERY PLAN'] as {
    Plan: Record<string, unknown>;
    'Execution Time': number;
  }[];
  function nodes(node: Record<string, unknown>): Record<string, unknown>[] {
    return [node, ...((node.Plans ?? []) as Record<string, unknown>[]).flatMap(nodes)];
  }
  const allNodes = nodes(plan[0]!.Plan);
  expect(JSON.stringify(plan)).toContain('tire_skus_page_idx');
  expect(ids.size).toBe(1000);
  expect(queries).toBe(10);
  expect(maxRows).toBeLessThanOrEqual(101);
  expect(peak - initial).toBeLessThan(32 * 1024 * 1024);
  console.log(
    'CATALOG_QUERY_EVIDENCE',
    JSON.stringify({
      syntheticSkus: 20000,
      matched: ids.size,
      pages: queries,
      maxRows,
      heapGrowthBytes: Math.max(0, peak - initial),
      elapsedMs: Math.round(performance.now() - started),
      executionMs: plan[0]!['Execution Time'],
      plan: allNodes.map((n) =>
        Object.fromEntries(
          [
            'Node Type',
            'Relation Name',
            'Index Name',
            'Actual Rows',
            'Actual Loops',
            'Shared Hit Blocks',
            'Shared Read Blocks',
            'Sort Method',
            'Sort Space Used',
          ]
            .filter((k) => k in n)
            .map((k) => [k, n[k]]),
        ),
      ),
    }),
  );
}, 30000);
