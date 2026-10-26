import type {
  EditorialRepository,
  CmsRef,
  ContentPacket,
} from '../../../application/src/ports/content-services.ts';
import { canonical } from '../../../application/src/services/service-records.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { one, rid, rev, stamp, text, obj, integer } from './private-values.ts';
const table = (collection: CmsRef['collection']) =>
  collection === 'articles'
    ? 'public.articles'
    : collection === 'glossary-terms'
      ? 'public.glossary_terms'
      : stop('invalid_input');
export function createEditorialRepository(s: WriteScope): EditorialRepository {
  const q = s.query;
  const repo: EditorialRepository = {
    async source(tx, ref) {
      const t = table(ref.collection);
      const x = (
        await q(
          tx,
          `SELECT d.*,c.app_staff_id,e.result FROM ${t} d LEFT JOIN public.cms_staff c ON c.id=d.reviewer_id LEFT JOIN public.editorial_reviews e ON e.document_id=d.id::text AND e.collection_slug=$2 AND e.content_revision=d.revision AND e.reviewer_id=d.reviewer_id WHERE d.id=$1 AND d.revision=$3 FOR SHARE OF d`,
          [ref.id, ref.collection, integer(ref.revision)],
        )
      ).rows[0];
      if (!x) return null;
      return {
        ...ref,
        key: text(x.content_key),
        locale: text(x.locale, 35),
        market: text(x.market, 16),
        title: text(x.title, 300),
        body: x[ref.collection === 'articles' ? 'body' : 'definition'],
        published: x._status === 'published',
        approved: x.review_status === 'approved' && x.result === 'approved',
        reviewerId: x.app_staff_id === null ? null : rid('staff', x.app_staff_id),
        reviewedAt: x.reviewed_at === null ? null : stamp(x.reviewed_at),
        modifiedAt: stamp(x.updated_at),
        expiresAt: x.expires_at === null ? null : stamp(x.expires_at),
        sourceUrl: x.source_url === null ? null : text(x.source_url, 2048),
      };
    },
    async enqueue(tx, packet) {
      const raw = canonical(packet, 240000);
      await q(
        tx,
        `INSERT INTO public.publication_work(collection_slug,document_id,content_revision,event_id,public_dto,schema_version) VALUES($1,$2,$3,gen_random_uuid()::text,$4,1) ON CONFLICT(collection_slug,document_id,content_revision) DO NOTHING`,
        [packet.ref.collection, packet.ref.id, packet.ref.revision, raw],
      );
      const r = one(
        (
          await q(
            tx,
            'SELECT id,public_dto FROM public.publication_work WHERE collection_slug=$1 AND document_id=$2 AND content_revision=$3',
            [packet.ref.collection, packet.ref.id, packet.ref.revision],
          )
        ).rows,
      );
      if (canonical(r.public_dto, 240000) !== raw) return stop('conflict');
      return rid('cms_work', r.id);
    },
    async lease(tx, id) {
      const x = (
        await q(
          tx,
          `UPDATE public.publication_work SET state='leased',lease_token=gen_random_uuid()::text,lease_generation=lease_generation+1,lease_until=clock_timestamp()+interval '30 seconds',attempts=attempts+1,updated_at=clock_timestamp() WHERE id=$1 AND attempts<8 AND ((state IN ('pending','failed') AND coalesce(next_attempt_at,created_at)<=clock_timestamp()) OR (state='leased' AND lease_until<=clock_timestamp())) RETURNING *`,
          [id],
        )
      ).rows[0];
      return x
        ? {
            id,
            token: rid('lease', x.lease_token),
            generation: rev(String(x.lease_generation)),
            packet: obj(x.public_dto, 240000) as unknown as ContentPacket,
          }
        : null;
    },
    async current(tx, l) {
      one(
        (
          await q(
            tx,
            "SELECT id FROM public.publication_work WHERE id=$1 AND state='leased' AND lease_token=$2 AND lease_generation=$3 AND lease_until>clock_timestamp() FOR UPDATE",
            [l.id, l.token, l.generation.toString()],
          )
        ).rows,
      );
      const current = await repo.source(tx, l.packet.ref);
      if (!current) return false;
      return (
        current.key === l.packet.key &&
        current.locale === l.packet.locale &&
        current.market === l.packet.market &&
        (l.packet.page === null
          ? !current.published
          : current.published &&
            current.approved &&
            current.reviewerId === l.packet.reviewerId &&
            current.modifiedAt === l.packet.publishedAt &&
            current.expiresAt === l.packet.expiresAt)
      );
    },
    async finish(tx, l, status) {
      one(
        (
          await q(
            tx,
            `UPDATE public.publication_work SET state=$4::text::public.enum_publication_work_state,published_at=CASE WHEN $4::text='published' THEN clock_timestamp() END,lease_token=NULL,lease_until=NULL,last_error_code=NULL,updated_at=clock_timestamp() WHERE id=$1 AND state='leased' AND lease_token=$2 AND lease_generation=$3 AND lease_until>clock_timestamp() RETURNING id`,
            [l.id, l.token, l.generation.toString(), status],
          )
        ).rows,
      );
    },
    async fail(tx, l) {
      await q(
        tx,
        `UPDATE public.publication_work SET state='failed',lease_token=NULL,lease_until=NULL,next_attempt_at=clock_timestamp()+least(300,power(2,attempts))*interval '1 second',last_error_code=CASE WHEN attempts>=8 THEN 'retry_exhausted' ELSE 'publication_failed' END,updated_at=clock_timestamp() WHERE id=$1 AND state='leased' AND lease_token=$2 AND lease_generation=$3 AND lease_until>clock_timestamp()`,
        [l.id, l.token, l.generation.toString()],
      );
    },
    async pending(tx) {
      return (
        await q(
          tx,
          `SELECT id FROM public.publication_work WHERE attempts<8 AND ((state IN ('pending','failed') AND coalesce(next_attempt_at,created_at)<=clock_timestamp()) OR (state='leased' AND lease_until<=clock_timestamp())) ORDER BY created_at,id LIMIT 20`,
        )
      ).rows.map((x) => rid('cms_work', x.id));
    },
  };
  return guarded(s, repo);
}
