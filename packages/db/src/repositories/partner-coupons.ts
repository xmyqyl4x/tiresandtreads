import type {
  PartnerCouponRepository,
  CouponImport,
  CodeSeal,
} from '../../../application/src/ports/partner-services.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { createJobRepository } from './jobs.ts';
import { uid, word, integer, sha, at, rev, root, importRow } from './partner-service-values.ts';
import type { TransactionContext as Tx } from '../../../application/src/ports/transactions.ts';
import type { JobLease } from '../../../application/src/ports/jobs.ts';
export function createPartnerCouponRepository(s: WriteScope): PartnerCouponRepository {
  const q = s.query,
    jobs = createJobRepository(s);
  const read = async (tx: Tx, id: CouponImport['id'], lock = false) =>
    importRow(
      (
        await q(
          tx,
          'SELECT *,member_revision::text AS member_revision FROM partners.coupon_imports WHERE id=$1' +
            (lock ? ' FOR UPDATE' : ''),
          [uid('coupon_import', id)],
        )
      ).rows[0] ?? stop('not_found'),
    );
  const check = async (tx: Tx, input: CouponImport, lease: JobLease) => {
    await q(tx, 'SELECT partners.lock_coupon_authority($1,$2,$3)', [
      input.organizationId,
      input.requester,
      input.assetId,
    ]);
    const currentRoot = await root(s, tx, input.organizationId, input.requester, false);
    if (
      !currentRoot.member ||
      !['owner', 'manager'].includes(currentRoot.member.role) ||
      currentRoot.member.status !== 'active' ||
      currentRoot.member.revision !== input.memberRevision ||
      !['pending', 'active'].includes(currentRoot.organization.status)
    )
      return stop('forbidden');
    await jobs.fence(tx, lease);
    const r = await read(tx, input.id, true);
    if (
      r.jobId !== lease.id ||
      lease.input.type !== 'partner.coupon_import' ||
      lease.input.version !== 1 ||
      String(lease.input.resourceId) !== r.id ||
      r.organizationId !== input.organizationId ||
      r.requester !== input.requester ||
      r.memberRevision !== input.memberRevision ||
      r.state === 'ready' ||
      r.state === 'rejected'
    )
      return stop('conflict');
    if (
      (
        await q(
          tx,
          `SELECT 1 FROM partners.coupon_imports i JOIN partners.coupon_pools p ON p.org_id=i.org_id AND p.id=i.pool_id JOIN partners.organization_assets b ON b.org_id=i.org_id AND b.asset_id=i.asset_id JOIN app.object_assets a ON a.id=b.asset_id WHERE i.id=$1 AND i.authorized_until>clock_timestamp() AND i.expires_at>clock_timestamp() AND p.state='quarantined' AND p.mode='unique' AND b.purpose='coupon_pool' AND b.state='ready' AND a.state='ready' AND a.expires_at>clock_timestamp() FOR SHARE OF p`,
          [r.id],
        )
      ).rowCount !== 1
    )
      return stop('forbidden');
    const renewed = await q(
      tx,
      "UPDATE app.job_runs SET lease_until=least(clock_timestamp()+interval '30 seconds',deadline_at),updated_at=clock_timestamp() WHERE id=$1 AND lease_token=$2 AND lease_generation=$3 AND state='running' AND lease_until>clock_timestamp() AND deadline_at>clock_timestamp()+interval '30 seconds'",
      [lease.id, lease.token, lease.generation.toString()],
    );
    if (renewed.rowCount !== 1) return stop('conflict');
    return r;
  };
  const seal = (i: CodeSeal, version: string) => {
    sha(i.hash);
    if (
      i.keyVersion !== version ||
      typeof i.cipherHex !== 'string' ||
      !/^[a-f0-9]{66,8192}$/.test(i.cipherHex) ||
      i.cipherHex.length % 2
    )
      return stop('invalid_input');
    return i;
  };
  return guarded<PartnerCouponRepository>(s, {
    async pool(tx, org, i) {
      if (
        !['shared', 'generated', 'unique'].includes(i.mode) ||
        (i.mode === 'shared') !== (i.shared !== null) ||
        (i.mode === 'generated') !== (i.prefix !== null) ||
        (i.mode === 'unique' && i.assetId === null)
      )
        return stop('invalid_input');
      if (i.prefix !== null && !/^[A-Za-z0-9_-]{1,32}$/.test(i.prefix))
        return stop('invalid_input');
      const p = i.shared ? seal(i.shared, i.shared.keyVersion) : null;
      const exists = (
        await q(
          tx,
          "SELECT 1 FROM partners.offer_versions WHERE org_id=$1 AND offer_id=$2 AND version=$3 AND status IN('draft','pending_review','reviewed','published') AND valid_until>clock_timestamp() FOR SHARE",
          [
            uid('organization', org),
            uid('partner_offer', i.offerId),
            integer(i.version, 1, 2147483647),
          ],
        )
      ).rowCount;
      if (!exists) return stop('not_found');
      if (
        i.assetId !== null &&
        (
          await q(
            tx,
            "SELECT 1 FROM partners.organization_assets b JOIN app.object_assets a ON a.id=b.asset_id WHERE b.org_id=$1 AND b.asset_id=$2 AND b.purpose='coupon_pool' AND b.state='ready' AND a.state='ready' AND a.expires_at>clock_timestamp()",
            [org, uid('asset', i.assetId)],
          )
        ).rowCount !== 1
      )
        return stop('forbidden');
      await q(
        tx,
        "INSERT INTO partners.coupon_pools(id,org_id,offer_id,offer_version,mode,asset_id,state,generated_prefix,shared_code_hmac,encrypted_shared_code,key_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,decode($9,'hex'),decode($10,'hex'),$11)",
        [
          uid('coupon_pool', i.id),
          org,
          i.offerId,
          i.version,
          i.mode,
          i.assetId,
          i.mode === 'unique' ? 'quarantined' : 'ready',
          i.prefix,
          p?.hash ?? null,
          p?.cipherHex ?? null,
          p?.keyVersion ?? null,
        ],
      );
    },
    async queue(tx, org, i) {
      const old = (
        await q(
          tx,
          'SELECT id,body_hash FROM partners.coupon_imports WHERE id=$1 OR pool_id=$2 FOR UPDATE',
          [uid('coupon_import', i.id), uid('coupon_pool', i.poolId)],
        )
      ).rows[0];
      if (old) {
        if (old.id !== i.id || old.body_hash !== i.bodyHash) return stop('conflict');
        return read(tx, i.id);
      }
      const valid = (
        await q(
          tx,
          "SELECT 1 FROM partners.coupon_pools p JOIN partners.offer_versions v ON v.org_id=p.org_id AND v.offer_id=p.offer_id AND v.version=p.offer_version WHERE p.org_id=$1 AND p.id=$2 AND p.asset_id=$3 AND p.mode='unique' AND p.state='quarantined' AND v.valid_until>=$4 AND $4::timestamptz>clock_timestamp() FOR UPDATE OF p",
          [org, i.poolId, uid('asset', i.assetId), at(i.expiresAt)],
        )
      ).rowCount;
      if (!valid) return stop('forbidden');
      await q(
        tx,
        'INSERT INTO partners.coupon_imports(id,org_id,pool_id,asset_id,job_id,requester,member_revision,authorized_until,key_version,expires_at,body_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [
          i.id,
          org,
          i.poolId,
          i.assetId,
          uid('job', i.jobId),
          word(i.requester),
          rev(i.memberRevision).toString(),
          at(i.authorizedUntil),
          word(i.keyVersion, 100),
          i.expiresAt,
          sha(i.bodyHash),
        ],
      );
      return read(tx, i.id);
    },
    async get(tx, org, id) {
      const r = (
        await q(
          tx,
          'SELECT *,member_revision::text AS member_revision FROM partners.coupon_imports WHERE org_id=$1 AND id=$2',
          [uid('organization', org), uid('coupon_import', id)],
        )
      ).rows[0];
      return r ? importRow(r) : null;
    },
    root: (tx, id) => read(tx, id),
    check,
    async stage(tx, input, lease, through, rows, invalid) {
      const r = await check(tx, input, lease);
      if (
        r.through !== input.through ||
        !Array.isArray(rows) ||
        !Array.isArray(invalid) ||
        rows.length + invalid.length > 500 ||
        through !== r.through + rows.length + invalid.length ||
        through > 100000
      )
        return stop('conflict');
      const ordinals = [...rows.map((x) => x.row), ...invalid.map((x) => x.row)].sort(
        (a, b) => a - b,
      );
      if (ordinals.some((x, n) => x !== r.through + n + 1)) return stop('invalid_input');
      const saved = rows.length
        ? await q(
            tx,
            "INSERT INTO partners.coupon_import_rows(org_id,import_id,row_number,code_hmac,encrypted_code,key_version) SELECT $1,$2,n,decode(h,'hex'),decode(c,'hex'),$6 FROM unnest($3::integer[],$4::text[],$5::text[]) AS v(n,h,c) ON CONFLICT(import_id,code_hmac) DO NOTHING",
            [
              r.organizationId,
              r.id,
              rows.map((x) => integer(x.row, 1, 100000)),
              rows.map((x) => seal(x.seal, r.keyVersion).hash),
              rows.map((x) => x.seal.cipherHex),
              r.keyVersion,
            ],
          )
        : { rowCount: 0 };
      const errors = Object.freeze(
        [
          ...r.errors,
          ...invalid.map((x) => {
            if (!['invalid_code', 'malformed_csv'].includes(x.reason)) return stop('invalid_input');
            return { row: integer(x.row, 1, 100000), reason: x.reason };
          }),
        ].slice(0, 1000),
      );
      await q(
        tx,
        "UPDATE partners.coupon_imports SET state='processing',through_row=$2,accepted=accepted+$3,duplicates=duplicates+$4,rejected=rejected+$5,errors=$6 WHERE id=$1",
        [
          r.id,
          integer(through),
          saved.rowCount,
          rows.length - saved.rowCount,
          invalid.length,
          JSON.stringify(errors),
        ],
      );
      return read(tx, r.id);
    },
    async finish(tx, input, lease) {
      const r = await check(tx, input, lease);
      if (r.through !== input.through || r.through === 0) return stop('conflict');
      if (!r.rejected) {
        const actual = (
          await q(
            tx,
            'SELECT count(*)::int n FROM partners.coupon_import_rows WHERE import_id=$1',
            [r.id],
          )
        ).rows[0]!.n;
        if (actual !== r.accepted) return stop('integrity');
        await q(
          tx,
          "INSERT INTO partners.coupon_codes(org_id,pool_id,pool_mode,code_hmac,encrypted_code,key_version,state,expires_at) SELECT org_id,$2,'unique',code_hmac,encrypted_code,key_version,'available',$3 FROM partners.coupon_import_rows WHERE import_id=$1 ORDER BY row_number",
          [r.id, r.poolId, r.expiresAt],
        );
        const published = await q(
          tx,
          "UPDATE partners.coupon_pools SET state='ready' WHERE org_id=$1 AND id=$2 AND state='quarantined'",
          [r.organizationId, r.poolId],
        );
        if (published.rowCount !== 1) return stop('conflict');
      }
      await jobs.fence(tx, lease);
      await q(tx, 'UPDATE partners.coupon_imports SET state=$2 WHERE id=$1', [
        r.id,
        r.rejected ? 'rejected' : 'ready',
      ]);
      await q(tx, 'DELETE FROM partners.coupon_import_rows WHERE import_id=$1', [r.id]);
      await jobs.complete(tx, lease);
      return read(tx, r.id);
    },
    async reject(tx, input, lease, reason) {
      const r = await check(tx, input, lease);
      if (!['malformed_csv', 'source_mismatch'].includes(reason)) return stop('invalid_input');
      await q(tx, "UPDATE partners.coupon_imports SET state='rejected',errors=$2 WHERE id=$1", [
        r.id,
        JSON.stringify([...r.errors, { row: 0, reason }].slice(0, 1000)),
      ]);
      await q(tx, 'DELETE FROM partners.coupon_import_rows WHERE import_id=$1', [r.id]);
      await jobs.complete(tx, lease);
      return read(tx, r.id);
    },
    async reauthorize(tx, org, id, jobId, revision, until) {
      const candidate = await read(tx, id);
      if (candidate.organizationId !== org) return stop('not_found');
      const prior =
        (
          await q(tx, 'SELECT state,lease_until FROM app.job_runs WHERE id=$1 FOR UPDATE', [
            candidate.jobId,
          ])
        ).rows[0] ?? stop('not_found');
      const r = await read(tx, id, true);
      if (r.jobId !== candidate.jobId || ['ready', 'rejected'].includes(r.state))
        return stop('conflict');
      if (r.jobId === jobId) return r;
      if (
        prior.state === 'running' &&
        prior.lease_until &&
        new Date(prior.lease_until as string | Date).getTime() > Date.now()
      )
        return stop('conflict');
      await q(
        tx,
        "UPDATE app.job_runs SET state='manual_review',lease_token=NULL,lease_until=NULL,next_attempt_at=NULL,last_error_code='import_superseded',updated_at=clock_timestamp(),revision=revision+1 WHERE id=$1",
        [candidate.jobId],
      );
      await q(
        tx,
        'UPDATE partners.coupon_imports SET job_id=$2,member_revision=$3,authorized_until=$4 WHERE id=$1',
        [uid('coupon_import', id), uid('job', jobId), rev(revision).toString(), at(until)],
      );
      return read(tx, id);
    },
    async reveal(tx, org, code) {
      await q(tx, 'SELECT partners.lock_coupon_reveal($1,$2)', [
        uid('organization', org),
        uid('coupon_code', code),
      ]);
      const r =
        (
          await q(
            tx,
            "SELECT c.pool_id,encode(c.code_hmac,'hex') AS hash,encode(c.encrypted_code,'hex') AS cipher,c.key_version,c.expires_at FROM partners.coupon_codes c JOIN partners.coupon_pools p ON p.org_id=c.org_id AND p.id=c.pool_id JOIN partners.eligible_offer_versions v ON v.org_id=p.org_id AND v.offer_id=p.offer_id AND v.version=p.offer_version WHERE c.org_id=$1 AND c.id=$2 AND c.state IN('available','issued') AND c.expires_at>clock_timestamp() AND p.state='ready'",
            [uid('organization', org), uid('coupon_code', code)],
          )
        ).rows[0] ?? stop('not_found');
      return Object.freeze({
        poolId: uid('coupon_pool', r.pool_id),
        seal: Object.freeze({
          hash: sha(r.hash),
          cipherHex: word(r.cipher, 8192),
          keyVersion: word(r.key_version, 100),
        }),
        expiresAt: at(r.expires_at),
      });
    },
    async shared(tx, org, pool) {
      await q(tx, 'SELECT partners.lock_shared_pool($1,$2)', [
        uid('organization', org),
        uid('coupon_pool', pool),
      ]);
      const r =
        (
          await q(
            tx,
            "SELECT p.id,encode(p.shared_code_hmac,'hex') AS hash,encode(p.encrypted_shared_code,'hex') AS cipher,p.key_version,v.valid_until FROM partners.coupon_pools p JOIN partners.eligible_offer_versions v ON v.org_id=p.org_id AND v.offer_id=p.offer_id AND v.version=p.offer_version WHERE p.org_id=$1 AND p.id=$2 AND p.mode='shared' AND p.state='ready'",
            [org, pool],
          )
        ).rows[0] ?? stop('not_found');
      return Object.freeze({
        poolId: uid('coupon_pool', r.id),
        seal: Object.freeze({
          hash: sha(r.hash),
          cipherHex: word(r.cipher, 8192),
          keyVersion: word(r.key_version, 100),
        }),
        expiresAt: at(r.valid_until),
      });
    },
    async statistics(tx, org, pool) {
      if (
        (
          await q(tx, 'SELECT 1 FROM partners.coupon_pools WHERE org_id=$1 AND id=$2', [
            uid('organization', org),
            uid('coupon_pool', pool),
          ])
        ).rowCount !== 1
      )
        return stop('not_found');
      const r = (
        await q(
          tx,
          "SELECT count(*)::int total,count(*) FILTER(WHERE state='available' AND expires_at>clock_timestamp())::int available FROM partners.coupon_codes WHERE org_id=$1 AND pool_id=$2",
          [org, pool],
        )
      ).rows[0]!;
      const total = integer(r.total),
        available = integer(r.available);
      return Object.freeze({ total, available, low: total > 0 && available * 10 <= total });
    },
  });
}
