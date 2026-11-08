import { useState } from 'react';
import type { OwnerReportView } from '../../../../../packages/contracts/src/report-views.ts';
import type { Workspace } from '../workbench.tsx';
import { ActionForm, Field, Receipt } from '../workbench.tsx';
import type { OwnerClients } from './types.ts';
import { assistanceState, deliverySelection } from './forms.ts';
import { AssistanceExplanation } from './explanation.tsx';
type Presentation = Awaited<
  ReturnType<OwnerClients['presentation']['p2AnalysisPresentation']>
>['data'];
type Status = Awaited<ReturnType<OwnerClients['analysis']['p2AnalysisStatus']>>['data'];
type Attachment = Awaited<ReturnType<OwnerClients['analysis']['p2AnalysisAttachment']>>['data'];
type Delivery = Awaited<ReturnType<OwnerClients['analysis']['p2AnalysisDelivery']>>['data'];
export function AssistedReport({
  w,
  report,
}: {
  w: Workspace<OwnerClients>;
  report: OwnerReportView;
}) {
  const [presentation, setPresentation] = useState<Presentation | null>(null),
    [status, setStatus] = useState<Status | null>(null),
    [attachment, setAttachment] = useState<Attachment | null>(null),
    [policy, setPolicy] = useState<Awaited<ReturnType<OwnerClients['delivery']['policy']>> | null>(
      null,
    ),
    [delivery, setDelivery] = useState<Delivery | null>(null),
    [allowed, setAllowed] = useState(false),
    [refreshed, setRefreshed] = useState(false);
  const path = { report: report.reportId, version: String(report.version) },
    blocked = w.busy || w.blocked;
  async function refresh() {
    await w.read(
      'Assistance status',
      async () => {
        const p = (await w.client.presentation.p2AnalysisPresentation({ path })).data;
        if (p.reportId !== report.reportId || p.version !== report.version)
          throw Error('Invalid report binding');
        const s = p.latestRequest
          ? (await w.client.analysis.p2AnalysisStatus({ path: { request: p.latestRequest } })).data
          : null;
        if (s && (s.reportId !== report.reportId || s.version !== report.version))
          throw Error('Invalid status binding');
        const a = p.selection
          ? (await w.client.analysis.p2AnalysisAttachment({ path })).data
          : {
              state: 'unavailable' as const,
              reportId: report.reportId,
              version: report.version,
              attachment: null,
            };
        return { p, s, a, policy: await w.client.delivery.policy() };
      },
      (v) => {
        setPresentation(v.p);
        setStatus(v.s);
        setAttachment(v.a);
        setPolicy(v.policy);
        setRefreshed(true);
      },
    );
  }
  const processing = status?.processing,
    state = status?.state ?? 'not_requested';
  return (
    <section aria-label="Optional report assistance">
      <h2>Optional report assistance</h2>
      <p role="status">
        {presentation
          ? assistanceState(state)
          : 'Assistance status has not been checked for this report. Your recorded report remains available.'}
      </p>
      <button disabled={w.busy} onClick={() => void refresh()}>
        Check assistance options and status
      </button>
      {refreshed ? (
        <p>Status refreshed. No model request or email was sent by this check.</p>
      ) : null}
      {presentation ? (
        <>
          <p>{presentation.assistance.notice}</p>
          <p>
            Notice {presentation.assistance.noticeVersion}. Availability and reuse checked{' '}
            <time dateTime={presentation.checkedAt}>{presentation.checkedAt}</time>.
          </p>
          <form
            className="staff-card"
            onSubmit={(e) => {
              e.preventDefault();
              if (!allowed || !presentation.assistance.policyId) return;
              setRefreshed(false);
              setAttachment(null);
              void w.command(
                'Request assistance',
                (c) =>
                  w.client.analysis.p2AnalysisRequest({
                    path,
                    body: {
                      policyId: presentation.assistance.policyId!,
                      allowed: true,
                      noticeVersion: presentation.assistance.noticeVersion,
                    },
                    command: c,
                  }),
                (r) => {
                  setStatus(r.data);
                  setAllowed(false);
                },
              );
            }}
          >
            <label>
              <input
                type="checkbox"
                checked={allowed}
                disabled={
                  blocked ||
                  !presentation.assistance.available ||
                  (!!processing && !processing.allowed)
                }
                onChange={(e) => setAllowed(e.target.checked)}
              />
              I choose optional processing under this notice.
            </label>
            <button
              disabled={
                blocked ||
                !allowed ||
                !presentation.assistance.available ||
                (!!processing && !processing.allowed)
              }
            >
              Request or refresh assistance
            </button>
            {!presentation.assistance.available ? (
              <p>
                Assistance is not configured or currently available. The recorded report remains
                usable.
              </p>
            ) : null}
          </form>
          {processing ? (
            <div className="staff-card">
              <p>
                Processing permission: {processing.allowed ? 'allowed' : 'withdrawn'} · revision{' '}
                {processing.permissionRevision}
              </p>
              <button
                disabled={blocked}
                onClick={() => {
                  setAttachment(null);
                  void w.command(
                    processing.allowed
                      ? 'Withdraw processing permission'
                      : 'Allow processing under this notice',
                    (c) =>
                      w.client.analysis.p2AnalysisChoice({
                        path: { scope: processing.scopeId },
                        body: {
                          allowed: !processing.allowed,
                          expectedRevision: processing.permissionRevision,
                          noticeVersion: presentation.assistance.noticeVersion,
                        },
                        command: c,
                      }),
                    () => {
                      setAllowed(false);
                      setStatus(null);
                      setPresentation(null);
                      setRefreshed(false);
                    },
                  );
                }}
              >
                {processing.allowed
                  ? 'Withdraw processing permission'
                  : 'Allow processing again explicitly'}
              </button>
              <p>
                Withdrawal denies future reads and processing. It cannot recall a delivery already
                handed off.
              </p>
            </div>
          ) : null}
          {attachment?.state === 'available' ? (
            <AssistanceExplanation
              attachment={attachment.attachment}
              selection={presentation.selection}
              report={report}
            />
          ) : (
            <p>No current readable attachment is selected. Use the deterministic report below.</p>
          )}
          <ActionForm
            key={policy ? policy.version + policy.notices.report : 'no-delivery-notice'}
            title="Request this saved report by email"
            disabled={blocked || !policy}
            action={async (f) => {
              setDelivery(null);
              if (!policy) throw Error('Current notice required');
              if (f.get('reportConsent') !== 'on') throw Error('Consent required');
              const choice = deliverySelection(
                String(f.get('selection') ?? ''),
                attachment?.state === 'available' ? attachment.attachment.revision : null,
              );
              await w.command(
                'Report delivery',
                (c) =>
                  w.client.analysis.p2AnalysisDelivery({
                    body: {
                      email: String(f.get('email') ?? '').trim(),
                      report: { id: report.reportId, version: report.version },
                      offers: false,
                      notices: { report: policy.notices.report },
                      analysis: choice,
                    },
                    command: c,
                  }),
                (r) => setDelivery(r.data),
              );
            }}
          >
            <Field name="email" label="Delivery email" type="email" required />
            <label>
              Delivery content
              <select name="selection" defaultValue="" required>
                <option value="">Choose delivery content</option>
                {attachment?.state === 'available' ? (
                  <option value="artifact">
                    Include installer questions from assistance revision{' '}
                    {attachment.attachment.revision}
                  </option>
                ) : null}
                <option value="declined">Recorded report only - skip assistance</option>
                {state === 'not_requested' ? (
                  <option value="not_requested">
                    Recorded report only - assistance not requested
                  </option>
                ) : null}
                {state === 'unavailable' || !presentation.assistance.available ? (
                  <option value="unavailable">Recorded report only - assistance unavailable</option>
                ) : null}
                {state === 'expired' ? (
                  <option value="expired">Recorded report only - assistance expired</option>
                ) : null}
              </select>
            </label>
            <label>
              <input type="checkbox" name="reportConsent" required />I request this report by email
              under the current report-delivery notice. No offers subscription.
            </label>
            <p>
              Report-purpose notice {policy?.version}: <code>{policy?.notices.report}</code>. Review{' '}
              <a href="/preview/privacy">privacy and purpose details</a>. Production notice review
              remains pending.
            </p>
            <p>
              Only this explicit request schedules delivery. The selected revision and send identity
              are frozen. Email/PDF contains redacted installer questions; personalized explanation
              and citations remain owner-only. Shared links show the deterministic report.
            </p>
          </ActionForm>
          <Receipt
            value={
              delivery
                ? { id: delivery.id, status: delivery.state, revision: delivery.revision }
                : null
            }
          />
          {delivery ? (
            <div className="staff-card">
              <p>
                Original schedule {delivery.sendAfter}. Cancellation deadline{' '}
                {delivery.cancelDeadline}.
              </p>
              <button
                disabled={blocked}
                onClick={() =>
                  void w.read(
                    'Delivery status',
                    () => w.client.delivery.delivery(delivery.id),
                    (v) =>
                      setDelivery({
                        id: v.id,
                        revision: v.revision,
                        state: v.state,
                        sendAfter: v.sendAfter,
                        cancelDeadline: v.cancelDeadline,
                      }),
                  )
                }
              >
                Check delivery status
              </button>
              <button
                disabled={blocked || delivery.state !== 'scheduled'}
                onClick={() =>
                  void w.command(
                    'Cancel delivery',
                    (c) =>
                      w.client.delivery.cancel(
                        delivery.id,
                        { expectedRevision: delivery.revision, reason: 'cancel' },
                        c.csrf,
                        c.key,
                      ),
                    (v) =>
                      setDelivery({
                        id: v.id,
                        revision: v.revision,
                        state: v.state,
                        sendAfter: v.sendAfter,
                        cancelDeadline: v.cancelDeadline,
                      }),
                  )
                }
              >
                Cancel this delivery
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
