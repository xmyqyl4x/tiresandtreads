import { useState } from 'react';
import { ActionForm, Field } from '../workbench.tsx';
import { text, optional } from './forms.ts';
import type { PartnerClient, PartnerWorkspace } from './portal.tsx';
type Report = Awaited<ReturnType<PartnerClient['p2Report']>>['data'];
type Disputes = Awaited<ReturnType<PartnerClient['p2Disputes']>>['data'];
export function PilotPanel({ w, org }: { w: PartnerWorkspace; org: string }) {
  const [report, setReport] = useState<Report | null>(null),
    [disputes, setDisputes] = useState<Disputes | null>(null),
    [dispute, setDispute] = useState<{ id: string; revision: number } | null>(null),
    [redemption, setRedemption] = useState<string | null>(null);
  const disabled = w.busy || w.blocked;
  return (
    <>
      <section className="staff-card">
        <h2>Noncharging pilot activity</h2>
        <p>
          Pilot credits are aggregate activity counts. They are not fees, invoices, revenue or proof
          of a sale. Reported redemptions are unverified. Recipient identities and contact details
          are unavailable here.
        </p>
      </section>
      <div className="p2-grid">
        <ActionForm
          title="Read aggregate weekly activity"
          disabled={w.busy}
          submit="Read weekly report"
          action={(f) =>
            w.read(
              'Pilot report',
              () => w.client.p2Report({ path: { org }, query: { week: text(f, 'week') } }),
              (r) => setReport(r.data),
            )
          }
        >
          <Field name="week" label="Week beginning Monday (UTC)" type="date" required />
          <p>Choose a completed UTC week. The current week is not yet available.</p>
        </ActionForm>
        {report ? (
          <section className="staff-card">
            <h2>Weekly pilot report</h2>
            <p>
              {report.state === 'available'
                ? 'Available aggregate release'
                : report.state === 'suppressed'
                  ? 'Suppressed to protect small groups'
                  : 'Unavailable because permissions or source facts changed'}
            </p>
            <dl className="p2-facts">
              <dt>Week</dt>
              <dd>{report.week}</dd>
              <dt>Computed</dt>
              <dd>{report.computedAt}</dd>
              <dt>Grain</dt>
              <dd>{report.grain}</dd>
              <dt>Attribution</dt>
              <dd>{report.attribution}</dd>
              <dt>Clicks</dt>
              <dd>{report.clicks}</dd>
              <dt>Pilot</dt>
              <dd>Noncharging</dd>
            </dl>
            {report.state === 'available' && report.cells ? (
              <div className="p2-table">
                <table>
                  <caption>Aggregate pilot activity · no recipient details</caption>
                  <thead>
                    <tr>
                      <th scope="col">Measure</th>
                      <th scope="col">Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(report.cells).map(([k, v]) => (
                      <tr key={k}>
                        <th scope="row">{k.replaceAll('_', ' ')}</th>
                        <td>{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>No hidden cell or complementary total is inferred from a suppressed report.</p>
            )}
          </section>
        ) : null}
        <ActionForm
          title="Record a reported redemption"
          disabled={disabled}
          action={(f) =>
            w.command(
              'Reported redemption',
              (c) =>
                w.client.p2Redemption({
                  path: { org },
                  body: {
                    assignment: text(f, 'assignment'),
                    kind: text(f, 'kind') as 'reported' | 'correction' | 'reversal',
                    quantity: Number(text(f, 'quantity')),
                    previous: optional(f, 'previous'),
                    occurredAt: new Date(text(f, 'occurredAt') + ':00Z').toISOString(),
                  },
                  command: c,
                }),
              (r) => setRedemption(r.data.event),
            )
          }
        >
          <Field name="assignment" label="Assignment reference" required />
          <Field name="kind" label="Record type" options={['reported', 'correction', 'reversal']} />
          <Field
            name="quantity"
            label="Reported quantity (use signed value for correction/reversal)"
            type="number"
            min="-4"
            max="4"
            value="1"
            required
          />
          <Field
            name="previous"
            label="Prior event reference for correction/reversal"
            value={redemption ?? ''}
          />
          <Field name="occurredAt" label="Occurred at (UTC)" type="datetime-local" required />
          <p>This records a report, never a verified sale or charge.</p>
          {redemption ? (
            <p>
              Latest event: <code>{redemption}</code>
            </p>
          ) : null}
        </ActionForm>
        <ActionForm
          title="Read recent disputes"
          disabled={w.busy}
          submit="Refresh disputes"
          action={() =>
            w.read(
              'Disputes',
              () => w.client.p2Disputes({ path: { org }, query: { limit: 25, after: null } }),
              (r) => setDisputes(r.data),
            )
          }
        >
          <p>Only the current business's bounded dispute records are returned.</p>
        </ActionForm>
        {disputes ? (
          <section className="staff-card p2-table">
            <h2>Recent disputes</h2>
            {disputes.items.length ? (
              <table>
                <thead>
                  <tr>
                    <th scope="col">Reference</th>
                    <th scope="col">Reason</th>
                    <th scope="col">State</th>
                    <th scope="col">Revision</th>
                    <th scope="col">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {disputes.items.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <code>{d.id}</code>
                      </td>
                      <td>{d.reason}</td>
                      <td>{d.state}</td>
                      <td>{d.revision}</td>
                      <td>
                        <button onClick={() => setDispute({ id: d.id, revision: d.revision })}>
                          Use this dispute
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p>No disputes are available.</p>
            )}
          </section>
        ) : null}
        <ActionForm
          key={dispute?.id + ':' + dispute?.revision}
          title="Open a dispute or add evidence"
          disabled={disabled}
          action={(f) => {
            const id = text(f, 'dispute') || crypto.randomUUID();
            return w.command(
              'Dispute',
              (c) =>
                w.client.p2Dispute({
                  path: { org },
                  body: {
                    id,
                    assignment: text(f, 'disputeAssignment'),
                    reason: text(f, 'reason') as
                      'terms' | 'not_honored' | 'redemption' | 'error' | 'other',
                    kind: text(f, 'eventKind') as 'opened' | 'evidence',
                    expected: Number(text(f, 'disputeRevision')),
                    details: text(f, 'details'),
                  },
                  command: c,
                }),
              (r) => setDispute({ id: r.data.id, revision: r.data.revision }),
            );
          }}
        >
          <Field
            name="dispute"
            label="Dispute reference (blank for a new dispute)"
            value={dispute?.id ?? ''}
          />
          <Field name="disputeAssignment" label="Assignment reference" required />
          <Field
            name="reason"
            label="Reason"
            options={['terms', 'not_honored', 'redemption', 'error', 'other']}
          />
          <Field name="eventKind" label="Action" options={['opened', 'evidence']} />
          <Field
            name="disputeRevision"
            label="Current dispute revision (zero for a new dispute)"
            type="number"
            min="0"
            value={String(dispute?.revision ?? 0)}
            required
          />
          <Field
            name="details"
            label="Details (no recipient contact information)"
            type="textarea"
            required
          />
          <p>
            An independent staff reviewer handles resolution. This form cannot waive privacy or
            create a charge.
          </p>
        </ActionForm>
      </div>
    </>
  );
}
