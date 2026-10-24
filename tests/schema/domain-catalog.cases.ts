import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import pg from 'pg';
import type { DatabaseRole } from '../../scripts/database/bootstrap.ts';

const hash = 'a'.repeat(64);
const rights = { display: false, cache: false, derived: false, snapshot: false, api: false };
const staff = '22222222-2222-4222-8222-222222222222';

export function registerDomainCatalogTests(
  clients: () => Record<DatabaseRole, pg.Client>,
  ownerUrl: () => string,
) {
  function scenario(name: string, test: (f: Awaited<ReturnType<typeof fixture>>) => Promise<void>) {
    it(`P1-PR-005 ${name}`, async () => {
      const db = clients().tt_app_migrator;
      await db.query('BEGIN');
      try {
        await test(await fixture(db));
      } finally {
        await db.query('ROLLBACK');
      }
    });
  }

  async function fixture(db: pg.Client) {
    async function insert(table: string, values: Record<string, unknown>) {
      // Only test-authored identifiers; data remains parameterized.
      for (const name of [table, ...Object.keys(values)])
        if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error('Invalid fixture identifier');
      const result = await db.query(
        `INSERT INTO app.${table} (${Object.keys(values).join(',')}) VALUES (${Object.keys(values)
          .map((_, i) => `$${i + 1}`)
          .join(',')}) RETURNING id`,
        Object.values(values),
      );
      return result.rows[0].id as string;
    }
    async function denied(sql: string, values: unknown[], code: string, constraint?: string) {
      await db.query('SAVEPOINT expected_denial');
      try {
        await expect(db.query(sql, values)).rejects.toMatchObject({
          code,
          ...(constraint ? { constraint } : {}),
        });
      } finally {
        await db.query('ROLLBACK TO SAVEPOINT expected_denial');
        await db.query('RELEASE SAVEPOINT expected_denial');
      }
    }
    const provider = await insert('data_providers', {
      code: 'synthetic',
      name: 'Synthetic provider',
      status: 'disabled',
    });
    const otherProvider = await insert('data_providers', {
      code: 'other',
      name: 'Other synthetic provider',
      status: 'disabled',
    });
    const license = await insert('data_licenses', {
      provider_id: provider,
      market: 'US',
      rights,
      effective_at: '2026-01-01',
      expires_at: new Date(Date.now() + 86400000),
      reviewed_at: '2026-01-01',
    });
    const dataset = await insert('dataset_versions', {
      provider_id: provider,
      license_id: license,
      kind: 'synthetic',
      external_version: '1',
      checksum: hash,
      status: 'staging',
      effective_at: '2026-01-01',
      fetched_at: '2026-01-02',
      row_count: 0,
    });
    const otherDataset = await insert('dataset_versions', {
      provider_id: provider,
      license_id: license,
      kind: 'synthetic',
      external_version: '2',
      checksum: hash,
      status: 'staging',
      effective_at: '2026-01-01',
      fetched_at: '2026-01-02',
      row_count: 0,
    });
    const version = (source_record_key: string, dataset_version_id = dataset) => ({
      dataset_version_id,
      source_record_key,
    });
    const model = await insert('tire_models', {
      ...version('model'),
      brand: 'Synthetic',
      model: 'Unknown safety',
      category: 'unknown',
      seasonal_class: 'unknown',
    });
    const sku = await insert('tire_skus', {
      ...version('sku'),
      model_id: model,
      manufacturer_sku: 'SYNTHETIC-1',
      size_code: '31X10.50R15LT',
      construction: 'radial',
      rim_inches: 15,
      status: 'unknown',
    });
    const vehicle = await insert('vehicles', {
      ...version('vehicle'),
      market: 'US',
      model_year: 2026,
      make: 'Synthetic',
      model: 'Fixture',
      trim: 'unknown',
    });
    const recall = await insert('recalls', {
      ...version('recall'),
      authority: 'synthetic',
      recall_number: 'SYN-001',
      announced_on: '2026-01-01',
      status: 'reported',
      source_url: 'https://example.invalid/recall',
      summary: 'Synthetic campaign',
      product_type: 'tire',
    });
    async function bundle(published = false) {
      const id = await insert('dataset_bundles', {
        market: 'US',
        manifest_hash: randomUUID().replaceAll('-', '') + 'a'.repeat(32),
        status: 'staging',
      });
      await db.query(
        'INSERT INTO app.bundle_members(bundle_id,component_key,dataset_version_id) VALUES ($1,$2,$3)',
        [id, 'synthetic', dataset],
      );
      if (published) {
        await db.query(
          "UPDATE app.dataset_versions SET status='published',published_at=now() WHERE id=$1",
          [dataset],
        );
        await db.query(
          "UPDATE app.dataset_bundles SET status='published',published_at=now() WHERE id=$1",
          [id],
        );
      }
      return id;
    }
    return {
      db,
      insert,
      denied,
      provider,
      otherProvider,
      license,
      dataset,
      otherDataset,
      version,
      model,
      sku,
      vehicle,
      recall,
      bundle,
    };
  }

  scenario('binds license provenance, rights shape and source version identity', async (f) => {
    await f.denied(
      'UPDATE app.dataset_versions SET provider_id=$1 WHERE id=$2',
      [f.otherProvider, f.dataset],
      '23503',
      'dataset_versions_license_fk',
    );
    await f.denied(
      "UPDATE app.data_licenses SET rights='{}' WHERE id=$1",
      [f.license],
      '23514',
      'data_licenses_rights_ck',
    );
    await f.denied(
      "UPDATE app.data_licenses SET expires_at='2025-01-01' WHERE id=$1",
      [f.license],
      '23514',
      'data_licenses_times_ck',
    );
    await f.denied(
      'UPDATE app.dataset_versions SET row_count=-1 WHERE id=$1',
      [f.dataset],
      '23514',
    );
    await f.denied(
      "UPDATE app.dataset_versions SET checksum='unknown' WHERE id=$1",
      [f.dataset],
      '23514',
    );
    await f.denied(
      "UPDATE app.dataset_versions SET external_version='1' WHERE id=$1",
      [f.otherDataset],
      '23505',
    );
  });

  scenario('preserves ambiguous brands and historical plant-code assignments', async (f) => {
    const brands = await Promise.all(
      ['one', 'two'].map((stable_key) =>
        f.insert('domain_entities', { kind: 'brand', stable_key, status: 'active' }),
      ),
    );
    for (const [index, entity_id] of brands.entries())
      await f.insert('domain_aliases', {
        ...f.version(`alias-${index}`),
        entity_id,
        locale: 'en-US',
        normalized_alias: 'same brand',
        alias_kind: 'trade',
      });
    expect(
      (
        await f.db.query(
          "SELECT count(*)::int AS n FROM app.domain_aliases WHERE normalized_alias='same brand'",
        )
      ).rows[0].n,
    ).toBe(2);
    const plant = await f.insert('domain_entities', {
      kind: 'plant',
      stable_key: 'plant',
      status: 'active',
    });
    for (const source of ['old', 'new'])
      await f.insert('manufacturing_plant_codes', {
        ...f.version(source),
        plant_entity_id: plant,
        authority: 'synthetic',
        equipment_type: 'tire',
        code: 'SYN',
        status: 'unknown',
      });
    await f.denied(
      'UPDATE app.domain_entities SET merged_into_id=id WHERE id=$1',
      [plant],
      '23514',
    );
    await f.denied(
      "INSERT INTO app.domain_relationships(dataset_version_id,source_record_key,from_entity_id,to_entity_id,kind,source_url,review_status) VALUES ($1,'self',$2,$2,'brand_owned_by','https://example.invalid','unreviewed')",
      [f.dataset, brands[0]],
      '23514',
    );
  });

  scenario(
    'keeps unknown axle/SKU constraints null and blocks cross-dataset fitment',
    async (f) => {
      const config = await f.insert('fitment_configurations', {
        ...f.version('fitment'),
        vehicle_id: f.vehicle,
        wheel_package: 'unknown',
        verification_status: 'unverified',
        approved_options: {},
      });
      const axle = await f.insert('fitment_axles', {
        dataset_version_id: f.dataset,
        configuration_id: config,
        axle: 'front',
        quantity: 2,
        size_code: '31X10.50R15LT',
        rim_inches: 15,
        construction: 'radial',
        unknown_constraints: JSON.stringify(['load', 'speed', 'xl', 'run_flat']),
      });
      expect(
        (
          await f.db.query(
            'SELECT width_mm,aspect_ratio,min_load_index,min_speed_rank,xl_required,run_flat_required FROM app.fitment_axles WHERE id=$1',
            [axle],
          )
        ).rows[0],
      ).toEqual({
        width_mm: null,
        aspect_ratio: null,
        min_load_index: null,
        min_speed_rank: null,
        xl_required: null,
        run_flat_required: null,
      });
      expect(
        (
          await f.db.query(
            'SELECT load_index,speed_rank,xl,run_flat FROM app.tire_skus WHERE id=$1',
            [f.sku],
          )
        ).rows[0],
      ).toEqual({ load_index: null, speed_rank: null, xl: null, run_flat: null });
      await f.denied(
        'UPDATE app.fitment_configurations SET dataset_version_id=$1 WHERE id=$2',
        [f.otherDataset, config],
        '23503',
      );
      await f.denied(
        'UPDATE app.tire_skus SET dataset_version_id=$1 WHERE id=$2',
        [f.otherDataset, f.sku],
        '23503',
      );
      await f.denied('UPDATE app.fitment_axles SET quantity=0 WHERE id=$1', [axle], '23514');
    },
  );

  scenario(
    'distinguishes missing evidence from measured zero and rejects ambiguous subjects',
    async (f) => {
      const evidence = await f.insert('evidence', {
        ...f.version('evidence'),
        sku_id: f.sku,
        metric_code: 'synthetic_metric',
        missing_reason: 'not_tested',
        method: 'synthetic',
        source_url: 'https://example.invalid/evidence',
        reviewed_at: '2026-01-01',
        confidence: 'unknown',
        applicability: {},
      });
      await f.denied(
        'UPDATE app.evidence SET numeric_value=0 WHERE id=$1',
        [evidence],
        '23514',
        'evidence_value_ck',
      );
      await f.denied(
        'UPDATE app.evidence SET model_id=$1 WHERE id=$2',
        [f.model, evidence],
        '23514',
        'evidence_subject_ck',
      );
      await f.db.query('UPDATE app.evidence SET missing_reason=NULL,numeric_value=0 WHERE id=$1', [
        evidence,
      ]);
      expect(
        (
          await f.db.query('SELECT numeric_value,missing_reason FROM app.evidence WHERE id=$1', [
            evidence,
          ])
        ).rows[0],
      ).toEqual({ numeric_value: '0', missing_reason: null });
      await f.denied(
        "UPDATE app.evidence SET numeric_value='NaN' WHERE id=$1",
        [evidence],
        '23514',
      );
    },
  );

  scenario('enforces monetary bounds, units and price component shapes', async (f) => {
    const retailer = await f.insert('retailers', {
      code: 'synthetic',
      name: 'Synthetic',
      market: 'US',
      approved_origin: 'https://example.invalid',
      status: 'disabled',
    });
    const price = await f.insert('prices', {
      ...f.version('price'),
      sku_id: f.sku,
      retailer_id: retailer,
      market: 'US',
      currency: 'USD',
      unit_price_minor: 0,
      quantity_basis: 'per_tire',
      observed_at: '2026-01-01',
    });
    const component = await f.insert('price_components', {
      dataset_version_id: f.dataset,
      price_id: price,
      kind: 'installation',
      basis: 'per_tire',
      amount_kind: 'fixed',
      low_minor: 0,
      high_minor: 5000,
      included: false,
    });
    await f.denied('UPDATE app.prices SET unit_price_minor=-1 WHERE id=$1', [price], '23514');
    await f.denied(
      'UPDATE app.price_components SET low_minor=6000 WHERE id=$1',
      [component],
      '23514',
    );
    await f.denied('UPDATE app.price_components SET rate=0.1 WHERE id=$1', [component], '23514');
    await f.db.query(
      "UPDATE app.price_components SET amount_kind='percentage',low_minor=NULL,high_minor=NULL,rate=0.08,basis='taxable_subtotal' WHERE id=$1",
      [component],
    );
    await f.denied('UPDATE app.price_components SET rate=2 WHERE id=$1', [component], '23514');
  });

  scenario(
    'records unresolved reference mappings without granting fitment verification',
    async (f) => {
      const make = await f.insert('domain_entities', {
        kind: 'vehicle_make',
        stable_key: 'make',
        status: 'active',
      });
      const model = await f.insert('domain_entities', {
        kind: 'vehicle_model',
        stable_key: 'model',
        status: 'active',
      });
      const option = await f.insert('vehicle_lookup_options', {
        ...f.version('lookup', f.otherDataset),
        make_entity_id: make,
        model_entity_id: model,
        model_year: 2026,
        vehicle_type: 'unknown',
        market: 'US',
      });
      const link = await f.insert('vehicle_reference_links', {
        ...f.version('mapping'),
        vehicle_id: f.vehicle,
        lookup_option_id: option,
        match_status: 'unresolved',
      });
      await f.denied(
        "UPDATE app.vehicle_reference_links SET match_status='reviewed' WHERE id=$1",
        [link],
        '23514',
      );
      await f.db.query(
        "UPDATE app.vehicle_reference_links SET match_status='reviewed',reviewed_by=$1,reviewed_at=now() WHERE id=$2",
        [staff, link],
      );
      expect(
        (await f.db.query('SELECT count(*)::int AS n FROM app.fitment_configurations')).rows[0].n,
      ).toBe(0);
    },
  );

  scenario(
    'retains recalls absent from the catalog and binds resolved targets to their campaign',
    async (f) => {
      const source = await f.insert('recall_source_targets', {
        dataset_version_id: f.dataset,
        recall_id: f.recall,
        target_key: 'missing-sku',
        brand_name: 'Unknown brand',
        product_name: 'Uncatalogued',
        source_details: {},
        match_status: 'unresolved',
      });
      expect(
        (await f.db.query('SELECT count(*)::int AS n FROM app.recall_targets')).rows[0].n,
      ).toBe(0);
      const target = await f.insert('recall_targets', {
        dataset_version_id: f.dataset,
        recall_id: f.recall,
        source_target_id: source,
        sku_id: f.sku,
        dot_match: {},
        match_status: 'conditional',
        mapping_version: 'synthetic-v1',
      });
      await f.denied(
        'UPDATE app.recall_targets SET model_id=$1 WHERE id=$2',
        [f.model, target],
        '23514',
      );
      const another = await f.insert('recalls', {
        ...f.version('another-recall'),
        authority: 'synthetic',
        recall_number: 'SYN-002',
        announced_on: '2026-01-01',
        status: 'reported',
        source_url: 'https://example.invalid',
        summary: 'Other campaign',
        product_type: 'tire',
      });
      await f.denied(
        'UPDATE app.recall_targets SET recall_id=$1 WHERE id=$2',
        [another, target],
        '23503',
        'recall_targets_source_fk',
      );
      await f.db.query(
        "UPDATE app.recall_source_targets SET manufactured_to='2026-01-01' WHERE id=$1",
        [source],
      );
      expect(
        (
          await f.db.query('SELECT manufactured_from FROM app.recall_source_targets WHERE id=$1', [
            source,
          ])
        ).rows[0].manufactured_from,
      ).toBeNull();
      await f.denied(
        "UPDATE app.recall_source_targets SET manufactured_from='2026-02-01',manufactured_to='2026-01-01' WHERE id=$1",
        [source],
        '23514',
      );
    },
  );

  scenario(
    'binds advice citations to licensed provenance and explicit review intervals',
    async (f) => {
      const fact = await f.insert('advice_facts', {
        ...f.version('fact'),
        topic_key: 'synthetic',
        market: 'US',
        locale: 'en-US',
        claim: 'Synthetic test claim',
        applicability: {},
        reviewed_by: staff,
        reviewed_at: '2026-01-01',
        review_due_at: '2026-04-01',
        status: 'draft',
      });
      const citation = await f.insert('advice_fact_sources', {
        dataset_version_id: f.dataset,
        fact_id: fact,
        source_url: 'https://example.invalid',
        provider_id: f.provider,
        license_id: f.license,
        retrieved_at: '2026-01-01',
        content_hash: hash,
      });
      await f.denied(
        'UPDATE app.advice_fact_sources SET provider_id=$1 WHERE id=$2',
        [f.otherProvider, citation],
        '23503',
      );
      await f.denied(
        "UPDATE app.advice_facts SET review_due_at='2025-01-01' WHERE id=$1",
        [fact],
        '23514',
      );
      await f.denied("UPDATE app.advice_facts SET applicability='[]' WHERE id=$1", [fact], '23514');
    },
  );

  scenario(
    'keeps published rows and child facts immutable, including move and late-insert attempts',
    async (f) => {
      const source = await f.insert('recall_source_targets', {
        dataset_version_id: f.dataset,
        recall_id: f.recall,
        target_key: 'unresolved',
        source_details: {},
        match_status: 'unresolved',
      });
      const bundle = await f.bundle(true);
      for (const [sql, values] of [
        ['UPDATE app.tire_skus SET model_id=model_id WHERE id=$1', [f.sku]],
        ['UPDATE app.tire_skus SET dataset_version_id=$1 WHERE id=$2', [f.otherDataset, f.sku]],
        ['DELETE FROM app.recall_source_targets WHERE id=$1', [source]],
        [
          "INSERT INTO app.tire_models(dataset_version_id,source_record_key,brand,model,category,seasonal_class) VALUES ($1,'late','Synthetic','Late','unknown','unknown')",
          [f.dataset],
        ],
        [
          "UPDATE app.dataset_versions SET status='staging',published_at=NULL WHERE id=$1",
          [f.dataset],
        ],
        ['DELETE FROM app.bundle_members WHERE bundle_id=$1', [bundle]],
        ["UPDATE app.dataset_bundles SET manifest_hash=repeat('b',64) WHERE id=$1", [bundle]],
      ] as const)
        await f.denied(sql, [...values], '23514');
    },
  );

  scenario('rejects empty or unpublished bundles and invalid market heads', async (f) => {
    const bundle = await f.bundle();
    await f.denied(
      "UPDATE app.dataset_bundles SET status='published',published_at=now() WHERE id=$1",
      [bundle],
      '23514',
    );
    await f.denied(
      "INSERT INTO app.market_dataset_heads(market,bundle_id) VALUES ('US',$1)",
      [bundle],
      '23503',
    );
    await f.db.query(
      "UPDATE app.dataset_versions SET status='published',published_at=now() WHERE id=$1",
      [f.dataset],
    );
    await f.db.query(
      "UPDATE app.dataset_bundles SET status='published',published_at=now() WHERE id=$1",
      [bundle],
    );
    await f.db.query("INSERT INTO app.market_dataset_heads(market,bundle_id) VALUES ('US',$1)", [
      bundle,
    ]);
    await f.denied("UPDATE app.market_dataset_heads SET revision=0 WHERE market='US'", [], '23514');
    await f.denied(
      "INSERT INTO app.dataset_bundles(market,manifest_hash,status,published_at) VALUES ('US',repeat('b',64),'published',now())",
      [],
      '23514',
    );
  });

  scenario(
    'binds import source identity, dedupe keys, counters and fenced checkpoints',
    async (f) => {
      const connector = await f.insert('source_connectors', {
        provider_id: f.provider,
        kind: 'synthetic',
        allowed_origin: 'https://example.invalid',
        allowed_path_prefix: '/data/',
        schema_version: 'v1',
        schedule_key: 'disabled',
        status: 'disabled',
      });
      const run = await f.insert('import_runs', {
        provider_id: f.provider,
        connector_id: connector,
        dataset_version_id: f.dataset,
        upstream_run_key: 'synthetic-1',
        status: 'staging',
        started_at: '2026-01-01',
        mode: 'full',
        mapping_version: 'v1',
        content_hash: hash,
        schema_version: 'v1',
        checkpoint: { page: 1 },
      });
      await f.denied(
        'UPDATE app.import_runs SET provider_id=$1 WHERE id=$2',
        [f.otherProvider, run],
        '23503',
      );
      await f.denied('UPDATE app.import_runs SET accepted_count=-1 WHERE id=$1', [run], '23514');
      await f.denied('UPDATE app.import_runs SET lease_until=now() WHERE id=$1', [run], '23514');
      await f.db.query('UPDATE app.import_runs SET lease_until=now(),fence=1 WHERE id=$1', [run]);
      await f.denied('UPDATE app.import_runs SET fence=0 WHERE id=$1', [run], '23514');
      await f.denied(
        "UPDATE app.source_connectors SET allowed_origin='https://user:secret@example.invalid/path?token=redacted' WHERE id=$1",
        [connector],
        '23514',
      );
      const values = {
        provider_id: f.provider,
        upstream_run_key: 'synthetic-1',
        status: 'staging',
        started_at: '2026-01-01',
        mode: 'full',
        mapping_version: 'v1',
        content_hash: hash,
        schema_version: 'v1',
      };
      await f.db.query('SAVEPOINT duplicate_run');
      await expect(f.insert('import_runs', values)).rejects.toMatchObject({ code: '23505' });
      await f.db.query('ROLLBACK TO SAVEPOINT duplicate_run');
    },
  );

  scenario(
    'preserves duplicate staging keys for review and bounds private import metadata',
    async (f) => {
      const run = await f.insert('import_runs', {
        provider_id: f.provider,
        upstream_run_key: 'synthetic',
        status: 'staging',
        started_at: '2026-01-01',
        mode: 'manual',
        mapping_version: 'v1',
        content_hash: hash,
        schema_version: 'v1',
      });
      for (const row_number of [1, 2])
        await f.insert('import_staging_rows', {
          run_id: run,
          row_number,
          source_key: 'duplicate',
          normalized: {},
          validation_status: 'pending',
          expires_at: new Date(Date.now() + 86400000),
        });
      expect(
        (
          await f.db.query(
            'SELECT count(*)::int AS n FROM app.import_staging_rows WHERE run_id=$1',
            [run],
          )
        ).rows[0].n,
      ).toBe(2);
      await f.denied(
        'UPDATE app.import_staging_rows SET row_number=0 WHERE run_id=$1',
        [run],
        '23514',
      );
      await f.denied(
        "UPDATE app.import_staging_rows SET normalized='[]' WHERE run_id=$1",
        [run],
        '23514',
      );
      await f.denied(
        "UPDATE app.import_staging_rows SET normalized=jsonb_build_object('oversized',repeat('x',70000)) WHERE run_id=$1",
        [run],
        '23514',
      );
      await f.insert('import_rejections', {
        run_id: run,
        record_key: 'duplicate',
        reason_code: 'duplicate_source_key',
        redacted_details: { field: 'source_key' },
        expires_at: new Date(Date.now() + 86400000),
      });
      await f.denied(
        "INSERT INTO app.feed_health(provider_id,kind,last_attempt_at,last_success_at,last_run_id) VALUES ($1,'synthetic','2026-01-01','2026-01-02',$2)",
        [f.provider, run],
        '23514',
      );
      await f.denied(
        "INSERT INTO app.feed_health(provider_id,kind,last_attempt_at,last_run_id) VALUES ($1,'synthetic',now(),$2)",
        [f.otherProvider, run],
        '23503',
      );
    },
  );

  scenario('records publication identity and blocks unbound future audit references', async (f) => {
    const bundle = await f.bundle(true);
    const run = await f.insert('import_runs', {
      provider_id: f.provider,
      upstream_run_key: 'publish',
      status: 'validated',
      started_at: '2026-01-01',
      mode: 'manual',
      mapping_version: 'v1',
      content_hash: hash,
      schema_version: 'v1',
    });
    const publication = await f.insert('import_publications', {
      run_id: run,
      bundle_id: bundle,
      market: 'US',
      actor_id: staff,
      published_at: '2026-01-02',
    });
    await f.denied(
      'UPDATE app.import_publications SET actor_id=NULL WHERE id=$1',
      [publication],
      '23514',
    );
    await f.denied(
      "INSERT INTO app.import_publications(run_id,bundle_id,market,actor_id,service_actor_key,published_at) VALUES ($1,$2,'US',$3,'unregistered',now())",
      [run, bundle, staff],
      '23514',
    );
    await f.denied(
      'UPDATE app.import_publications SET approval_record_id=$1 WHERE id=$2',
      [randomUUID(), publication],
      '23514',
    );
  });

  it('P1-PR-005 grants no catalog, staging or publication access to existing runtime roles', async () => {
    const db = clients().tt_app_migrator;
    for (const role of [
      'tt_app_runtime',
      'tt_staff_runtime',
      'tt_asset_runtime',
      'tt_cms_runtime',
    ] as const) {
      for (const table of [
        'dataset_versions',
        'tire_skus',
        'domain_entities',
        'recall_source_targets',
        'import_runs',
        'import_staging_rows',
        'import_publications',
        'market_dataset_heads',
      ]) {
        const result = await db.query(
          "SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS allowed",
          [role, `app.${table}`],
        );
        expect(result.rows[0].allowed, `${role}:${table}`).toBe(false);
      }
    }
    await expect(
      clients().tt_app_runtime.query('UPDATE app.dataset_versions SET row_count=0'),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('P1-PR-005 serializes a source edit against publication in both lock orders', async () => {
    const writer = clients().tt_app_migrator;
    const publisher = new pg.Client({
      connectionString: ownerUrl(),
      connectionTimeoutMillis: 3000,
    });
    await publisher.connect();
    await writer.query('BEGIN');
    const f = await fixture(writer);
    await writer.query('COMMIT');
    try {
      await writer.query('BEGIN');
      await writer.query("UPDATE app.tire_models SET model='Edit in progress' WHERE id=$1", [
        f.model,
      ]);
      await publisher.query('BEGIN');
      await publisher.query("SET LOCAL lock_timeout='100ms'");
      await expect(
        publisher.query(
          "UPDATE app.dataset_versions SET status='published',published_at=now() WHERE id=$1",
          [f.dataset],
        ),
      ).rejects.toMatchObject({ code: '55P03' });
      await publisher.query('ROLLBACK');
      await writer.query('ROLLBACK');

      await publisher.query('BEGIN');
      await publisher.query(
        "UPDATE app.dataset_versions SET status='published',published_at=now() WHERE id=$1",
        [f.dataset],
      );
      await writer.query('BEGIN');
      await writer.query("SET LOCAL lock_timeout='100ms'");
      await expect(
        writer.query("UPDATE app.tire_models SET model='Late edit' WHERE id=$1", [f.model]),
      ).rejects.toMatchObject({ code: '55P03' });
      await writer.query('ROLLBACK');
      await publisher.query('ROLLBACK');
    } finally {
      await publisher.query('ROLLBACK');
      await writer.query('ROLLBACK');
      await publisher.end();
      await writer.query('BEGIN');
      let cleaned = false;
      try {
        for (const table of ['recalls', 'tire_skus', 'tire_models', 'vehicles'])
          await writer.query(`DELETE FROM app.${table} WHERE dataset_version_id=$1`, [f.dataset]);
        await writer.query('DELETE FROM app.dataset_versions WHERE provider_id=$1', [f.provider]);
        await writer.query('DELETE FROM app.data_licenses WHERE id=$1', [f.license]);
        await writer.query('DELETE FROM app.data_providers WHERE id=ANY($1::uuid[])', [
          [f.provider, f.otherProvider],
        ]);
        await writer.query('COMMIT');
        cleaned = true;
      } finally {
        if (!cleaned) await writer.query('ROLLBACK');
      }
    }
  });
}
