import type {
  PublicationRepository,
  PublicReadRepository,
} from '../../../application/src/ports/publication.ts';
import {
  publicContent,
  publicConfiguration,
  configurationChecksum,
} from '../../../config/src/publication.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { digest, reject } from './bounds.ts';
import { stamp, text, one } from './private-values.ts';

export function createContentPublicationRepository(scope: WriteScope): PublicationRepository {
  const q = scope.query;
  return guarded(scope, {
    async publish(tx, i) {
      let content;
      try {
        content = i.content === null ? null : publicContent(i.content);
      } catch {
        return reject();
      }
      if (
        typeof i.generation !== 'bigint' ||
        i.generation < 1n ||
        i.generation > 9223372036854775807n
      )
        reject();
      const identity = [
        text(i.key),
        text(i.locale, 35),
        text(i.market, 3),
        i.generation.toString(),
      ];
      const checksum = digest({ ...i, generation: i.generation.toString(), content });
      // Serializes first publication and all replay checks for this key, including tombstones.
      await q(tx, 'SELECT pg_advisory_xact_lock(hashtextextended($1,1201))', [
        JSON.stringify(identity.slice(0, 3)),
      ]);
      const existing = await q(
        tx,
        'SELECT checksum FROM app.content_publications WHERE content_key=$1 AND locale=$2 AND market=$3 AND generation=$4',
        identity,
      );
      if (existing.rows.length) {
        if (existing.rows[0]!.checksum !== checksum) stop('conflict');
        return;
      }
      let contentId: unknown = null;
      if (content !== null) {
        const r = await q(
          tx,
          `INSERT INTO app.published_content(content_key,cms_revision,locale,market,public_dto,schema_version,content_hash,published_at,valid_until) VALUES($1,$2,$3,$4,$5,1,$6,$7,$8) ON CONFLICT(content_key,cms_revision,locale,market) DO NOTHING RETURNING id`,
          [
            i.key,
            text(i.cmsRevision),
            i.locale,
            i.market,
            JSON.stringify(content),
            digest(content),
            i.publishedAt,
            i.expiresAt,
          ],
        );
        if (!r.rows.length) stop('conflict');
        contentId = one(r.rows).id;
      }
      await q(
        tx,
        'INSERT INTO app.content_publications(content_key,locale,market,generation,content_id,checksum,published_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [...identity, contentId, checksum, i.publishedAt, i.expiresAt],
      );
      await q(
        tx,
        `INSERT INTO app.content_publication_heads(content_key,locale,market,generation) VALUES($1,$2,$3,$4) ON CONFLICT(content_key,locale,market) DO UPDATE SET generation=excluded.generation WHERE content_publication_heads.generation<excluded.generation`,
        identity,
      );
    },
    async configure(tx, input, reviewer) {
      let value;
      try {
        value = publicConfiguration(input);
      } catch {
        return reject();
      }
      const checksum = configurationChecksum(value);
      if (
        !(
          await q(tx, "SELECT id FROM admin.staff_identities WHERE id=$1 AND status='active'", [
            reviewer,
          ])
        ).rows.length
      )
        stop('forbidden');
      await q(tx, 'SELECT pg_advisory_xact_lock(1202,1)');
      const existing = await q(
        tx,
        'SELECT checksum FROM app.public_configurations WHERE version=$1',
        [value.revision],
      );
      if (existing.rows.length) {
        if (existing.rows[0]!.checksum !== checksum) stop('conflict');
        return { value, checksum };
      }
      const config = one(
        (
          await q(
            tx,
            "INSERT INTO admin.configuration_versions(key,version,schema_version,value,status,published_at,reviewed_by) VALUES('public_runtime',$1,1,$2,'published',clock_timestamp(),$3) RETURNING id",
            [value.revision, JSON.stringify(value), reviewer],
          )
        ).rows,
      );
      await q(
        tx,
        'INSERT INTO app.public_configurations(version,configuration_id,issued_at,expires_at,analytics,advertising,checksum) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          value.revision,
          config.id,
          value.issuedAt,
          value.expiresAt,
          value.analytics,
          value.advertising,
          checksum,
        ],
      );
      return { value, checksum };
    },
  } satisfies PublicationRepository);
}
export function createPublicReadRepository(scope: WriteScope): PublicReadRepository {
  return guarded(scope, {
    async content(tx, key) {
      const x = (
        await scope.query(
          tx,
          'SELECT public_dto,content_hash FROM app.current_public_content WHERE content_key=$1 AND locale=$2 AND market=$3',
          [text(key.key), text(key.locale, 35), text(key.market, 3)],
        )
      ).rows[0];
      if (!x) return null;
      let value;
      try {
        value = publicContent(x.public_dto);
      } catch {
        return stop('integrity');
      }
      if (digest(value) !== x.content_hash) stop('integrity');
      return value;
    },
    async configuration(tx) {
      const x = (
        await scope.query(
          tx,
          'SELECT *,issued_at<=clock_timestamp() AND expires_at>clock_timestamp() AS valid FROM app.public_configuration',
        )
      ).rows[0];
      if (!x || !x.valid) return null;
      const value = publicConfiguration({
        schemaVersion: 1,
        revision: x.version,
        issuedAt: stamp(x.issued_at),
        expiresAt: stamp(x.expires_at),
        analytics: x.analytics,
        advertising: x.advertising,
      });
      if (configurationChecksum(value) !== x.checksum) return stop('integrity');
      return { value, checksum: String(x.checksum) };
    },
  } satisfies PublicReadRepository);
}
