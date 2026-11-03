import { definiteRefusal } from '../command-attempts.ts';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Field } from './controls.tsx';
import { deliveryPrivacyController } from '../delivery-privacy/controller.ts';
import {
  deliveryChoice,
  deliveryPresentation,
  deliveryReference,
  type DeliveryForm,
  type DeliveryReference,
} from '../delivery-privacy/model.ts';
import type { DeliveryChoice, DeliveryReceipt, DeliveryView } from '@tt/contracts/delivery-privacy';
import { resourceId } from '../../../../packages/contracts/src/delivery-privacy-inputs.ts';
type Policy = Awaited<ReturnType<ReturnType<typeof deliveryPrivacyController>['policy']>>;
const empty: DeliveryForm = { email: '', report: false, offers: false };
export function DeliveryScreen() {
  const api = useRef<ReturnType<typeof deliveryPrivacyController> | null>(null),
    working = useRef(false),
    notice = useRef<HTMLDivElement>(null),
    retry = useRef<(() => Promise<void>) | null>(null);
  const [reference, setReference] = useState<DeliveryReference | null>(null),
    [policy, setPolicy] = useState<Policy | null>(null),
    [form, setForm] = useState<DeliveryForm>(empty),
    [receipt, setReceipt] = useState<DeliveryReceipt | null>(null),
    [previous, setPrevious] = useState<DeliveryView | null>(null),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [loading, setLoading] = useState(true),
    [needsRefresh, setNeedsRefresh] = useState(false),
    [restoreId, setRestoreId] = useState<string | null>(null);
  const focus = () => requestAnimationFrame(() => notice.current?.focus());
  async function loadPolicy() {
    setLoading(true);
    try {
      setPolicy(await api.current!.policy());
    } catch {
      setPolicy(null);
      setError('Current notices are unavailable. Reload them before submitting.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    api.current = deliveryPrivacyController(location.origin);
    const ref = deliveryReference(location.search),
      q = new URLSearchParams(location.search),
      send = q.get('send');
    setReference(ref);
    if (q.has('report') && !ref)
      setError('The report reference is invalid. Open a saved version to request it.');
    void loadPolicy();
    if (send) {
      setRestoreId(send);
      if (!resourceId.safeParse(send).success || q.getAll('send').length !== 1)
        setError('The delivery reference is invalid.');
      else
        void api.current
          .status(send)
          .then((view) => setReceipt({ kind: 'delivery', view }))
          .catch(() => {
            setError(
              'This request is unavailable in this browser session. No new delivery was created.',
            );
          });
    }
  }, []);
  async function act(work: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError('');
    retry.current = work;
    try {
      await work();
      retry.current = null;
      setUncertain(false);
    } catch (e) {
      const definite = definiteRefusal(e);
      setUncertain(!definite);
      if (definite) retry.current = null;
      setError(
        definite
          ? 'The service refused this action. No successful change is confirmed. Check the current status or correct the request.'
          : 'The result is unconfirmed. Keep these details and retry the unchanged request; do not create a duplicate.',
      );
    } finally {
      working.current = false;
      setBusy(false);
      focus();
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!policy || busy || uncertain || receipt || restoreId) return;
    const result = deliveryChoice(form, reference, policy.notices);
    if (!result.ok) {
      setErrors(result.errors);
      setError('Review the highlighted fields.');
      focus();
      return;
    }
    setErrors({});
    const request: DeliveryChoice = structuredClone(result.request);
    void act(async () => {
      const saved = await api.current!.submit(request);
      setReceipt(saved);
      setMessage(
        saved.kind === 'delivery'
          ? 'The saved report request is scheduled. Offers are a separate choice; this acknowledgement does not reveal existing email preferences.'
          : 'Offers request acknowledged. Existing subscription state is not disclosed.',
      );
      if (saved.kind === 'delivery') {
        setRestoreId(saved.view.id);
        const q = new URLSearchParams({ send: saved.view.id });
        if (reference) {
          q.set('report', reference.id);
          q.set('version', String(reference.version));
          if (reference.comparisonRevision) q.set('comparison', reference.comparisonRevision);
        }
        history.replaceState(null, '', '/preview/delivery?' + q);
      }
    });
  }
  function cancel(reason: 'cancel' | 'correct_address') {
    if (receipt?.kind !== 'delivery') return;
    const current = structuredClone(receipt.view);
    void act(async () => {
      try {
        const cancelled = await api.current!.cancel(current, reason);
        setNeedsRefresh(false);
        if (reason === 'correct_address') {
          setPrevious(cancelled);
          setReceipt(null);
          setRestoreId(null);
          setForm(empty);
          setMessage(
            'The original report was cancelled and its pending wrong-address permissions invalidated. Enter the corrected address and explicitly choose purposes for a new request.',
          );
          const q = new URLSearchParams();
          if (reference) {
            q.set('report', reference.id);
            q.set('version', String(reference.version));
            if (reference.comparisonRevision) q.set('comparison', reference.comparisonRevision);
          }
          history.replaceState(null, '', '/preview/delivery' + (q.size ? '?' + q : ''));
        } else {
          setReceipt({ kind: 'delivery', view: cancelled });
          setMessage(
            'The report request is cancelled. Separate offers and previously verified preferences are unchanged.',
          );
        }
      } catch (e) {
        if (definiteRefusal(e)) setNeedsRefresh(true);
        throw e;
      }
    });
  }
  async function refresh() {
    if ((receipt?.kind !== 'delivery' && !restoreId) || working.current) return;
    working.current = true;
    setBusy(true);
    try {
      const view = await api.current!.status(
        receipt?.kind === 'delivery' ? receipt.view.id : restoreId!,
      );
      setReceipt({ kind: 'delivery', view });
      setNeedsRefresh(false);
      setMessage('Current server status loaded.');
      setError('');
    } catch {
      setError(
        'Current status is unavailable. The previously observed status does not confirm a new outcome.',
      );
    } finally {
      working.current = false;
      setBusy(false);
      focus();
    }
  }
  const view = receipt?.kind === 'delivery' ? receipt.view : null,
    shown = view ? deliveryPresentation(view) : null,
    locked = busy || uncertain || receipt !== null || restoreId !== null;
  return (
    <>
      <p className="callout info">
        This local preview records synthetic requests only. It does not send email or notifications.
      </p>
      {reference && !restoreId && !receipt ? (
        <p>
          Selected saved report version <strong>{reference.version}</strong>
          {reference.comparisonRevision
            ? ' · comparison revision ' + reference.comparisonRevision
            : ''}
          . Later refinements do not change the requested copy.{' '}
          <a href={'/preview/report?report=' + reference.id + '&version=' + reference.version}>
            Return to this version
          </a>
          .
        </p>
      ) : restoreId ? (
        <p>
          Showing the saved request’s current status. This view does not disclose its recipient or
          report binding.
        </p>
      ) : (
        <p>
          No saved report version is selected. You can request offers separately or{' '}
          <a href="/preview/find-tires">start an assessment</a>.
        </p>
      )}
      <div id="delivery-notices" tabIndex={-1} className="report-section">
        <h2>Choose each purpose separately</h2>
        <p>
          A report request sends the selected saved copy once. Offers are optional and require a
          separate inbox confirmation. Neither choice grants analytics, advertising or identity
          sharing.
        </p>
        <p>
          Review <a href="/preview/privacy">privacy and purpose details</a> before choosing. Only
          the purposes you select are requested.
        </p>
        {loading ? (
          <p role="status">Loading current notices…</p>
        ) : !policy ? (
          <Button tone="secondary" onClick={() => void loadPolicy()}>
            Reload current notices
          </Button>
        ) : (
          <p className="hint">Purpose notices loaded. Production review remains pending.</p>
        )}
      </div>
      {!receipt && !restoreId ? (
        <form onSubmit={submit} noValidate className="report-section">
          <fieldset disabled={locked || !policy}>
            <legend>Optional email request</legend>
            <Field
              id="delivery-email"
              label="Email address"
              type="email"
              autoComplete="email"
              maxLength={254}
              value={form.email}
              required
              error={errors.email}
              hint="Entering an address does not reveal or change its existing preferences."
              onChange={(e) => setForm((v) => ({ ...v, email: e.target.value }))}
            />
            <div id="delivery-purposes" tabIndex={-1}>
              <label className="check-field">
                <input
                  id="delivery-report"
                  type="checkbox"
                  checked={form.report}
                  disabled={!reference}
                  onChange={(e) => setForm((v) => ({ ...v, report: e.target.checked }))}
                />
                <span>
                  Send the selected report once
                  {reference ? ' (version ' + reference.version + ')' : ''}
                </span>
              </label>
              <label className="check-field">
                <input
                  id="delivery-offers"
                  type="checkbox"
                  checked={form.offers}
                  onChange={(e) => setForm((v) => ({ ...v, offers: e.target.checked }))}
                />
                <span>Request tire offers separately (optional, inbox confirmation required)</span>
              </label>
              <p className="hint">
                Offers stay off until confirmed. Requesting a report does not subscribe you to
                offers. Identity sharing stays off.
              </p>
            </div>
            <Button type="submit" busy={busy} disabled={locked || !policy}>
              Record selected request
            </Button>
          </fieldset>
        </form>
      ) : null}
      <div
        ref={notice}
        tabIndex={-1}
        role={error ? 'alert' : 'status'}
        className={error ? 'callout error' : 'saved-message'}
      >
        {error ? <p>{error}</p> : message ? <p>{message}</p> : null}
        {Object.keys(errors).length ? (
          <ul>
            {Object.entries(errors).map(([k, v]) => (
              <li key={k}>
                <a href={'#delivery-' + k}>{v}</a>
              </li>
            ))}
          </ul>
        ) : null}
        {uncertain && retry.current ? (
          <Button tone="secondary" busy={busy} onClick={() => void act(retry.current!)}>
            Retry unchanged request
          </Button>
        ) : null}
      </div>
      {restoreId && !view ? (
        <Button tone="secondary" busy={busy} onClick={() => void refresh()}>
          Reload original request status
        </Button>
      ) : null}
      {previous ? (
        <p className="callout success">
          Original request {previous.id}: cancelled. No corrected request has been created
          automatically.
        </p>
      ) : null}
      {view && shown ? (
        <section className="report-section" aria-labelledby="delivery-status-title">
          <h2 id="delivery-status-title">{shown.title}</h2>
          <p>{shown.detail}</p>
          <p>
            Request reference: <span className="break-text">{view.id}</span>.
          </p>
          <dl>
            <dt>Server cancellation deadline</dt>
            <dd>
              <time dateTime={view.cancelDeadline}>
                {new Date(view.cancelDeadline).toUTCString()}
              </time>
            </dd>
            <dt>Earliest scheduled send</dt>
            <dd>
              <time dateTime={view.sendAfter}>{new Date(view.sendAfter).toUTCString()}</time>
            </dd>
          </dl>
          {shown.deadlinePassed && shown.canCancel ? (
            <p className="callout warning">
              This browser estimates that the deadline has passed. Only the server can decide
              whether cancellation can still succeed.
            </p>
          ) : null}
          <div className="actions">
            {shown.canCancel ? (
              <>
                <Button
                  tone="danger"
                  disabled={busy || uncertain || needsRefresh}
                  onClick={() => cancel('cancel')}
                >
                  Cancel this report request
                </Button>
                <Button
                  tone="secondary"
                  disabled={busy || uncertain || needsRefresh}
                  onClick={() => cancel('correct_address')}
                >
                  Cancel and correct address
                </Button>
              </>
            ) : null}
            <Button tone="secondary" busy={busy} onClick={() => void refresh()}>
              Check current status
            </Button>
          </div>
          <p className="hint">
            Address correction cancels the original request first. It never edits a queued recipient
            or creates a replacement automatically. A report cancellation does not revoke separate
            verified offers preferences.
          </p>
        </section>
      ) : null}
      {receipt?.kind === 'offers' ? (
        <section className="callout info">
          <h2>Offers request recorded</h2>
          <p>
            This acknowledgement does not reveal existing preferences or prove inbox confirmation.
            Use the purpose-specific private link when available to confirm or withdraw. No
            notification is sent by this preview.
          </p>
          <a href="/preview/email-preferences">Open a private preference link</a>
        </section>
      ) : null}
    </>
  );
}
