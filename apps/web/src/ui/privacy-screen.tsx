import { useId, useRef, useState, type FormEvent } from 'react';
import { deliveryPrivacyController } from '../delivery-privacy/controller.ts';
import { rightsBody, proofLink, emailError } from '../delivery-privacy/model.ts';
import { Button, Field } from './controls.tsx';
import { PrivacyChoices } from './privacy-choices.tsx';
import { PrivateProofLink } from './private-proof-link.tsx';
import { definiteRefusal } from '../command-attempts.ts';
const kinds = [
  ['access', 'Access my data'],
  ['export', 'Request an export'],
  ['correct', 'Request a correction'],
  ['restrict', 'Restrict processing'],
  ['opt_out', 'Opt out of processing'],
  ['delete', 'Request deletion'],
] as const;
function RightsForm({ email }: { email: boolean }) {
  const id = useId(),
    api = useRef<ReturnType<typeof deliveryPrivacyController> | null>(null),
    working = useRef(false),
    notice = useRef<HTMLDivElement>(null),
    retry = useRef<(() => Promise<void>) | null>(null);
  const [kind, setKind] = useState(''),
    [jurisdiction, setJurisdiction] = useState(''),
    [address, setAddress] = useState(''),
    [acknowledged, setAcknowledged] = useState(false),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [accepted, setAccepted] = useState(false),
    [link, setLink] = useState(''),
    [error, setError] = useState(''),
    [errors, setErrors] = useState<Record<string, string>>({});
  const restrictive = ['delete', 'restrict', 'opt_out'].includes(kind),
    locked = busy || accepted || uncertain;
  async function run(work: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError('');
    retry.current = work;
    try {
      await work();
      setAccepted(true);
      setUncertain(false);
      retry.current = null;
    } catch (e) {
      const definite = definiteRefusal(e);
      setUncertain(!definite);
      if (definite) retry.current = null;
      setError(
        definite
          ? 'The request was refused. Review its details; no successful request is confirmed.'
          : email
            ? 'The result is unconfirmed. Do not submit another request to duplicate verification work. Use a private status link if one is already available.'
            : 'The result is unconfirmed. Retry the unchanged request to recover its original private status link.',
      );
    } finally {
      working.current = false;
      setBusy(false);
      requestAnimationFrame(() => notice.current?.focus());
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (locked) return;
    const result = rightsBody({ kind, jurisdiction, acknowledged }),
      next: Record<string, string> = result.ok ? {} : { ...result.errors };
    if (email && emailError(address)) next.email = emailError(address);
    setErrors(next);
    if (!result.ok || Object.keys(next).length) {
      setError('Review the highlighted fields.');
      requestAnimationFrame(() => notice.current?.focus());
      return;
    }
    api.current ??= deliveryPrivacyController(location.origin);
    const input = structuredClone(result.input),
      destination = address.trim();
    void run(async () => {
      if (email) await api.current!.emailRights({ ...input, email: destination });
      else {
        const saved = await api.current!.ownerRights(input);
        setLink(proofLink(location.origin, 'privacy', saved.proof));
      }
    });
  }
  return (
    <section className="report-section" aria-labelledby={id + '-title'}>
      <h2 id={id + '-title'}>
        {email ? 'Request rights for an email address' : 'Request rights for this browser’s data'}
      </h2>
      <p>
        {email
          ? 'You do not need an account. Existing data or preferences are never revealed by entering an address. Inbox verification is required before acting on its data.'
          : 'No account is required. This request covers data associated with this browser; recording it does not mean fulfillment is complete.'}
      </p>
      <form onSubmit={submit} noValidate>
        <fieldset disabled={locked}>
          <legend>Privacy request details</legend>
          {email ? (
            <Field
              id={id + '-email'}
              label="Email address for inbox proof"
              type="email"
              autoComplete="email"
              maxLength={254}
              value={address}
              error={errors.email}
              required
              onChange={(e) => setAddress(e.target.value)}
            />
          ) : null}
          <div className="field">
            <label htmlFor={id + '-kind'}>Request type</label>
            <select
              id={id + '-kind'}
              value={kind}
              aria-invalid={!!errors.kind}
              onChange={(e) => {
                setKind(e.target.value);
                setAcknowledged(false);
              }}
            >
              <option value="">Choose a request type</option>
              {kinds.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            {errors.kind ? <p className="field-error">{errors.kind}</p> : null}
          </div>
          <Field
            id={id + '-jurisdiction'}
            label="Privacy country or region code"
            maxLength={100}
            value={jurisdiction}
            required
            error={errors.jurisdiction}
            hint="Use your privacy region, not the tire market. The service must have a reviewed policy for this region."
            onChange={(e) => setJurisdiction(e.target.value)}
          />
          {restrictive ? (
            <label className="check-field">
              <input
                id={id + '-acknowledged'}
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />
              <span>
                I understand this request can restrict processing or begin deletion after authority
                is verified. Completion still requires the rights workflow.
              </span>
            </label>
          ) : null}
          <Button type="submit" busy={busy} disabled={locked}>
            Record {email ? 'email' : 'browser'} privacy request
          </Button>
        </fieldset>
      </form>
      <div ref={notice} tabIndex={-1} role={error ? 'alert' : 'status'}>
        {error ? <p className="callout error">{error}</p> : null}
        {Object.keys(errors).length ? (
          <ul>
            {Object.entries(errors).map(([k, v]) => (
              <li key={k}>
                <a href={'#' + id + '-' + k}>{v}</a>
              </li>
            ))}
          </ul>
        ) : null}
        {uncertain && !email && retry.current ? (
          <Button tone="secondary" busy={busy} onClick={() => void run(retry.current!)}>
            Retry unchanged privacy request
          </Button>
        ) : null}
        {accepted ? (
          <p className="callout success">
            {email
              ? 'Request acknowledged. This does not reveal whether data exists. Inbox proof is required; this local preview sends no notification.'
              : 'Your request was recorded. Open the private status link to see the server’s current state and due date. No completion is promised until the workflow records it.'}
          </p>
        ) : null}
      </div>
      {link ? <PrivateProofLink link={link} /> : null}
    </section>
  );
}
export function PrivacyScreen() {
  return (
    <>
      <section className="report-section">
        <h2>Separate choices, separate purposes</h2>
        <p>
          Requesting a report does not subscribe you to offers. Offers need their own inbox
          confirmation. Browser analytics, advertising and targeted advertising are independent
          optional choices. Identity sharing stays off.
        </p>
        <p>
          Global Privacy Control blocks targeted advertising. It does not subscribe you to email or
          override separate report choices. No advertising or analytics service is loaded in this
          local preview.
        </p>
        <PrivacyChoices />
      </section>
      <section className="report-section">
        <h2>Manage a private email link</h2>
        <p>
          Opening a link only reads its current state. Confirmation and withdrawal happen only after
          an explicit button press, without an account.
        </p>
        <div className="actions">
          <a href="/preview/email-confirmation">Confirm a purpose-specific email request</a>
          <a href="/preview/email-preferences">Review or withdraw an email purpose</a>
          <a href="/preview/privacy-request">Check a private rights request</a>
        </div>
      </section>
      <RightsForm email={false} />
      <RightsForm email />
      <p className="hint">
        This is a local technical preview. Actual legal policy, specialist, provider and
        live-release acceptance remain pending. Access, export and correction requests may need
        operator fulfillment; this page does not claim to finish them automatically.
      </p>
    </>
  );
}
