import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { P2Command } from '../../../../packages/contracts/src/phase2-client.ts';
export type Workspace<C> = {
  client: C;
  busy: boolean;
  blocked: boolean;
  read<T>(label: string, work: () => Promise<T>, done: (result: T) => void): Promise<void>;
  command<T>(
    label: string,
    work: (command: P2Command) => Promise<T>,
    done: (result: T) => void,
  ): Promise<void>;
};
export function privateTransport(
  base: string,
  bearer: string,
  signal: AbortSignal,
  send: typeof fetch = fetch,
): typeof fetch {
  return (input, options) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== base || !url.pathname.startsWith('/api/v1/partners/'))
      throw Error('Private transport refused');
    const headers = new Headers(options?.headers);
    headers.set('authorization', 'Bearer ' + bearer);
    return send(base + '/local-p2-api' + url.pathname + url.search, {
      ...options,
      headers,
      signal,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
    });
  };
}
function errorCode(e: unknown) {
  return e && typeof e === 'object' && 'code' in e && typeof e.code === 'string'
    ? e.code
    : e && typeof e === 'object' && 'issues' in e && Array.isArray(e.issues)
      ? 'invalid_input'
      : 'unavailable';
}
export function Workbench<C>({
  title,
  connect,
  children,
}: {
  title: string;
  connect: (credential: string, signal: AbortSignal) => Promise<{ client: C; csrf: string }>;
  children: (workspace: Workspace<C>) => ReactNode;
}) {
  const [credential, setCredential] = useState(''),
    [session, setSession] = useState<{ client: C; csrf: string } | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(
      'Connect with your locally issued credential. Permissions are checked on every request.',
    ),
    [pending, setPending] = useState<{
      label: string;
      key: string;
      retry: () => Promise<void>;
    } | null>(null),
    [reviewed, setReviewed] = useState(false);
  const activeCommand = useRef<{ label: string; key: string } | null>(null);
  const working = useRef(false),
    epoch = useRef(0),
    controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      epoch.current++;
      controller.current?.abort();
    },
    [],
  );
  function disconnect() {
    const unresolved = pending ?? activeCommand.current;
    epoch.current++;
    controller.current?.abort();
    controller.current = null;
    working.current = false;
    setBusy(false);
    setSession(null);
    setCredential('');
    setReviewed(false);
    setMessage(
      unresolved
        ? 'Disconnected. Record command ' +
            unresolved.key +
            ' and reconcile its outcome with an authorized operator before any replacement.'
        : 'Disconnected. Private data and credentials have been cleared.',
    );
    setPending(null);
    activeCommand.current = null;
  }
  async function perform<T>(
    label: string,
    work: () => Promise<T>,
    done: (value: T) => void,
    key?: string,
  ) {
    if (working.current) return;
    working.current = true;
    if (key) activeCommand.current = { label, key };
    setBusy(true);
    const generation = epoch.current;
    try {
      const value = await work();
      if (generation !== epoch.current) return;
      done(value);
      setMessage(label + ' completed.');
      if (key) setPending(null);
      setReviewed(false);
    } catch (e) {
      if (generation !== epoch.current) return;
      const code = errorCode(e);
      if (['unauthorized', 'unauthenticated', 'forbidden', 'not_found'].includes(code)) {
        disconnect();
        setMessage(
          'Access is unavailable. Obtain current authorization before reconnecting.' +
            (key
              ? ' Record command ' +
                key +
                ' for authorized outcome reconciliation before any replacement.'
              : ''),
        );
      } else if (key && !['invalid_input', 'rate_limited'].includes(code)) {
        setPending({ label, key, retry: () => perform(label, work, done, key) });
        setReviewed(false);
        setMessage(
          'Outcome requires reconciliation. Read the current status and give the command reference to an authorized operator. No replacement has been sent.',
        );
      } else
        setMessage('Request could not be completed. Check the entered values and current status.');
    } finally {
      if (generation === epoch.current) {
        working.current = false;
        activeCommand.current = null;
        setBusy(false);
      }
    }
  }
  const read: Workspace<C>['read'] = (label, work, done) => perform(label, work, done);
  const command: Workspace<C>['command'] = async (label, work, done) => {
    if (!session || pending || working.current) return;
    const c = { key: crypto.randomUUID(), csrf: session.csrf };
    await perform(label, () => work(c), done, c.key);
  };
  async function login(e: FormEvent) {
    e.preventDefault();
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(credential)) {
      setMessage('Enter the locally issued credential.');
      return;
    }
    controller.current?.abort();
    controller.current = new AbortController();
    const signal = controller.current.signal;
    await perform(
      'Connection',
      () => connect(credential, signal),
      (value) => {
        setSession(value);
        setCredential('');
      },
    );
  }
  return (
    <main className="staff-shell p2-workbench">
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>
      <header className="p2-heading">
        <a href="/">TIRES &amp; TREAD</a>
        <span>PRIVATE WORKSPACE</span>
      </header>
      <h1>{title}</h1>
      <p className="p2-intro">
        Private local preview. Production access and commercial activation remain pending.
      </p>
      <p role="status" aria-live="polite" className="p2-status">
        {message}
      </p>
      {!session ? (
        <form className="staff-card p2-connect" onSubmit={login}>
          <h2>Connect locally</h2>
          <label>
            Credential
            <input
              type="password"
              autoComplete="off"
              required
              minLength={16}
              maxLength={128}
              value={credential}
              onChange={(e) => setCredential(e.target.value)}
            />
          </label>
          <button disabled={busy}>Connect</button>
          <p>
            Credentials stay in this page's memory. No recipient information is available in this
            portal.
          </p>
        </form>
      ) : (
        <>
          <div className="staff-toolbar">
            <span>Connected · current permissions checked per request</span>
            <button onClick={disconnect}>Disconnect</button>
          </div>
          {pending ? (
            <section className="staff-card p2-warning" aria-label="Command reconciliation">
              <h2>Reconcile {pending.label}</h2>
              <p>
                Command reference: <code>{pending.key}</code>
              </p>
              <p>
                New commands are paused. A current status read and authorized operator review are
                required before retrying this original command. A conflict is never treated as
                success.
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(e) => setReviewed(e.target.checked)}
                />
                I have checked the current status with an authorized operator.
              </label>
              <button disabled={busy || !reviewed} onClick={() => void pending.retry()}>
                Retry original command after reconciliation
              </button>
            </section>
          ) : null}
          <div id="workspace" aria-busy={busy}>
            {children({ client: session.client, busy, blocked: !!pending, read, command })}
          </div>
        </>
      )}
    </main>
  );
}
export function Field({
  name,
  label,
  type = 'text',
  options,
  required = false,
  value,
  min,
  max,
}: {
  name: string;
  label: string;
  type?: string;
  options?: readonly string[];
  required?: boolean;
  value?: string;
  min?: string;
  max?: string;
}) {
  const id = useId();
  return (
    <label htmlFor={id}>
      {label}
      {options ? (
        <select id={id} name={name} defaultValue={value} required={required}>
          {options.map((x) => (
            <option key={x} value={x}>
              {x.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
      ) : type === 'textarea' ? (
        <textarea
          id={id}
          name={name}
          defaultValue={value}
          required={required}
          maxLength={2000}
          rows={3}
        />
      ) : (
        <input
          id={id}
          name={name}
          type={type}
          defaultValue={value}
          required={required}
          min={min}
          max={max}
          maxLength={2048}
          step={type === 'number' ? '1' : undefined}
        />
      )}
    </label>
  );
}
export function ActionForm({
  title,
  action,
  disabled,
  children,
  submit = title,
}: {
  title: string;
  action: (data: FormData) => void | Promise<void>;
  disabled: boolean;
  children: ReactNode;
  submit?: string;
}) {
  const [error, setError] = useState('');
  return (
    <form
      className="staff-card p2-form"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setError('');
        void Promise.resolve()
          .then(() => action(data))
          .catch(() => {
            setError('Check the form values. No completion has been confirmed.');
          });
      }}
    >
      {error ? <p role="alert">{error}</p> : null}
      <fieldset disabled={disabled}>
        <legend>{title}</legend>
        <div className="staff-fields">{children}</div>
        <button>{submit}</button>
      </fieldset>
    </form>
  );
}
export function Receipt({
  value,
}: {
  value: {
    id?: string | undefined;
    status?: string | undefined;
    revision?: string | undefined;
    value?: string | number | boolean | null | undefined;
  } | null;
}) {
  return value ? (
    <dl className="p2-facts">
      {value.id ? (
        <>
          <dt>Reference</dt>
          <dd>
            <code>{value.id}</code>
          </dd>
        </>
      ) : null}
      {value.status ? (
        <>
          <dt>Status</dt>
          <dd>{value.status}</dd>
        </>
      ) : null}
      {value.revision ? (
        <>
          <dt>Revision</dt>
          <dd>{value.revision}</dd>
        </>
      ) : null}
    </dl>
  ) : null;
}
