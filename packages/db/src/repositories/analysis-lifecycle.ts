import type {
  AnalysisErasureRepository,
  AnalysisDeliveryRepository,
  AnalysisErasureLease,
} from '../../../application/src/ports/analysis-lifecycle.ts';
import { freezeAnalysis } from '../../../domain/src/analysis-delivery.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import {
  uid,
  big,
  word,
  hash,
  at,
  choice,
  revisionValue,
  object,
  bool,
  num,
} from './analysis-values.ts';
import { keyJson } from './private-values.ts';
import { boundedJson } from './bounds.ts';
const lease = (l: AnalysisErasureLease) => [
  uid('analysis_erasure', l.id),
  uid('lease', l.token),
  big(l.generation, 1n).toString(),
];
export function createAnalysisErasureRepository(
  s: WriteScope,
  bucket: string,
  keyVersions: readonly string[],
): AnalysisErasureRepository {
  word(bucket, 200);
  if (!keyVersions.length || keyVersions.length > 4) stop('invalid_input');
  keyVersions.forEach((k) => word(k, 100));
  const q = s.query;
  return guarded<AnalysisErasureRepository>(s, {
    async beginRequest(tx, id) {
      const r = (
        await q(tx, 'SELECT privacy.ai_erasure_begin_request($1) AS id', [
          uid('privacy_request', id),
        ])
      ).rows[0];
      return r?.id ? uid('analysis_erasure', r.id) : null;
    },
    async beginScope(tx, keys, scope, command) {
      return uid(
        'analysis_erasure',
        (
          await q(tx, 'SELECT privacy.ai_erasure_begin_scope($1,$2,$3) AS id', [
            keyJson(keys),
            uid('ai_scope', scope),
            hash(command),
          ])
        ).rows[0]?.id,
      );
    },
    async acquire(tx, id) {
      const r = (
        await q(tx, 'SELECT * FROM privacy.ai_erasure_acquire($1)', [uid('analysis_erasure', id)])
      ).rows[0];
      return r?.id
        ? Object.freeze({
            id: uid('analysis_erasure', r.id),
            token: uid('lease', r.lease_token),
            generation: revisionValue(r.lease_generation),
            phase: choice(r.phase, ['journal', 'prepare', 'objects', 'providers', 'sql']),
          })
        : null;
    },
    async marks(tx, l) {
      const r = (await q(tx, 'SELECT privacy.ai_erasure_marks($1,$2,$3) AS marks', lease(l)))
        .rows[0]?.marks;
      if (!Array.isArray(r) || r.length > 25) return stop('integrity');
      return Object.freeze(
        r.map((x) =>
          Object.freeze({
            hash: hash(x.hash),
            revision: big(x.revision, 1n).toString(),
            permanent: bool(x.permanent),
          }),
        ),
      );
    },
    async journaled(tx, l, digest) {
      await q(tx, 'SELECT privacy.ai_erasure_journaled($1,$2,$3,$4)', [...lease(l), hash(digest)]);
    },
    async journal(tx, l, record) {
      const r = object(
        (
          await q(tx, 'SELECT privacy.ai_erasure_journal($1,$2,$3,$4) AS value', [
            ...lease(l),
            boundedJson(record, 32768),
          ])
        ).rows[0]?.value,
        32768,
      );
      return Object.freeze({
        keyVersion: word(r.keyVersion, 100),
        digest: hash(r.digest),
        document: r.document,
      });
    },
    async prepare(tx, l) {
      await q(tx, 'SELECT privacy.ai_erasure_prepare($1,$2,$3)', lease(l));
    },
    async object(tx, l) {
      const r = object(
        (await q(tx, 'SELECT privacy.ai_erasure_object($1,$2,$3) AS value', lease(l))).rows[0]
          ?.value,
      );
      if (r.asset === null) return Object.freeze({ wait: bool(r.wait), asset: null });
      const a = object(r.asset);
      if (
        a.object_key !== 'assets/' + a.id ||
        a.bucket !== bucket ||
        !keyVersions.includes(String(a.key_version))
      )
        return stop('forbidden');
      return Object.freeze({
        wait: false,
        asset: Object.freeze({
          id: uid('asset', a.id),
          revision: revisionValue(a.revision),
          key: word(a.object_key, 2048),
          mime: word(a.mime_type, 100),
          sha256: hash(a.sha256),
          size: num(Number(a.size_bytes), 0, 10485760),
          version: a.object_version === null ? null : word(a.object_version, 1024),
          state: choice(a.state, ['deleting', 'deleted']),
        }),
      });
    },
    async provider(tx, l) {
      const r = (await q(tx, 'SELECT privacy.ai_erasure_provider($1,$2,$3) AS value', lease(l)))
        .rows[0]?.value;
      if (r === null) return null;
      const x = object(r),
        hex = word(x.ciphertext, 32768);
      if (!/^(?:[a-f0-9]{2})+$/.test(hex)) return stop('integrity');
      return Object.freeze({
        id: uid('erasure_resource', x.id),
        provider: word(x.provider, 64),
        kind: choice(x.kind, ['file', 'response', 'email']),
        reference: Object.freeze({ keyVersion: word(x.key_version, 100), hex }),
      });
    },
    async receipt(tx, l, kind, id, digest) {
      await q(tx, 'SELECT privacy.ai_erasure_receipt($1,$2,$3,$4,$5,$6)', [
        ...lease(l),
        choice(kind, ['objects', 'providers']),
        uid('erasure_resource', id),
        hash(digest),
      ]);
    },
    async purge(tx, l) {
      return choice(
        (await q(tx, 'SELECT privacy.ai_erasure_purge($1,$2,$3) AS value', lease(l))).rows[0]
          ?.value,
        ['pending', 'complete', 'charges'],
      );
    },
    async finish(tx, l) {
      await q(tx, 'SELECT privacy.ai_erasure_finish($1,$2,$3)', lease(l));
    },
    async release(tx, l, blocked, failed = false) {
      await q(tx, 'SELECT privacy.ai_erasure_release($1,$2,$3,$4,$5)', [
        ...lease(l),
        bool(blocked),
        bool(failed),
      ]);
    },
    async status(tx, id) {
      return choice(
        (
          await q(tx, 'SELECT privacy.ai_erasure_status($1) AS value', [
            uid('analysis_erasure', id),
          ])
        ).rows[0]?.value,
        ['pending', 'complete', 'blocked'],
      );
    },
    async pending(tx) {
      return Object.freeze(
        (await q(tx, 'SELECT privacy.ai_erasure_pending() AS id')).rows.map((r) =>
          uid('analysis_erasure', r.id),
        ),
      );
    },
    async operatorRetry(tx, job, actor, evidence) {
      await q(tx, 'SELECT privacy.ai_erasure_operator_retry($1,$2,$3)', [
        uid('analysis_erasure', job),
        uid('staff', actor),
        hash(evidence),
      ]);
    },
    async retryRequest(tx, id) {
      await q(tx, 'SELECT privacy.ai_erasure_retry($1)', [uid('privacy_request', id)]);
    },
    async replay(tx, marks, receipt) {
      await q(tx, 'SELECT privacy.ai_erasure_replay($1,$2)', [
        boundedJson(marks, 262144),
        hash(receipt),
      ]);
    },
    async freshScope(tx, id) {
      return bool(
        (await q(tx, 'SELECT app.ai_scope_erased($1) AS value', [uid('ai_scope', id)])).rows[0]
          ?.value,
      );
    },
    async save(tx, keys, id, notice, evidence) {
      return at(
        (
          await q(tx, 'SELECT app.ai_photo_save($1,$2,$3,$4) AS until', [
            keyJson(keys),
            uid('photo_upload', id),
            word(notice, 100),
            hash(evidence),
          ])
        ).rows[0]?.until,
      );
    },
    async expired(tx) {
      return Object.freeze(
        (await q(tx, 'SELECT privacy.ai_erasure_expired() AS id')).rows.map((r) =>
          uid('ai_scope', r.id),
        ),
      );
    },
    async beginExpired(tx, id) {
      return uid(
        'analysis_erasure',
        (await q(tx, 'SELECT privacy.ai_erasure_begin_expired($1) AS id', [uid('ai_scope', id)]))
          .rows[0]?.id,
      );
    },
    async registerProvider(tx, i) {
      if (!/^(?:[a-f0-9]{2}){1,16384}$/.test(i.reference.hex)) return stop('invalid_input');
      await q(tx, 'SELECT app.ai_provider_register($1,$2,$3,$4,$5,$6,$7,$8)', [
        uid('erasure_resource', i.id),
        uid('ai_scope', i.scopeId),
        uid('ai_attempt', i.attemptId),
        word(i.provider, 64),
        choice(i.kind, ['file', 'response']),
        word(i.reference.keyVersion, 100),
        Buffer.from(i.reference.hex, 'hex'),
        boundedJson(i.referenceKeys, 2048),
      ]);
    },
  });
}
export function createAnalysisDeliveryRepository(s: WriteScope): AnalysisDeliveryRepository {
  return guarded<AnalysisDeliveryRepository>(s, {
    async capture(tx, i) {
      return freezeAnalysis(
        (
          await s.query(tx, 'SELECT app.ai_delivery_capture($1,$2,$3,$4,$5,$6) AS value', [
            uid('send', i.sendId),
            uid('subject', i.ownerId),
            uid('report', i.reportId),
            num(i.version, 1),
            i.revision === null ? null : big(i.revision, 1n).toString(),
            i.fallback === null
              ? null
              : choice(i.fallback, ['not_requested', 'unavailable', 'declined', 'expired']),
          ])
        ).rows[0]?.value,
      );
    },
    async selection(tx, id) {
      return freezeAnalysis(
        (await s.query(tx, 'SELECT app.ai_delivery_selection($1) AS value', [uid('send', id)]))
          .rows[0]?.value,
      );
    },
    async permitted(tx, id) {
      return bool(
        (await s.query(tx, 'SELECT app.ai_delivery_permitted($1) AS value', [uid('send', id)]))
          .rows[0]?.value,
      );
    },
  });
}
