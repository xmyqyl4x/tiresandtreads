import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  createDeliveryPrivacyClient,
  type ConfirmationView,
  type EmailPreferenceView,
  type PrivacyStatusView,
} from '@tt/contracts/delivery-privacy';
import { privateProof, proofPaths } from '../delivery-privacy/model.ts';
import { Button, Field } from './controls.tsx';
import { definiteRefusal } from '../command-attempts.ts';
type Kind = keyof typeof proofPaths;
export function PrivatePreferencesScreen({ kind }: { kind: Kind }) {
  const [token, setToken] = useState<string | null>(null),
    [ready, setReady] = useState(false),
    [raw, setRaw] = useState(''),
    [error, setError] = useState('');
  useEffect(() => {
    const changed = () => {
      const found = privateProof(location.hash, kind, location.origin);
      setToken(found);
      setReady(true);
      setError(
        location.hash && !found ? 'This private link is unavailable or has the wrong purpose.' : '',
      );
    };
    changed();
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, [kind]);
  function open(event: FormEvent) {
    event.preventDefault();
    const found = privateProof(raw, kind, location.origin);
    if (!found) {
      setError('Use the purpose-specific private link for this site.');
      return;
    }
    history.replaceState(null, '', proofPaths[kind] + '#' + found);
    setToken(found);
    setError('');
    setRaw('');
  }
  if (!ready) return <p role="status">Loading private link…</p>;
  return (
    <>
      <p className="callout info">
        This page requires no account. Opening it only reads state; it does not confirm, withdraw or
        fulfill a request.
      </p>
      {error ? (
        <p role="alert" className="callout error">
          {error}
        </p>
      ) : null}
      {token ? (
        <PrivateState key={kind + ':' + token} kind={kind} token={token} />
      ) : (
        <form onSubmit={open} className="report-section">
          <Field
            id="private-link-input"
            label="Purpose-specific private link or proof"
            type="password"
            autoComplete="off"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            required
            hint="Keep this private. It can authorize a purpose change or show private request status."
          />
          <Button type="submit">Open private link</Button>
        </form>
      )}
    </>
  );
}
function PrivateState({ kind, token }: { kind: Kind; token: string }) {
  const client = useRef<ReturnType<typeof createDeliveryPrivacyClient> | null>(null),
    active = useRef(true),
    working = useRef(false),
    notice = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<
      ConfirmationView | EmailPreferenceView | PrivacyStatusView | null
    >(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [acknowledged, setAcknowledged] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  async function read() {
    setLoading(true);
    try {
      client.current ??= createDeliveryPrivacyClient(location.origin);
      const result =
        kind === 'verify'
          ? await client.current.confirmation(token)
          : kind === 'unsubscribe'
            ? await client.current.preferences(token)
            : await client.current.privacyStatus(token);
      if (active.current) {
        setView(result);
        setError('');
        setUncertain(false);
      }
    } catch {
      if (active.current) {
        setView(null);
        setError(
          'This private view is unavailable, expired or no longer authorized. No action is confirmed by opening it.',
        );
      }
    } finally {
      if (active.current) setLoading(false);
    }
  }
  useEffect(() => {
    active.current = true;
    void read();
    return () => {
      active.current = false;
    };
  }, []);
  async function act() {
    if (working.current || !view || loading || uncertain) return;
    working.current = true;
    setBusy(true);
    setError('');
    try {
      if (kind === 'verify') await client.current!.confirmEmail(token);
      else if (kind === 'unsubscribe') await client.current!.withdraw(token);
      else await client.current!.confirmPrivacy(token);
      if (active.current) {
        setAcknowledged(true);
        setMessage(
          kind === 'verify'
            ? 'The selected email purpose was confirmed. Other purposes are unchanged.'
            : kind === 'unsubscribe'
              ? 'The selected email purpose was withdrawn. Other purposes and an independently requested report are unchanged.'
              : 'Inbox proof was verified. This does not mean the rights request has been fulfilled.',
        );
      }
      await read();
    } catch (e) {
      if (active.current) {
        setUncertain(!definiteRefusal(e));
        setError(
          'The action is not confirmed. Refresh current state before deciding whether to try again. Do not assume confirmation, withdrawal or completion.',
        );
      }
    } finally {
      working.current = false;
      if (active.current) {
        setBusy(false);
        requestAnimationFrame(() => notice.current?.focus());
      }
    }
  }
  const isPrivacy = kind === 'privacy',
    expired = !!view && 'expired' in view && view.expired;
  const allowed =
    !!view &&
    !acknowledged &&
    !uncertain &&
    !loading &&
    (kind === 'verify'
      ? !expired &&
        view.status !== 'confirmed' &&
        view.status !== 'withdrawn' &&
        view.status !== 'expired'
      : kind === 'unsubscribe'
        ? view.status !== 'withdrawn'
        : view.status === 'pending');
  return (
    <section className="report-section">
      <h2>
        {isPrivacy
          ? 'Private rights request status'
          : kind === 'verify'
            ? 'Confirm one email purpose'
            : 'Current email purpose preferences'}
      </h2>
      {loading ? <p role="status">Reading current server state…</p> : null}
      {view ? (
        <>
          <dl>
            {'purpose' in view ? (
              <>
                <dt>Purpose covered by this private link</dt>
                <dd>{view.purpose === 'offers' ? 'Offers email' : 'One requested report'}</dd>
              </>
            ) : (
              <>
                <dt>Request reference</dt>
                <dd className="break-text">{view.id}</dd>
                <dt>Request type</dt>
                <dd>{view.kind.replaceAll('_', ' ')}</dd>
              </>
            )}
            <dt>Last observed server status</dt>
            <dd>{view.status.replaceAll('_', ' ')}</dd>
            {'dueAt' in view ? (
              <>
                <dt>Server due date</dt>
                <dd>
                  <time dateTime={view.dueAt}>{new Date(view.dueAt).toUTCString()}</time>
                </dd>
                {view.completedAt ? (
                  <>
                    <dt>Recorded completion</dt>
                    <dd>
                      <time dateTime={view.completedAt}>
                        {new Date(view.completedAt).toUTCString()}
                      </time>
                    </dd>
                  </>
                ) : null}
              </>
            ) : null}
            {'expiresAt' in view ? (
              <>
                <dt>Confirmation expiry</dt>
                <dd>
                  <time dateTime={view.expiresAt}>{new Date(view.expiresAt).toUTCString()}</time>
                </dd>
              </>
            ) : null}
          </dl>
          {expired ? (
            <p className="callout warning">
              This confirmation has expired. It cannot grant a purpose.
            </p>
          ) : null}
        </>
      ) : null}
      <div ref={notice} tabIndex={-1} role={error ? 'alert' : 'status'}>
        {error ? <p className="callout error">{error}</p> : null}
        {message ? <p className="callout success">{message}</p> : null}
      </div>
      <div className="actions">
        {allowed ? (
          <Button
            tone={kind === 'unsubscribe' ? 'danger' : 'primary'}
            busy={busy}
            onClick={() => void act()}
          >
            {kind === 'verify'
              ? 'Confirm this email purpose'
              : kind === 'unsubscribe'
                ? 'Withdraw this email purpose'
                : 'Verify inbox proof for this request'}
          </Button>
        ) : null}
        <Button tone="secondary" disabled={busy || loading} onClick={() => void read()}>
          Refresh current state
        </Button>
      </div>
      <p className="hint">
        Email verification grants only the stated purpose. Withdrawal is not a blanket consent
        change. Rights status is recorded by the server; a pending or verified request is not
        completed fulfillment.
      </p>
      <a href="/preview/privacy">Back to privacy controls</a>
    </section>
  );
}
