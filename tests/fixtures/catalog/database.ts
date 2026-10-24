import type { PublishInput } from '../../../packages/application/src/ports/ingestion.ts';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { disposableTargets } from '../foundation/target.ts';
import {
  bootstrapDatabase,
  databaseRoles,
  identifier,
  type RolePasswords,
} from '../../../scripts/database/bootstrap.ts';
import { migrateApplication } from '../../../scripts/database/migrate.ts';
import { loadSources } from '../../../scripts/database/manifest.ts';
import { createTransactions } from '../../../packages/db/src/transactions.ts';
import { createIngestionRepository } from '../../../packages/db/src/repositories/ingestion.ts';
import { createPublicationRepository } from '../../../packages/db/src/repositories/publication.ts';
import { createCatalogRepository } from '../../../packages/db/src/repositories/catalog.ts';
import { id, instant, ok, type Result } from '../../../packages/domain/src/values/index.ts';
import type {
  ApplicationFailure,
  TransactionContext,
  UnitOfWork,
} from '../../../packages/application/src/ports/transactions.ts';
import type {
  FactKind,
  FactRecords,
} from '../../../packages/application/src/ports/catalog-records.ts';

export function uid<K extends string>(kind: K) {
  const v = id(kind, randomUUID());
  if (!v.ok) throw new Error('Invalid fixture UUID');
  return v.value;
}
export function time(offset = 0) {
  const v = instant(new Date(Date.now() + offset).toISOString());
  if (!v.ok) throw new Error('Invalid fixture time');
  return v.value;
}
export async function success<T>(
  uow: UnitOfWork,
  work: (tx: TransactionContext) => Promise<T>,
): Promise<T> {
  const result = await uow.run(async (tx) => ok(await work(tx)));
  if (!result.ok) throw new Error('Fixture failed: ' + result.error.code);
  return result.value;
}
export function result<T>(
  uow: UnitOfWork,
  work: (tx: TransactionContext) => Promise<T>,
): Promise<Result<T, ApplicationFailure>> {
  return uow.run(async (tx) => ok(await work(tx)));
}
export async function catalogFixture() {
  const target = disposableTargets(process.env),
    admin = new pg.Client({ connectionString: target.app });
  await admin.connect();
  const dbName = 'tt_app_catalog';
  const exists = await admin.query('SELECT rolname FROM pg_roles WHERE rolname=ANY($1)', [
    databaseRoles.app,
  ]);
  if (exists.rowCount) {
    await admin.end();
    throw new Error('Catalog fixture requires absent roles');
  }
  await admin.query(`CREATE DATABASE ${dbName}`);
  const root = new URL(target.app);
  root.pathname = '/' + dbName;
  const passwords = Object.fromEntries(
    Object.values(databaseRoles)
      .flat()
      .map((r) => [r, randomBytes(32).toString('hex')]),
  ) as RolePasswords;
  const pools: pg.Pool[] = [];
  let owner: pg.Client | undefined;
  async function cleanup() {
    await Promise.all(pools.map((p) => p.end()));
    await owner?.end();
    await admin.query(`DROP DATABASE ${dbName}`);
    for (const role of databaseRoles.app)
      await admin.query(`DROP ROLE IF EXISTS ${identifier(role)}`);
    await admin.end();
  }
  try {
    await bootstrapDatabase(root.toString(), 'app', dbName, passwords);
    function url(role: (typeof databaseRoles.app)[number]) {
      const u = new URL(root);
      u.username = role;
      u.password = passwords[role];
      return u.toString();
    }
    await migrateApplication(
      { url: url('tt_app_migrator'), database: dbName, kind: 'app' },
      loadSources('app'),
    );
    owner = new pg.Client({ connectionString: url('tt_app_migrator') });
    await owner.connect();
    await owner.query(readFileSync('infra/database/seeds/synthetic.sql', 'utf8'));
    const staff = uid('staff');
    await owner.query(
      "INSERT INTO admin.staff_identities(id,provider_subject,status,last_verified_at) VALUES($1,'repository_fixture','active',now())",
      [staff],
    );
    const provider = uid('provider'),
      license = uid('license');
    await owner.query(
      "INSERT INTO app.data_providers(id,code,name,status) VALUES($1,'repository_fixture','Synthetic licensed fixture','active')",
      [provider],
    );
    await owner.query(
      `INSERT INTO app.data_licenses(id,provider_id,market,rights,effective_at,reviewed_at) VALUES($1,$2,'US','{"display":true,"api":true,"derived":true,"snapshot":true,"cache":true}',now()-interval '1 day',now()-interval '1 day')`,
      [license, provider],
    );
    function adapter(role: (typeof databaseRoles.app)[number]) {
      const p = new pg.Pool({
        connectionString: url(role),
        max: 3,
        connectionTimeoutMillis: 1000,
        query_timeout: 10000,
      });
      pools.push(p);
      return createTransactions(p, { transactionMs: 10000, statementMs: 5000, lockMs: 2000 });
    }
    const ingestScope = adapter('tt_ingest_runtime'),
      publishScope = adapter('tt_publish_runtime'),
      readScope = adapter('tt_catalog_runtime');
    const ingest = createIngestionRepository(ingestScope),
      publish = createPublicationRepository(publishScope),
      catalog = createCatalogRepository(readScope.query);
    const db = owner;
    async function run(kind = 'catalog') {
      const datasetId = uid('dataset'),
        stamp = time(-10000),
        version = randomUUID();
      await success(ingestScope.unitOfWork, (tx) =>
        ingest.dataset(tx, {
          id: datasetId,
          providerId: provider,
          licenseId: license,
          kind,
          externalVersion: version,
          checksum: 'a'.repeat(64),
          effectiveAt: stamp,
          fetchedAt: stamp,
        }),
      );
      const registration = {
        datasetId,
        mode: 'full' as const,
        identity: {
          providerId: provider,
          kind,
          upstreamRunKey: version,
          checksum: 'a'.repeat(64),
          schemaVersion: '1',
          mappingVersion: '1',
        },
      };
      const registered = await success(ingestScope.unitOfWork, (tx) =>
        ingest.register(tx, registration),
      );
      const leased = await success(ingestScope.unitOfWork, (tx) =>
        ingest.lease(tx, registered.id, 300),
      );
      return {
        datasetId,
        registration,
        lease: { runId: registered.id, fence: leased.fence },
        state: leased,
      };
    }
    async function stage<K extends FactKind>(
      r: Awaited<ReturnType<typeof run>>,
      kind: K,
      records: readonly FactRecords[K][],
      start = 1n,
    ) {
      const rows = records.map((record, n) => ({
        rowNumber: start + BigInt(n),
        sourceKey: ('sourceRecordKey' in record ? record.sourceRecordKey : record.id) as string,
        normalized: JSON.parse(
          JSON.stringify({ kind, record }, (_key, v) => (typeof v === 'bigint' ? v.toString() : v)),
        ),
        status: 'accepted' as const,
      }));
      await success(ingestScope.unitOfWork, (tx) => ingest.batch(tx, r.lease, rows, time(3600000)));
      await success(ingestScope.unitOfWork, (tx) =>
        ingest.append(
          tx,
          r.lease,
          kind,
          records.map((record, n) => ({ rowNumber: start + BigInt(n), record })),
        ),
      );
      return rows;
    }
    async function candidate(
      r: Awaited<ReturnType<typeof run>>,
      expectedRows: bigint,
      members = [{ key: 'catalog', datasetId: r.datasetId }],
    ) {
      await success(publishScope.unitOfWork, (tx) =>
        publish.validate(tx, r.lease, expectedRows, true),
      );
      const bundleId = uid('bundle');
      await success(publishScope.unitOfWork, (tx) =>
        publish.bundle(tx, { id: bundleId, market: 'US', members }),
      );
      const hash = (
        await db.query('SELECT manifest_hash FROM app.dataset_bundles WHERE id=$1', [bundleId])
      ).rows[0].manifest_hash;
      const approvalId = uid('audit_event');
      await db.query(
        "INSERT INTO admin.audit_events(id,action,resource_kind,result,occurred_at,change_digest,field_names) VALUES($1,'import.publish','dataset_bundle','approved',now(),$2,'[]')",
        [approvalId, hash],
      );
      return {
        lease: r.lease,
        bundleId,
        market: 'US',
        expectedHead: null as PublishInput['expectedHead'],
        required: members.map((m) => ({ key: m.key, kind: 'catalog' })),
        actorId: staff,
        approvalId,
      };
    }
    return {
      owner: db,
      provider,
      license,
      staff,
      ingest,
      publish,
      catalog,
      ingestScope,
      publishScope,
      readScope,
      run,
      stage,
      candidate,
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
