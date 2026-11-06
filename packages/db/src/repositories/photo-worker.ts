import type { PhotoWorkerRepository } from '../../../application/src/ports/photo-repositories.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { uid, num, big, at, stored } from './analysis-values.ts';
import { photoCandidateFromRow, photoExtractionFromRow } from './photo-mappers.ts';
import { lockPhoto } from './photo-owners.ts';
import { reject, boundedJson } from './bounds.ts';
export function createPhotoWorkerRepository(s: WriteScope): PhotoWorkerRepository {
  async function extractionRow(
    tx: Parameters<PhotoWorkerRepository['cancel']>[0],
    owner: unknown,
    id: unknown,
  ) {
    const r = (
      await s.query(tx, 'SELECT * FROM app.photo_extractions WHERE id=$1 AND owner_subject_id=$2', [
        uid('photo_extraction', id),
        uid('subject', owner),
      ])
    ).rows[0];
    return r ?? stop('not_found');
  }
  return guarded<PhotoWorkerRepository>(s, {
    async create(tx, input) {
      const i = {
        id: uid('photo_upload', input.id),
        owner: uid('subject', input.ownerId),
        batch: uid('photo_batch', input.batchId),
        scope: uid('ai_scope', input.scopeId),
        asset: uid('asset', input.originalAssetId),
        width: num(input.width, 1),
        height: num(input.height, 1),
        permission: big(input.permissionRevision, 1n).toString(),
        subject: big(input.subjectRevision, 1n).toString(),
        invalidation: big(input.invalidationRevision).toString(),
        until: at(input.expiresAt),
      };
      if (BigInt(i.width) * BigInt(i.height) > 40000000n) return reject();
      await s.query(tx, 'SELECT app.ai_repository_subject($1,true)', [i.owner]);
      await s.query(
        tx,
        "INSERT INTO app.photo_asset_claims(asset_id,upload_id,owner_subject_id,kind) VALUES($1,$2,$3,'original')",
        [i.asset, i.id, i.owner],
      );
      await s.query(
        tx,
        'INSERT INTO app.tire_photo_uploads(id,owner_subject_id,capture_batch_id,scope_id,original_asset_id,width,height,permission_revision,subject_permission_revision,invalidation_revision,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [
          i.id,
          i.owner,
          i.batch,
          i.scope,
          i.asset,
          i.width,
          i.height,
          i.permission,
          i.subject,
          i.invalidation,
          i.until,
        ],
      );
    },
    async sanitized(tx, owner, upload, asset) {
      const id = uid('asset', asset);
      await lockPhoto(s, tx, owner, upload);
      const row =
        (
          await s.query(
            tx,
            'SELECT state,sanitized_asset_id FROM app.tire_photo_uploads WHERE id=$1 AND owner_subject_id=$2',
            [upload, owner],
          )
        ).rows[0] ?? stop('not_found');
      if (row.state === 'ready' && row.sanitized_asset_id === id) return;
      if (row.state !== 'pending' && row.state !== 'quarantined') return stop('conflict');
      await s.query(
        tx,
        "INSERT INTO app.photo_asset_claims(asset_id,upload_id,owner_subject_id,kind) VALUES($1,$2,$3,'sanitized')",
        [id, upload, owner],
      );
      if (row.state === 'pending')
        await s.query(tx, "UPDATE app.tire_photo_uploads SET state='quarantined' WHERE id=$1", [
          upload,
        ]);
      await s.query(
        tx,
        "UPDATE app.tire_photo_uploads SET state='ready',sanitized_asset_id=$2 WHERE id=$1",
        [upload, id],
      );
    },
    async extraction(tx, input) {
      const i = {
        id: uid('photo_extraction', input.id),
        owner: uid('subject', input.ownerId),
        upload: uid('photo_upload', input.uploadId),
        request: uid('ai_request', input.requestId),
        job: uid('job', input.jobId),
      };
      await lockPhoto(s, tx, i.owner, i.upload, i.job);
      return stored(
        photoExtractionFromRow(
          (
            await s.query(
              tx,
              'INSERT INTO app.photo_extractions(id,owner_subject_id,upload_id,request_id,job_id) VALUES($1,$2,$3,$4,$5) RETURNING *',
              [i.id, i.owner, i.upload, i.request, i.job],
            )
          ).rows[0]!,
        ),
      );
    },
    async start(tx, owner, id, input) {
      const lease = {
          id: uid('job', input.id),
          token: uid('lease', input.token),
          generation: big(input.generation, 1n).toString(),
        },
        r = await extractionRow(tx, owner, id);
      if (r.job_id !== lease.id) return stop('conflict');
      await lockPhoto(s, tx, owner, r.upload_id, lease.id);
      const row =
        (
          await s.query(
            tx,
            "UPDATE app.photo_extractions SET state='processing',lease_token=$3,lease_generation=$4 WHERE id=$1 AND owner_subject_id=$2 AND state IN ('queued','processing') RETURNING *",
            [id, owner, lease.token, lease.generation],
          )
        ).rows[0] ?? stop('conflict');
      await s.query(
        tx,
        "UPDATE app.tire_photo_uploads SET state='processing' WHERE id=$1 AND state='ready'",
        [r.upload_id],
      );
      return stored(photoExtractionFromRow(row));
    },
    async complete(tx, input) {
      const i = {
        owner: uid('subject', input.ownerId),
        id: uid('photo_extraction', input.extractionId),
        artifact: uid('ai_artifact', input.artifactId),
        job: uid('job', input.lease.id),
        token: uid('lease', input.lease.token),
        generation: big(input.lease.generation, 1n).toString(),
      };
      if (!Array.isArray(input.candidates) || input.candidates.length > 40) return reject();
      const candidates = input.candidates.map((c) =>
        stored(
          photoCandidateFromRow({
            id: c.id,
            upload_id: c.uploadId,
            field_code: c.field,
            ordinal: c.ordinal,
            raw_text: c.rawText,
            normalized_value: c.value,
            unknown_reason: c.unknownReason,
            quality: c.quality,
            region: c.region,
          }),
        ),
      );
      const r = await extractionRow(tx, i.owner, i.id);
      if (r.job_id !== i.job || candidates.some((c) => c.uploadId !== r.upload_id))
        return stop('conflict');
      await lockPhoto(s, tx, i.owner, r.upload_id, i.job);
      const row =
        (
          await s.query(
            tx,
            "UPDATE app.photo_extractions SET state='complete',lease_token=$3,lease_generation=$4,artifact_id=$5,candidate_count=$6,result_xid=pg_current_xact_id(),completed_at=clock_timestamp() WHERE id=$1 AND owner_subject_id=$2 AND state='processing' RETURNING *",
            [i.id, i.owner, i.token, i.generation, i.artifact, candidates.length],
          )
        ).rows[0] ?? stop('conflict');
      for (const c of candidates)
        await s.query(
          tx,
          'INSERT INTO app.photo_field_candidates(id,extraction_id,upload_id,owner_subject_id,field_code,ordinal,raw_text,normalized_value,unknown_reason,quality,region) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
          [
            c.id,
            i.id,
            r.upload_id,
            i.owner,
            c.field,
            c.ordinal,
            c.rawText,
            c.value,
            c.unknownReason,
            c.quality,
            c.region === null ? null : boundedJson(c.region, 1024),
          ],
        );
      await s.query(tx, "UPDATE app.tire_photo_uploads SET state='complete' WHERE id=$1", [
        r.upload_id,
      ]);
      return stored(photoExtractionFromRow(row));
    },
    async cancel(tx, owner, id) {
      const r = await extractionRow(tx, owner, id);
      await lockPhoto(s, tx, owner, r.upload_id, r.job_id);
      await s.query(tx, 'SELECT app.photo_repository_cancel($1,$2)', [owner, id]);
    },
  });
}
