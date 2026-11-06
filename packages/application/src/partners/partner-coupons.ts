import { type Id } from '../../../domain/src/values/core.ts';
import { couponCode } from '../../../domain/src/partner-policy.ts';
import type {
  PartnerCouponRepository,
  PartnerServiceAssets,
  CouponCsvDecoder,
  CouponImport,
} from '../ports/partner-services.ts';
import type { PrivateObjects } from '../ports/assets.ts';
import type { JobRepository, JobLease } from '../ports/jobs.ts';
import {
  capture,
  identifier,
  partnerContext,
  timestamp,
  type PartnerDependencies,
} from './partner-work.ts';
import { demand } from '../services/service-work.ts';
const visible = (r: CouponImport) =>
  Object.freeze({
    id: r.id,
    poolId: r.poolId,
    jobId: r.jobId,
    state: r.state,
    through: r.through,
    accepted: r.accepted,
    duplicates: r.duplicates,
    rejected: r.rejected,
    errors: r.errors,
  });
export function createPartnerCouponServices(
  d: PartnerDependencies & {
    readonly coupons: PartnerCouponRepository;
    readonly assets: PartnerServiceAssets;
    readonly objects: PrivateObjects;
    readonly jobs: JobRepository;
    readonly csv: CouponCsvDecoder;
  },
) {
  const c = partnerContext(d),
    repo = d.coupons;
  const reveal = (
    kind: 'coupon_code' | 'coupon_pool',
    handle: string,
    organizationId: Id<'organization'>,
    codeId: string,
  ) =>
    c.safe(async () => {
      const org = identifier('organization', organizationId),
        id = identifier(kind, codeId),
        p = await c.principal(handle);
      const read = (tx: import('../ports/transactions.ts').TransactionContext) =>
        kind === 'coupon_code'
          ? repo.reveal(tx, org, identifier('coupon_code', id))
          : repo.shared(tx, org, identifier('coupon_pool', id));
      const admitted = await c.run(async (tx) => {
        await c.member(tx, p, org, ['owner', 'manager']);
        return read(tx);
      });
      if (!admitted.ok) return admitted;
      const code = d.crypto.open(org, admitted.value.poolId, admitted.value.seal),
        fresh = await c.principal(handle);
      demand(fresh.subject === p.subject, 'forbidden');
      return c.run(async (tx) => {
        await c.member(tx, fresh, org, ['owner', 'manager']);
        const current = await read(tx);
        demand(d.crypto.digest(current) === d.crypto.digest(admitted.value), 'conflict');
        await c.audit(tx, fresh, org, 'coupon.reveal', id, { kind, id });
        return { code };
      });
    });
  return {
    pool(
      handle: string,
      organizationId: Id<'organization'>,
      input: Readonly<{
        id: Id<'coupon_pool'>;
        offerId: Id<'partner_offer'>;
        version: number;
        mode: 'shared' | 'generated' | 'unique';
        assetId: Id<'asset'> | null;
        prefix: string | null;
        sharedCode: string | null;
      }>,
    ) {
      return c.safe(async () => {
        const org = identifier('organization', organizationId),
          i = capture(input);
        identifier('coupon_pool', i.id);
        identifier('partner_offer', i.offerId);
        demand(Number.isSafeInteger(i.version) && i.version > 0 && i.version <= 2147483647);
        demand(['shared', 'generated', 'unique'].includes(i.mode));
        demand(
          (i.mode === 'unique') === (i.assetId !== null) &&
            (i.mode === 'generated') === (i.prefix !== null) &&
            (i.mode === 'shared') === (i.sharedCode !== null),
        );
        if (i.assetId !== null) identifier('asset', i.assetId);
        if (i.prefix !== null) demand(/^[A-Za-z0-9_-]{1,32}$/.test(i.prefix));
        let shared = null;
        if (i.sharedCode !== null) {
          const code = couponCode(i.sharedCode);
          demand(code.ok);
          shared = d.crypto.seal(org, i.id, code.value, d.crypto.currentKeyVersion);
        }
        const p = await c.principal(handle);
        return c.run(async (tx) => {
          await c.member(tx, p, org, ['owner', 'manager'], true);
          await repo.pool(tx, org, { ...i, shared });
          await c.audit(tx, p, org, 'coupon.pool', i.id, {
            offerId: i.offerId,
            version: i.version,
            mode: i.mode,
            assetId: i.assetId,
          });
          return { id: i.id };
        });
      });
    },
    queue(
      handle: string,
      organizationId: Id<'organization'>,
      input: Readonly<{
        key: string;
        poolId: Id<'coupon_pool'>;
        assetId: Id<'asset'>;
        expiresAt: string;
      }>,
    ) {
      return c.safe(async () => {
        const org = identifier('organization', organizationId),
          i = capture(input);
        identifier('command', i.key);
        identifier('coupon_pool', i.poolId);
        identifier('asset', i.assetId);
        const expires = timestamp(i.expiresAt);
        demand(
          Date.parse(expires) > d.clock.now() &&
            Date.parse(expires) <= d.clock.now() + 90 * 86400000,
        );
        const p = await c.principal(handle),
          id = d.crypto.id('coupon_import', org + ':' + i.key),
          bodyHash = d.crypto.digest({ org, pool: i.poolId, asset: i.assetId, expires });
        return c.run(async (tx) => {
          const r = await c.member(tx, p, org, ['owner', 'manager']);
          const jobId = await d.jobs.register(tx, {
            type: 'partner.coupon_import',
            businessKey: 'partner:import:' + id,
            version: 1,
            resourceId: identifier('resource', id),
          });
          const result = await repo.queue(tx, org, {
            id,
            poolId: i.poolId,
            assetId: i.assetId,
            jobId,
            requester: p.subject,
            memberRevision: r.member!.revision,
            authorizedUntil: timestamp(
              new Date(
                Math.min(Date.parse(p.expiresAt), Date.parse(p.mfaAt) + 300000),
              ).toISOString(),
            ),
            keyVersion: d.crypto.currentKeyVersion,
            expiresAt: expires,
            bodyHash,
          });
          await c.audit(tx, p, org, 'coupon.queue', id, { poolId: i.poolId, assetId: i.assetId });
          return visible(result);
        });
      });
    },
    reauthorize(
      handle: string,
      organizationId: Id<'organization'>,
      importId: Id<'coupon_import'>,
      key: string,
    ) {
      return c.safe(async () => {
        const org = identifier('organization', organizationId),
          id = identifier('coupon_import', importId);
        identifier('command', key);
        const p = await c.principal(handle);
        return c.run(async (tx) => {
          const r = await c.member(tx, p, org, ['owner', 'manager']);
          const prior = await repo.get(tx, org, id);
          demand(prior && prior.requester === p.subject, 'forbidden');
          const job = await d.jobs.register(tx, {
            type: 'partner.coupon_import',
            businessKey: 'partner:resume:' + id + ':' + key,
            version: 1,
            resourceId: identifier('resource', id),
          });
          const result = await repo.reauthorize(
            tx,
            org,
            id,
            job,
            r.member!.revision,
            timestamp(
              new Date(
                Math.min(Date.parse(p.expiresAt), Date.parse(p.mfaAt) + 300000),
              ).toISOString(),
            ),
          );
          await c.audit(tx, p, org, 'coupon.reauthorize', id, { job });
          return visible(result);
        });
      });
    },
    status(handle: string, organizationId: Id<'organization'>, importId: Id<'coupon_import'>) {
      return c.safe(async () => {
        const org = identifier('organization', organizationId),
          id = identifier('coupon_import', importId),
          p = await c.principal(handle);
        return c.run(async (tx) => {
          await c.member(tx, p, org, ['owner', 'manager']);
          const r = await repo.get(tx, org, id);
          demand(r, 'not_found');
          return visible(r);
        });
      });
    },
    errorReport(handle: string, organizationId: Id<'organization'>, importId: Id<'coupon_import'>) {
      return c.safe(async () => {
        const org = identifier('organization', organizationId),
          id = identifier('coupon_import', importId),
          p = await c.principal(handle);
        return c.run(async (tx) => {
          await c.member(tx, p, org, ['owner', 'manager']);
          const r = await repo.get(tx, org, id);
          demand(r, 'not_found');
          return Object.freeze({
            mime: 'text/csv' as const,
            csv: 'row,reason\n' + r.errors.map((e) => `${e.row},${e.reason}`).join('\n'),
            truncated: r.rejected > r.errors.length,
          });
        });
      });
    },
    statistics(handle: string, organizationId: Id<'organization'>, poolId: Id<'coupon_pool'>) {
      return c.safe(async () => {
        const org = identifier('organization', organizationId),
          pool = identifier('coupon_pool', poolId),
          p = await c.principal(handle);
        return c.run(async (tx) => {
          await c.member(tx, p, org, ['owner', 'manager', 'analyst']);
          return repo.statistics(tx, org, pool);
        });
      });
    },
    reveal: (handle: string, org: Id<'organization'>, code: Id<'coupon_code'>) =>
      reveal('coupon_code', handle, org, code),
    revealShared: (handle: string, org: Id<'organization'>, pool: Id<'coupon_pool'>) =>
      reveal('coupon_pool', handle, org, pool),
    lease(jobId: Id<'job'>) {
      return c.safe(() => {
        const id = identifier('job', jobId);
        return c.run((tx) => d.jobs.lease(tx, id));
      });
    },
    process(input: JobLease) {
      return c.safe(async () => {
        const lease = capture(input);
        demand(lease.input.type === 'partner.coupon_import' && lease.input.version === 1);
        identifier('job', lease.id);
        identifier('lease', lease.token);
        const id = identifier('coupon_import', lease.input.resourceId);
        const admitted = await c.run(async (tx) => {
          const r = await repo.root(tx, id);
          const current = await repo.check(tx, r, lease);
          const asset = await d.assets.get(
            tx,
            current.organizationId,
            current.assetId,
            'coupon_pool',
          );
          return { current, asset };
        });
        if (!admitted.ok) return admitted;
        let current = admitted.value.current,
          bytes: Uint8Array;
        try {
          bytes = await d.objects.get(admitted.value.asset);
        } catch {
          await c.run((tx) => d.jobs.fail(tx, lease));
          throw Error('Private source unavailable');
        }
        if (
          bytes.length !== admitted.value.asset.size ||
          d.crypto.checksum(bytes) !== admitted.value.asset.sha256
        )
          return c.run(async (tx) =>
            visible(await repo.reject(tx, current, lease, 'source_mismatch')),
          );
        let rows: { row: number; seal: ReturnType<typeof d.crypto.seal> }[] = [],
          invalid: { row: number; reason: string }[] = [],
          through = current.through;
        const flush = async () => {
          const result = await c.run((tx) =>
            repo.stage(tx, current, lease, through, rows, invalid),
          );
          demand(result.ok, 'unavailable');
          current = result.value;
          rows = [];
          invalid = [];
        };
        // Only decoder failures reject a source. Crypto/DB failures preserve its checkpoint.
        const iterator = d.csv.rows(bytes)[Symbol.iterator]();
        while (true) {
          let next: IteratorResult<
            Readonly<{ row: number; code: string | null; reason: string | null }>
          >;
          try {
            next = iterator.next();
          } catch {
            return c.run(async (tx) =>
              visible(await repo.reject(tx, current, lease, 'malformed_csv')),
            );
          }
          if (next.done) break;
          const row = next.value;
          if (row.row <= current.through) continue;
          demand(row.row === through + 1);
          through = row.row;
          if (row.code === null)
            invalid.push({ row: row.row, reason: row.reason ?? 'invalid_code' });
          else
            rows.push({
              row: row.row,
              seal: d.crypto.seal(
                current.organizationId,
                current.poolId,
                row.code,
                current.keyVersion,
              ),
            });
          if (rows.length + invalid.length === 500) await flush();
        }
        if (rows.length + invalid.length) await flush();
        return c.run(async (tx) => {
          const r = await repo.finish(tx, current, lease);
          await d.onboarding.audit(
            tx,
            r.organizationId,
            d.crypto.digest(['actor', r.requester]),
            'coupon.import',
            r.id,
            d.crypto.digest({
              accepted: r.accepted,
              duplicates: r.duplicates,
              rejected: r.rejected,
            }),
          );
          return visible(r);
        });
      });
    },
  };
}
