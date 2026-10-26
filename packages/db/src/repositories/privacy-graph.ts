import type { TransactionContext as Tx } from '../../../application/src/ports/transactions.ts';
import type { RightsKind } from '../../../domain/src/privacy-policy.ts';
import type { WriteScope } from './mutations.ts';
import { stop } from './mutations.ts';
import { lockSubjects, text, type Row } from './private-values.ts';
export interface PrivacyRoot {
  readonly id: string;
  readonly subjectId: string | null;
  readonly targetKind: 'subject' | 'report';
  readonly targetId: string | null;
  readonly kind: RightsKind;
}
// Each graph operation uses this exact target predicate; contact erasure never owns another
// browser's reports. Sends addressed to a contact are removed without removing those reports.
export const reportIds = `SELECT id FROM app.reports WHERE (($2='subject' AND owner_subject_id=$1) OR ($2='report' AND id=$1))`;
export const contactIds = `SELECT id FROM privacy.contacts WHERE $2='subject' AND subject_id=$1`;
export const intentIds = `SELECT challenge_id FROM privacy.contact_intents WHERE ($2='subject' AND owner_subject_id=$1) OR contact_id IN (${contactIds})`;
export const sendIds = `SELECT s.id FROM email.email_sends s LEFT JOIN email.delivery_snapshots d ON d.send_id=s.id WHERE ($2='subject' AND s.owner_subject_id=$1) OR s.recipient_contact_id IN (${contactIds}) OR s.report_id IN (${reportIds}) OR d.verification_id IN (${intentIds}) OR d.offers_verification_id IN (${intentIds})`;
const rawAssets = `SELECT asset_id AS id FROM app.report_assets WHERE report_id IN (${reportIds}) UNION SELECT asset_id FROM email.delivery_asset_reservations WHERE send_id IN (${sendIds}) UNION SELECT payload_asset_id FROM email.email_sends WHERE id IN (${sendIds}) AND payload_asset_id IS NOT NULL UNION SELECT payload_asset_id FROM email.delivery_work WHERE send_id IN (${sendIds}) AND payload_asset_id IS NOT NULL UNION SELECT pdf_asset_id FROM email.delivery_work WHERE send_id IN (${sendIds}) AND pdf_asset_id IS NOT NULL`;
export const assetIds = `SELECT id FROM (${rawAssets}) candidates WHERE NOT EXISTS(SELECT 1 FROM app.report_assets kept WHERE kept.asset_id=candidates.id AND kept.report_id NOT IN (${reportIds}))`;
export const refs = (r: PrivacyRoot) => [r.targetId, r.targetKind];
export async function subjectGuard(s: WriteScope, tx: Tx, r: PrivacyRoot) {
  // All send mutations also lock their recipient and browser owner. Sort the complete set.
  const rows = (
    await s.query(
      tx,
      `SELECT owner_subject_id AS id FROM email.email_sends WHERE id IN (${sendIds}) AND owner_subject_id IS NOT NULL UNION SELECT c.subject_id FROM privacy.contacts c JOIN email.email_sends e ON e.recipient_contact_id=c.id WHERE e.id IN (${sendIds}) UNION SELECT $3::uuid WHERE $3::uuid IS NOT NULL`,
      [...refs(r), r.subjectId],
    )
  ).rows;
  if (rows.length)
    await lockSubjects(
      s,
      tx,
      rows.map((x) => text(x.id)),
    );
  const current = (
    await s.query(
      tx,
      `SELECT owner_subject_id AS id FROM email.email_sends WHERE id IN (${sendIds}) AND owner_subject_id IS NOT NULL UNION SELECT c.subject_id FROM privacy.contacts c JOIN email.email_sends e ON e.recipient_contact_id=c.id WHERE e.id IN (${sendIds})`,
      refs(r),
    )
  ).rows;
  if (current.some((x) => !rows.some((row) => row.id === x.id))) return stop('conflict');
}
export async function held(s: WriteScope, tx: Tx, r: PrivacyRoot) {
  return (
    (
      await s.query(
        tx,
        `SELECT 1 FROM privacy.legal_holds WHERE released_at IS NULL AND (($2='subject' AND subject_id=$1) OR resource_id IN (${reportIds}) OR resource_id IN (${contactIds}) OR resource_id IN (${sendIds}) OR resource_id IN (${assetIds})) LIMIT 1`,
        refs(r),
      )
    ).rows.length > 0
  );
}
export async function restrictGraph(s: WriteScope, tx: Tx, r: PrivacyRoot) {
  if (!r.targetId) return;
  await subjectGuard(s, tx, r);
  const q = s.query,
    v = refs(r);
  if (r.targetKind === 'subject') {
    if (r.kind === 'delete' || r.kind === 'restrict') {
      await q(
        tx,
        `UPDATE app.subjects SET status=$2,permission_revision=permission_revision+1,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1`,
        [r.targetId, r.kind === 'delete' ? 'pending_deletion' : 'restricted'],
      );
      await q(
        tx,
        `UPDATE privacy.contacts SET status=$2,revision=revision+1,updated_at=clock_timestamp() WHERE subject_id=$1`,
        [r.targetId, r.kind === 'delete' ? 'pending_deletion' : 'restricted'],
      );
    }
    for (const scope of r.kind === 'opt_out'
      ? ['all-marketing', 'all-analytics', 'ads', 'targeted_ads', 'identity_sharing']
      : ['all-email', 'all-marketing', 'all-analytics', 'ads', 'targeted_ads', 'identity_sharing'])
      await q(
        tx,
        `INSERT INTO privacy.suppressions(subject_id,scope_key,reason_code,effective_at) SELECT $1,$2,'privacy_request',clock_timestamp() WHERE NOT EXISTS(SELECT 1 FROM privacy.suppressions WHERE subject_id=$1 AND scope_key=$2 AND lifted_at IS NULL AND expires_at IS NULL)`,
        [r.targetId, scope],
      );
  }
  if (r.kind === 'opt_out') return;
  await q(
    tx,
    `UPDATE privacy.verification_challenges SET invalidated_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() WHERE (id IN (${intentIds}) OR id IN (SELECT verification_id FROM email.delivery_snapshots WHERE send_id IN (${sendIds})) OR ($2='subject' AND subject_id=$1)) AND invalidated_at IS NULL`,
    v,
  );
  if (r.targetKind === 'subject')
    await q(
      tx,
      `UPDATE app.owner_sessions SET revoked_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() WHERE subject_id=$1 AND revoked_at IS NULL`,
      [r.targetId],
    );
  await q(
    tx,
    `UPDATE app.reports SET status='pending_deletion',revision=revision+1,updated_at=clock_timestamp() WHERE id IN (${reportIds})`,
    v,
  );
  await q(
    tx,
    `UPDATE app.report_capabilities SET revoked_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() WHERE report_id IN (${reportIds}) AND revoked_at IS NULL`,
    v,
  );
  await q(
    tx,
    `UPDATE app.download_grants SET revoked_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() WHERE report_id IN (${reportIds}) AND revoked_at IS NULL`,
    v,
  );
  await q(
    tx,
    `UPDATE email.email_links SET revoked_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() WHERE send_id IN (${sendIds}) AND revoked_at IS NULL`,
    v,
  );
  await q(
    tx,
    `UPDATE email.email_sends SET dispatch_state='suppressed',revision=revision+1,updated_at=clock_timestamp() WHERE id IN (${sendIds}) AND dispatch_state IN ('scheduled','dispatching')`,
    v,
  );
  await q(
    tx,
    `UPDATE app.outbox SET state='cancelled',published_at=NULL,lease_token=NULL,lease_until=NULL,lease_owner=NULL,revision=revision+1,updated_at=clock_timestamp() WHERE aggregate_id=$1 OR aggregate_id IN (${reportIds}) OR aggregate_id IN (${sendIds}) OR (payload->>'resource_id') IN (SELECT id::text FROM (${reportIds} UNION ${sendIds}) x)`,
    v,
  );
  await q(
    tx,
    `UPDATE app.job_runs SET state='cancelled',lease_token=NULL,lease_until=NULL,checkpoint=NULL,revision=revision+1,updated_at=clock_timestamp() WHERE resource_id=$1 OR resource_id IN (${reportIds}) OR resource_id IN (${sendIds})`,
    v,
  );
  if (r.kind === 'delete')
    await q(
      tx,
      `INSERT INTO privacy.asset_barriers(asset_id) SELECT id FROM (${assetIds}) x ORDER BY id ON CONFLICT DO NOTHING`,
      v,
    );
  if (r.kind === 'delete')
    await q(
      tx,
      `UPDATE app.object_assets SET state='deleting',revision=revision+1,updated_at=clock_timestamp() WHERE id IN (${assetIds}) AND state NOT IN ('deleting','deleted')`,
      v,
    );
}
export async function eraseReport(s: WriteScope, tx: Tx, report: string) {
  const q = s.query;
  await q(tx, "DELETE FROM privacy.consent_state WHERE purpose='report' AND scope_key LIKE $1", [
    'report:' + report + ':%',
  ]);
  await q(
    tx,
    "DELETE FROM privacy.subject_links WHERE event_id IN (SELECT id FROM privacy.consent_events WHERE purpose='report' AND scope_key LIKE $1)",
    ['report:' + report + ':%'],
  );
  // Composite references are erased before their parent snapshots. No cascade or disabled guard.
  for (const table of [
    'app.download_grants',
    'app.report_assets',
    'app.report_capabilities',
    'privacy.report_private_data',
    'app.report_drafts',
    'app.comparison_items',
    'app.comparisons',
    'app.report_items',
  ])
    await q(tx, `DELETE FROM ${table} WHERE report_id=$1`, [report]);
  await q(
    tx,
    'DELETE FROM privacy.quote_private_data WHERE quote_id IN (SELECT id FROM app.shop_quotes WHERE report_id=$1)',
    [report],
  );
  await q(tx, 'DELETE FROM app.shop_quotes WHERE report_id=$1', [report]);
  await q(tx, "UPDATE app.reports SET status='pending_deletion',current_version=NULL WHERE id=$1", [
    report,
  ]);
  await q(tx, 'DELETE FROM app.report_versions WHERE report_id=$1', [report]);
  await q(tx, 'DELETE FROM app.reports WHERE id=$1', [report]);
}
export async function eraseSends(s: WriteScope, tx: Tx, r: PrivacyRoot) {
  const q = s.query,
    v = refs(r);
  // One send per pass bounds external receipts and child deletes. Even previously accepted
  // messages need downstream acknowledgment; no provider deletion API is presumed.
  const row = (
    await q(tx, `SELECT id FROM email.email_sends WHERE id IN (${sendIds}) ORDER BY id LIMIT 1`, v)
  ).rows[0];
  if (!row) return false;
  const id = text(row.id);
  const observations = (
    await q(
      tx,
      `SELECT o.inbox_id FROM email.callback_observations o JOIN email.email_sends e ON e.id=$1 WHERE o.message_id=e.provider_message_id OR o.delivery_key=e.provider_key`,
      [id],
    )
  ).rows;
  for (const x of observations) {
    await q(tx, 'DELETE FROM email.callback_observations WHERE inbox_id=$1', [x.inbox_id]);
    await q(tx, 'DELETE FROM app.webhook_inbox WHERE id=$1', [x.inbox_id]);
  }
  for (const t of [
    'email.delivery_asset_reservations',
    'email.delivery_snapshots',
    'email.delivery_work',
    'email.email_links',
    'email.email_feedback',
    'email.email_events',
    'email.send_attempts',
    'email.send_receipts',
  ])
    await q(tx, `DELETE FROM ${t} WHERE send_id=$1`, [id]);
  await q(tx, 'DELETE FROM app.idempotency_requests WHERE resource_id=$1', [id]);
  await q(tx, 'DELETE FROM email.email_sends WHERE id=$1', [id]);
  return true;
}
export async function eraseIdentity(s: WriteScope, tx: Tx, r: PrivacyRoot) {
  if (r.targetKind !== 'subject' || !r.targetId) return;
  const q = s.query,
    v = refs(r),
    id = r.targetId;
  await q(tx, `DELETE FROM privacy.contact_intents WHERE challenge_id IN (${intentIds})`, v);
  // Verification challenges may belong to retained contacts but their owner-bound intent has gone.
  for (const t of ['privacy.verification_challenges', 'privacy.contact_lookups'])
    await q(
      tx,
      t.endsWith('lookups')
        ? `DELETE FROM ${t} WHERE contact_id IN (${contactIds})`
        : `DELETE FROM ${t} WHERE subject_id=$1`,
      t.endsWith('lookups') ? v : [id],
    );
  for (const t of [
    'privacy.consent_state',
    'privacy.subject_links',
    'privacy.cookie_consents',
    'privacy.suppressions',
    'analytics.processing_restrictions',
    'admin.audit_identity_links',
  ])
    await q(tx, `DELETE FROM ${t} WHERE subject_id=$1`, [id]);
  await q(tx, 'DELETE FROM privacy.contacts WHERE subject_id=$1', [id]);
  await q(tx, 'DELETE FROM app.owner_sessions WHERE subject_id=$1', [id]);
  await q(tx, 'UPDATE privacy.privacy_requests SET subject_id=NULL WHERE subject_id=$1', [id]);
  // Released holds are historical case records; erase their subject mapping at fulfillment.
  await q(tx, 'SELECT privacy.erase_released_holds($1)', [id]);
  const released = (await q(tx, 'SELECT id FROM privacy.legal_holds WHERE subject_id=$1', [id]))
    .rows;
  if (released.length) stop('forbidden');
  await q(tx, 'DELETE FROM app.subjects WHERE id=$1', [id]);
}
export function rootRow(x: Row): PrivacyRoot {
  return {
    id: text(x.id),
    subjectId: x.subject_id === null ? null : text(x.subject_id),
    targetId: x.target_id === null ? null : text(x.target_id),
    targetKind: x.target_kind as PrivacyRoot['targetKind'],
    kind: x.kind as RightsKind,
  };
}
