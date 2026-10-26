import type { CatalogRepository, CatalogSource } from '../../../application/src/ports/catalog.ts';
import type { FactKind } from '../../../application/src/ports/catalog-records.ts';
import { id, instant, known, unknown } from '../../../domain/src/values/index.ts';
import { failure } from '../../../application/src/ports/transactions.ts';
import { PersistenceFailure, type createTransactions } from '../transactions.ts';
import { spec, decode, privateFields, value } from './codec.ts';
import { cursor, nextCursor, pageLimit, reject } from './bounds.ts';
export type Sql = ReturnType<typeof createTransactions>['query'];
const sourceColumns =
  's.dataset_id AS source_dataset,s.provider_id AS source_provider,s.license_id AS source_license,s.kind AS source_kind,s.fetched_at AS source_fetched,s.expires_at AS source_expires,s.rights AS source_rights';
const filters = new Set([
  'id',
  'sourceRecordKey',
  'entityId',
  'locale',
  'normalizedAlias',
  'market',
  'modelYear',
  'makeEntityId',
  'vehicleId',
  'configurationId',
  'modelId',
  'skuId',
  'sizeCode',
  'system',
  'recallId',
  'sourceTargetId',
  'productType',
  'authority',
  'recallNumber',
  'topicKey',
  'regionKey',
]);
function checked<T>(parsed: { ok: true; value: T } | { ok: false }): T {
  if (!parsed.ok) throw new PersistenceFailure(failure('integrity'));
  return parsed.value;
}
function asInstant(item: unknown) {
  return checked(instant(item instanceof Date ? item.toISOString() : item));
}
function source(row: Record<string, unknown>): CatalogSource {
  const rights = row.source_rights;
  if (
    !rights ||
    typeof rights !== 'object' ||
    !['display', 'api', 'cache', 'derived', 'snapshot'].every(
      (k) => typeof (rights as Record<string, unknown>)[k] === 'boolean',
    )
  )
    throw new PersistenceFailure(failure('integrity'));
  const r = rights as Record<string, boolean>;
  return Object.freeze({
    datasetId: checked(id('dataset', row.source_dataset)),
    providerId: checked(id('provider', row.source_provider)),
    licenseId: checked(id('license', row.source_license)),
    kind: String(row.source_kind),
    fetchedAt: asInstant(row.source_fetched),
    expiresAt:
      row.source_expires === null
        ? unknown('not_applicable')
        : known(asInstant(row.source_expires)),
    rights: Object.freeze({
      display: r.display!,
      api: r.api!,
      cache: r.cache!,
      derived: r.derived!,
      snapshot: r.snapshot!,
    }),
  });
}
export function createCatalogRepository(sql: Sql): CatalogRepository {
  return {
    async batch<K extends FactKind>(
      tx: Parameters<Sql>[0],
      request: Parameters<CatalogRepository['batch']>[1] & { kind: K },
    ) {
      const definition = spec(request.kind),
        field = definition.fields[request.field];
      if (
        ![
          'id',
          'skuId',
          'modelId',
          'configurationId',
          'sourceTargetId',
          'recallId',
          'priceId',
        ].includes(request.field) ||
        !field ||
        request.ids.length > 200 ||
        new Set(request.ids).size !== request.ids.length ||
        request.ids.some((v) => !id('reference', v).ok)
      )
        return reject();
      if (!request.ids.length) return [];
      const columns = Object.entries(definition.fields)
        .filter(([k]) => !privateFields.has(k))
        .map(([, f]) => `f.${f.column}${f.codec === 'date' ? '::text' : ''} AS ${f.column}`)
        .join(',');
      const rows = (
        await sql(
          tx,
          `SELECT ${columns},${sourceColumns} FROM app.catalog_${definition.table} f JOIN app.catalog_sources s ON s.dataset_id=f.dataset_version_id WHERE f.${field.column}=ANY($3::uuid[]) AND EXISTS(SELECT 1 FROM app.catalog_members m WHERE m.bundle_id=$1 AND m.market=$2 AND m.dataset_version_id=f.dataset_version_id) ORDER BY f.id LIMIT 2001`,
          [request.bundleId, request.market, request.ids],
        )
      ).rows;
      if (rows.length > 2000) throw new PersistenceFailure(failure('integrity'));
      return rows.map((row) =>
        Object.freeze({ fact: decode(request.kind, row), source: source(row) }),
      );
    },
    async pin(tx, market, bundleId) {
      const result = await sql(
        tx,
        `SELECT b.id,b.market,b.component_count,m.component_key,${sourceColumns}
        FROM app.catalog_bundles b LEFT JOIN app.catalog_members m ON m.bundle_id=b.id
        LEFT JOIN app.catalog_sources s ON s.dataset_id=m.dataset_version_id
        WHERE b.market=$1 AND b.id=COALESCE($2::uuid,(SELECT bundle_id FROM app.catalog_heads WHERE market=$1)) ORDER BY m.component_key LIMIT 17`,
        [market, bundleId],
      );
      const first = result.rows[0];
      if (!first) return null;
      if (result.rows.length > 16) throw new PersistenceFailure(failure('integrity'));
      const components = result.rows
        .filter((r) => r.source_dataset !== null)
        .map((r) => Object.freeze({ key: String(r.component_key), source: source(r) }));
      return Object.freeze({
        bundleId: checked(id('bundle', first.id)),
        market: String(first.market),
        coverage:
          components.length === 0
            ? 'unavailable'
            : BigInt(components.length) === BigInt(String(first.component_count))
              ? 'available'
              : 'partial',
        components: Object.freeze(components),
      });
    },
    async page<K extends FactKind>(
      tx: Parameters<Sql>[0],
      request: Parameters<CatalogRepository['page']>[1] & { kind: K },
    ) {
      const definition = spec(request.kind),
        limit = pageLimit(request.page.limit);
      const scope = [request.kind, request.bundleId, request.market, request.filters];
      const last = cursor(scope, request.page.after);
      const params: unknown[] = [request.bundleId, request.market];
      const where = ['f.dataset_version_id=m.dataset_version_id'];
      if (last) {
        params.push(last);
        where.push(`f.id>$${params.length}::uuid`);
      }
      if ('market' in definition.fields) {
        params.push(request.market);
        where.push(`f.market=$${params.length}`);
      }
      for (const [key, item] of Object.entries(request.filters).sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        const field = definition.fields[key];
        if (!filters.has(key) || !field) return reject();
        const parsed = value(field, item);
        if (parsed === null) where.push(`f.${field.column} IS NULL`);
        else {
          params.push(parsed);
          where.push(`f.${field.column}=$${params.length}`);
        }
      }
      const columns = Object.entries(definition.fields)
        .filter(([k]) => !privateFields.has(k))
        .map(([, f]) => `f.${f.column}${f.codec === 'date' ? '::text' : ''} AS ${f.column}`)
        .join(',');
      const innerColumns = [
        'dataset_version_id',
        ...Object.entries(definition.fields)
          .filter(([key]) => !privateFields.has(key))
          .map(([, field]) => field.column),
      ]
        .map((column) => `f.${column}`)
        .join(',');
      params.push(limit + 1);
      const result = await sql(
        tx,
        `SELECT ${columns},${sourceColumns}
        FROM (SELECT DISTINCT dataset_version_id FROM app.catalog_members WHERE bundle_id=$1 AND market=$2) m
        CROSS JOIN LATERAL (SELECT ${innerColumns} FROM app.catalog_${definition.table} f WHERE ${where.join(' AND ')} ORDER BY f.id LIMIT $${params.length}) f
        JOIN app.catalog_sources s ON s.dataset_id=f.dataset_version_id
        ORDER BY f.id LIMIT $${params.length}`,
        params,
      );
      const rows = result.rows.slice(0, limit);
      return {
        items: rows.map((row) =>
          Object.freeze({ fact: decode(request.kind, row), source: source(row) }),
        ),
        next: result.rows.length > limit ? nextCursor(scope, String(rows.at(-1)!.id)) : null,
      };
    },
  };
}
