import { useState } from 'react';
import {
  createOperationsP2Client,
  type operationsDashboard,
  type operationsReceipt,
  type operationsCapabilities,
  operationsP2Definitions,
} from '../../../../../packages/contracts/src/phase2-operations-client.ts';
import type { z } from '../../../../../packages/contracts/src/phase2-wire.ts';
import {
  Workbench,
  privateTransport,
  ActionForm,
  Field,
  Receipt,
  type Workspace,
} from '../workbench.tsx';
import { OperationsMetrics } from './views.tsx';
import { receiveOperationReceipt, type OperationReceiptState } from './receipt-state.ts';
type Client = {
  api: ReturnType<typeof createOperationsP2Client>;
  capabilities: z.output<typeof operationsCapabilities>;
};
async function connect(bearer: string, signal: AbortSignal) {
  const base = location.origin,
    send = privateTransport(base, bearer, signal, fetch, 'operations'),
    api = createOperationsP2Client(base, send),
    session = (await api.p2OperationsSession({})).data;
  return { client: { api, capabilities: session.capabilities }, csrf: session.csrf };
}
function lastCompletedWeek() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) - 7);
  return d.toISOString().slice(0, 10);
}
function OperationsSpace({ w }: { w: Workspace<Client> }) {
  const [data, setData] = useState<z.output<typeof operationsDashboard> | null>(null),
    [receipts, setReceipts] = useState<OperationReceiptState>(() => ({
      receipt: null,
      held: null,
    })),
    [purpose, setPurpose] = useState<z.output<
      typeof operationsP2Definitions.p2OperationsPurpose.output
    > | null>(null),
    [confirmed, setConfirmed] = useState(false);
  const { receipt, held } = receipts;
  function acceptReceipt(r: z.output<typeof operationsReceipt>) {
    setReceipts((previous) => receiveOperationReceipt(previous, r));
  }
  const capabilities = data?.capabilities ?? w.client.capabilities,
    blocked = w.busy || w.blocked || held !== null;
  return (
    <>
      <nav aria-label="Staff tools">
        <a href="/staff">Privacy, delivery and visitor console</a> ·{' '}
        <a href="/staff/data">CSV and partner moderation</a>
      </nav>
      {held ? (
        <p role="alert" className="p2-warning">
          Operation <code>{held}</code> requires authorized reconciliation. New writes are paused.
          Read the original receipt and use the existing operator tools to resolve its outcome.
          Reading another receipt does not clear this hold. After resolution, disconnect and
          reconnect; no automatic replacement or worker reset is authorized.
        </p>
      ) : null}
      <ActionForm
        title="Read assistance operations"
        disabled={w.busy}
        action={async (f) => {
          const day = String(f.get('day'));
          setData(null);
          setConfirmed(false);
          await w.read(
            'Current operations',
            async () => (await w.client.api.p2OperationsDashboard({ query: { day } })).data,
            setData,
          );
        }}
      >
        <Field
          name="day"
          label="UTC metrics day"
          type="date"
          value={new Date().toISOString().slice(0, 10)}
          required
        />
      </ActionForm>
      {data ? (
        <>
          <p>
            Checked {data.checkedAt}. No raw prompts, images, confirmed field values, recipient
            details or owner identities are included.
          </p>
          <OperationsMetrics value={data} />
          {data.data.ai ? (
            <section className="staff-card">
              <h3>Negative policy control</h3>
              <p>
                Up to 25 current policies.{' '}
                {data.data.ai.policiesTruncated
                  ? 'More policies exist; this list is truncated.'
                  : ''}{' '}
                Disabling prevents future eligible processing; it cannot undo an already handed-off
                provider effect. Re-enabling requires a separately reviewed new policy.
                Deterministic reports and manual entry remain available.
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={blocked || !capabilities.aiControl}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                I intend to disable the exact active policy selected below.
              </label>
              <ul>
                {data.data.ai.policies.map((p) => (
                  <li key={p.id}>
                    <code>{p.id}</code> · {p.task.replaceAll('_', ' ')} · {p.status}{' '}
                    <button
                      disabled={
                        blocked || !capabilities.aiControl || !confirmed || p.status !== 'active'
                      }
                      onClick={() =>
                        void w.command(
                          'Disable exact policy',
                          async (command) =>
                            (
                              await w.client.api.p2OperationsDisable({
                                path: { policy: p.id },
                                body: { fingerprint: p.fingerprint },
                                command,
                              })
                            ).data,
                          (r) => {
                            acceptReceipt(r);
                            setConfirmed(false);
                            setData(null);
                          },
                        )
                      }
                    >
                      Disable {p.id}
                    </button>
                  </li>
                ))}
              </ul>
              <h3>Resume already admitted work once</h3>
              <p>
                The list shows up to 25 most recent persisted requests in the selected UTC day,
                including terminal requests. It is not a complete outstanding-work queue. Choose
                another day or use the existing operator tools for unlisted work. The existing
                worker rechecks permission, sources, budget, current leases and critical validation.
                Failed/uncertain requests are never reset here. A completed invocation is not
                acceptance of its generated output.
              </p>
              <ul>
                {data.data.ai.queue.map((r) => (
                  <li key={r.id}>
                    <code>{r.id}</code> · {r.task.replaceAll('_', ' ')} · {r.state} · expires{' '}
                    {new Date(r.expiresAt).toLocaleString()} · recorded work:{' '}
                    {String(r.recordedWork)}{' '}
                    <button
                      disabled={
                        blocked ||
                        !capabilities.aiControl ||
                        !r.recordedWork ||
                        !['queued', 'running'].includes(r.state) ||
                        Date.parse(r.expiresAt) <= Date.now()
                      }
                      onClick={() =>
                        void w.command(
                          'Resume admitted work',
                          async (command) =>
                            (
                              await w.client.api.p2OperationsResume({
                                path: { request: r.id },
                                body: {},
                                command,
                              })
                            ).data,
                          acceptReceipt,
                        )
                      }
                    >
                      Resume {r.id}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
      <ActionForm
        title="Read my operation receipt"
        disabled={w.busy || !capabilities.aiControl}
        action={async (f) => {
          await w.read(
            'Durable command receipt',
            async () =>
              (
                await w.client.api.p2OperationsReceipt({
                  path: { command: String(f.get('command')) },
                })
              ).data,
            acceptReceipt,
          );
        }}
      >
        <Field name="command" label="Original command reference" required />
        <p>
          Use the original reference after an uncertain outcome. Executing/unknown receipts require
          operator reconciliation; no replacement or blind retry is authorized. After resolving the
          outcome, disconnect and reconnect to clear a held local command.
        </p>
      </ActionForm>
      {receipt ? (
        <section className="staff-card">
          <h3>Durable operation receipt</h3>
          <Receipt value={receipt} />
          <p>
            {receipt.operation} · target <code>{receipt.target}</code> · {receipt.state} · started{' '}
            {new Date(receipt.createdAt).toLocaleString()}
            {receipt.finishedAt
              ? ' · finished ' + new Date(receipt.finishedAt).toLocaleString()
              : ''}
          </p>
        </section>
      ) : null}
      <ActionForm
        title="Purpose-scoped privacy and delivery operations"
        disabled={w.busy}
        action={async (f) => {
          setPurpose(null);
          await w.read(
            'Purpose-scoped operations',
            async () =>
              (
                await w.client.api.p2OperationsPurpose({
                  query: operationsP2Definitions.p2OperationsPurpose.query.parse({
                    kind: f.get('kind'),
                    day: f.get('day'),
                    ...(f.get('week') ? { week: f.get('week') } : {}),
                  }),
                })
              ).data,
            setPurpose,
          );
        }}
      >
        <Field
          name="kind"
          label="Operations purpose"
          options={['privacy', 'mail', 'callbacks', 'visitors', 'pilot']}
          required
        />
        <Field
          name="day"
          label="Visitor UTC day"
          type="date"
          value={new Date().toISOString().slice(0, 10)}
          required
        />
        <Field
          name="week"
          label="Completed UTC week start (Monday)"
          type="date"
          value={lastCompletedWeek()}
        />
        <p>
          Each projection requires its existing independent privacy, mail, pilot-delivery or
          operations role. No recipient or contact reveal, consent change, recovery dispatch or
          publication is available here.
        </p>
      </ActionForm>
      {purpose ? (
        <section className="staff-card">
          <h3>{purpose.kind} projection</h3>
          {purpose.queue ? (
            <>
              <p>Masked current queue, up to 25 entries.</p>
              <ul>
                {purpose.queue.items.map((i) => (
                  <li key={i.id}>
                    <code>{i.id}</code> · {i.state} · {i.dueAt ?? 'no recorded due date'}
                  </li>
                ))}
              </ul>
              {purpose.queue.next ? (
                <button
                  disabled={w.busy}
                  onClick={() =>
                    void w.read(
                      'Next purpose queue',
                      async () =>
                        (
                          await w.client.api.p2OperationsPurpose({
                            query: {
                              kind: purpose.kind,
                              day: new Date().toISOString().slice(0, 10),
                              after: purpose.queue!.next!,
                            },
                          })
                        ).data,
                      setPurpose,
                    )
                  }
                >
                  Next purpose queue
                </button>
              ) : null}
            </>
          ) : null}
          {purpose.pilot ? (
            <>
              <p>
                Completed UTC week {purpose.pilot.week} · {purpose.pilot.grain}. Delivery is an
                independent fact; opens are estimates. Sender-domain attribution is unavailable.
              </p>
              <p>
                Accepted: {purpose.pilot.accepted} · Uncertain: {purpose.pilot.uncertain} ·
                Delivered: {purpose.pilot.delivered} · Bounced: {purpose.pilot.bounced} ·
                Complained: {purpose.pilot.complained}.
              </p>
              <p>
                Opens: {purpose.pilot.suspectedHumanOpens} suspected human,{' '}
                {purpose.pilot.machineOpens} machine, {purpose.pilot.unknownOpens} unknown. Clicks:{' '}
                {purpose.pilot.suspectedHumanClicks} suspected human, {purpose.pilot.machineClicks}{' '}
                machine, {purpose.pilot.unknownClicks} unknown. These counts do not establish sales,
                redemption, fees or ranking.
              </p>
            </>
          ) : null}
          {purpose.visitors ? (
            <>
              <p>
                {purpose.visitors.coverage}. Unknown aggregates are unavailable, rather than zero.
              </p>
              <p>
                Events: {purpose.visitors.events?.value ?? 'unavailable'} · Daily distinct sessions:{' '}
                {purpose.visitors.dailyDistinctSessions?.value ?? 'unavailable'} · dimension{' '}
                {purpose.visitors.dimension} · day {purpose.visitors.day}.
              </p>
              <p>
                Delivery health: {purpose.visitors.health.sendsQueued} queued ·{' '}
                {purpose.visitors.health.sendsUncertain} uncertain. Analytics pending:{' '}
                {purpose.visitors.health.analyticsPending}. Sampled{' '}
                {purpose.visitors.health.sampledAt}; capped:{' '}
                {String(purpose.visitors.health.capped)}.
              </p>
            </>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
export function AnalysisOperationsWorkspace() {
  return (
    <Workbench title="Assistance, photo and privacy operations" connect={connect}>
      {(w) => <OperationsSpace w={w} />}
    </Workbench>
  );
}
