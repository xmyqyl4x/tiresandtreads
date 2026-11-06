import type { PhotoOwnerRepository } from '../../../application/src/ports/photo-repositories.ts';
import type { TransactionContext as Tx } from '../../../application/src/ports/transactions.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import {
  photoStatusFromRow,
  photoCandidateFromRow,
  photoConfirmationFromRow,
} from './photo-mappers.ts';
import { uid, at, word, hash, big, stored, choice, photoFields } from './analysis-values.ts';
import { cursor, nextCursor, pageLimit, reject } from './bounds.ts';
export async function photoContext(s: WriteScope, tx: Tx, owner: unknown) {
  const id = uid('subject', owner);
  await s.query(tx, "SELECT set_config('tt.p2_photo_subject',$1,true)", [id]);
  return id;
}
export async function lockPhoto(
  s: WriteScope,
  tx: Tx,
  owner: unknown,
  upload: unknown,
  job: unknown = null,
) {
  const person = await photoContext(s, tx, owner);
  await s.query(tx, 'SELECT app.photo_repository_root($1,$2,$3)', [
    person,
    uid('photo_upload', upload),
    job === null ? null : uid('job', job),
  ]);
}
export function createPhotoOwnerRepository(s: WriteScope): PhotoOwnerRepository {
  return guarded<PhotoOwnerRepository>(s, {
    async status(tx, owner, upload) {
      await photoContext(s, tx, owner);
      const r = (
        await s.query(
          tx,
          'SELECT id,state,created_at,expires_at,saved_at FROM app.photo_owner_status WHERE id=$1',
          [uid('photo_upload', upload)],
        )
      ).rows[0];
      return r ? stored(photoStatusFromRow(r)) : null;
    },
    async list(tx, owner, page) {
      const person = await photoContext(s, tx, owner),
        limit = pageLimit(page.limit),
        binding = { kind: 'photo_status', owner: person },
        after = cursor(binding, page.after);
      const rows = (
          await s.query(
            tx,
            'SELECT id,state,created_at,expires_at,saved_at FROM app.photo_owner_status WHERE ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT $2',
            [after, limit + 1],
          )
        ).rows,
        items = rows.slice(0, limit).map((r) => stored(photoStatusFromRow(r)));
      return Object.freeze({
        items: Object.freeze(items),
        next: rows.length > limit ? nextCursor(binding, items.at(-1)!.id) : null,
      });
    },
    async candidates(tx, owner, upload) {
      await photoContext(s, tx, owner);
      const rows = (
        await s.query(
          tx,
          'SELECT id,upload_id,field_code,ordinal,raw_text,normalized_value,unknown_reason,quality,region FROM app.photo_current_candidates WHERE upload_id=$1 ORDER BY field_code,ordinal,id LIMIT 41',
          [uid('photo_upload', upload)],
        )
      ).rows;
      if (rows.length > 40) return stop('integrity');
      return Object.freeze(rows.map((r) => stored(photoCandidateFromRow(r))));
    },
    async confirmations(tx, owner, upload) {
      await photoContext(s, tx, owner);
      return Object.freeze(
        (
          await s.query(
            tx,
            'SELECT upload_id,field_code,revision::text,candidate_id,origin,confirmed_value,confirmed_at FROM app.photo_current_confirmations WHERE upload_id=$1 ORDER BY field_code LIMIT 10',
            [uid('photo_upload', upload)],
          )
        ).rows.map((r) => stored(photoConfirmationFromRow(r))),
      );
    },
    async confirm(tx, owner, input) {
      const i = {
        upload: uid('photo_upload', input.uploadId),
        field: choice(input.field, photoFields),
        revision: big(input.revision, 1n).toString(),
        candidate: input.candidateId === null ? null : uid('photo_candidate', input.candidateId),
        origin: choice(input.origin, ['accepted_candidate', 'corrected_candidate', 'manual']),
        value: word(input.value, 512),
      };
      if ((i.origin === 'manual') !== (i.candidate === null)) return reject();
      await lockPhoto(s, tx, owner, i.upload);
      await s.query(
        tx,
        'INSERT INTO app.confirmed_photo_fields(upload_id,owner_subject_id,field_code,revision,candidate_id,origin,confirmed_value,confirmed_at) VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp())',
        [i.upload, owner, i.field, i.revision, i.candidate, i.origin, i.value],
      );
      const r =
        (
          await s.query(
            tx,
            'SELECT upload_id,field_code,revision::text,candidate_id,origin,confirmed_value,confirmed_at FROM app.photo_current_confirmations WHERE upload_id=$1 AND field_code=$2',
            [i.upload, i.field],
          )
        ).rows[0] ?? stop('integrity');
      return stored(photoConfirmationFromRow(r));
    },
    async save(tx, owner, upload, input) {
      const id = uid('photo_upload', upload),
        notice = word(input.noticeVersion, 100),
        evidence = hash(input.evidenceHash),
        until = at(input.expiresAt);
      await lockPhoto(s, tx, owner, id);
      const old =
        (
          await s.query(
            tx,
            'SELECT saved_at,expires_at FROM app.tire_photo_uploads WHERE id=$1 AND owner_subject_id=$2',
            [id, owner],
          )
        ).rows[0] ?? stop('not_found');
      if (old.saved_at !== null) return stop('conflict');
      if (
        !(
          await s.query(
            tx,
            'UPDATE app.tire_photo_uploads SET saved_at=clock_timestamp(),save_notice_version=$3,save_evidence_hash=$4,expires_at=$5 WHERE id=$1 AND owner_subject_id=$2 AND saved_at IS NULL RETURNING id',
            [id, owner, notice, evidence, until],
          )
        ).rowCount
      )
        return stop('conflict');
    },
  });
}
