import { useRef, useState, type FormEvent } from 'react';
import { createStaffConsoleClient } from '../../../../packages/contracts/src/staff-console-client.ts';
import { staffCommandFailure as failure } from '../../../../packages/contracts/src/staff-command.ts';
import { staffInputSchemas } from '../../../../packages/contracts/src/staff-inputs.ts';
import { commercialPolicySchema } from '../../../../packages/contracts/src/staff-console.ts';
import type {
  QueueView,
  ReportQueueView,
  SourceHealthView,
  StrategicRegisterView,
  SeoFindingsView,
  OperationsView,
  RevenueView,
  CommercialConfigurationView,
} from '../../../../packages/contracts/src/staff-console.ts';
import {
  QueueTable,
  SourceView,
  StrategyView,
  FindingsView,
  OperationsViewPanel,
  RevenueViewPanel,
  ConfigurationSummary,
} from './views.tsx';
const panels = [
  'Reports',
  'Sends',
  'Callbacks',
  'Privacy',
  'Imports',
  'Sources',
  'SEO register',
  'SEO findings',
  'Analytics',
  'Ad revenue',
  'Configuration',
] as const;
type Panel = (typeof panels)[number];
type Data =
  | { kind: 'queue'; value: QueueView | ReportQueueView }
  | { kind: 'sources'; value: SourceHealthView }
  | { kind: 'strategy'; value: StrategicRegisterView }
  | { kind: 'findings'; value: SeoFindingsView }
  | { kind: 'operations'; value: OperationsView }
  | { kind: 'revenue'; value: RevenueView }
  | { kind: 'configuration'; value: CommercialConfigurationView };
type Client = ReturnType<typeof createStaffConsoleClient>;
type Pending = (
  | { kind: 'recover'; input: Parameters<Client['recover']>[0]; key: string }
  | { kind: 'publish'; input: Parameters<Client['publish']>[0]; key: string; reviewer: string }
) & { uncertain?: true };
export function StaffConsole() {
  const [credential, setCredential] = useState(''),
    [session, setSession] = useState<{ bearer: string; csrf: string; staffId: string } | null>(
      null,
    ),
    [panel, setPanel] = useState<Panel>('Reports'),
    [data, setData] = useState<Data | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(
      'Connect with a locally issued staff credential and recent MFA.',
    ),
    [pending, setPending] = useState<Pending | null>(null),
    [day, setDay] = useState(() => new Date().toISOString().slice(0, 10)),
    [account, setAccount] = useState(''),
    [dimension, setDimension] = useState('all'),
    [currency, setCurrency] = useState('USD');
  const [target, setTarget] = useState(''),
    [evidence, setEvidence] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [policy, setPolicy] = useState(''),
    [reviewer, setReviewer] = useState(''),
    [preview, setPreview] = useState<{ version: number; policy: unknown } | null>(null);
  const working = useRef(false),
    epoch = useRef(0),
    abort = useRef<AbortController | null>(null);
  const client = (s: { bearer: string; csrf: string }) =>
    createStaffConsoleClient(window.location.origin, s, async (input, options) => {
      const u = new URL(input instanceof Request ? input.url : String(input));
      if (u.origin !== window.location.origin || !u.pathname.startsWith('/api/v1/staff'))
        throw Error('Invalid staff transport');
      return fetch('/local-staff-api' + u.pathname + u.search, {
        ...options,
        credentials: 'omit',
        signal: abort.current?.signal ?? null,
      });
    });
  async function work(fn: (valid: () => boolean) => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    const generation = epoch.current;
    abort.current = new AbortController();
    try {
      await fn(() => epoch.current === generation);
    } catch (error) {
      if (epoch.current === generation) {
        const f = failure(error);
        if (['unauthenticated', 'forbidden', 'not_found'].includes(f.code)) setData(null);
        setMessage(
          f.code === 'unauthenticated'
            ? 'Staff session expired. Disconnect and obtain a fresh local credential.'
            : f.code === 'forbidden' || f.code === 'not_found'
              ? 'Authorization is unavailable. Obtain fresh MFA or verify the required staff role.'
              : f.uncertain
                ? 'The result is unavailable or uncertain. Retry an unchanged command; do not create a replacement.'
                : 'Request refused: ' + f.code,
        );
      }
    } finally {
      if (epoch.current === generation) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  function disconnect() {
    epoch.current++;
    abort.current?.abort();
    abort.current = null;
    working.current = false;
    setBusy(false);
    setSession(null);
    setCredential('');
    setReviewer('');
    setPending(null);
    setData(null);
    setPreview(null);
    setPolicy('');
    setTarget('');
    setEvidence('');
    setConfirmed(false);
    setMessage(
      'Disconnected. Credentials cleared. Any unresolved command must be reconciled from its audit before a replacement is considered.',
    );
  }
  async function connect(event: FormEvent) {
    event.preventDefault();
    await work(async (valid) => {
      const token = credential;
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw { code: 'invalid_input', retryable: false };
      const value = await client({ bearer: token, csrf: '' }).session();
      if (session && session.staffId !== value.staffId)
        throw { code: 'forbidden', retryable: false };
      if (valid()) {
        setSession({ bearer: token, csrf: value.csrf, staffId: value.staffId });
        setCredential('');
        setMessage('Connected locally. Each view and action checks current database permissions.');
      }
    });
  }
  async function load(nextPanel = panel, after?: string) {
    if (!session) return;
    setData(null);
    setPreview(null);
    setPolicy('');
    if (nextPanel === 'Ad revenue' && !account.trim()) {
      setMessage(
        'No ad network account selected. Revenue remains unavailable until a reviewed connection and report exist. Enter an account reference to inspect its status.',
      );
      return;
    }
    await work(async (valid) => {
      const c = client(session);
      let result: Data;
      if (nextPanel === 'Reports') result = { kind: 'queue', value: await c.reports(after) };
      else if (['Sends', 'Callbacks', 'Privacy', 'Imports'].includes(nextPanel))
        result = {
          kind: 'queue',
          value: await c.queue(
            nextPanel === 'Sends'
              ? 'mail'
              : nextPanel === 'Callbacks'
                ? 'callbacks'
                : nextPanel === 'Privacy'
                  ? 'privacy'
                  : 'imports',
            after,
          ),
        };
      else if (nextPanel === 'Sources') result = { kind: 'sources', value: await c.sources(after) };
      else if (nextPanel === 'SEO register')
        result = { kind: 'strategy', value: await c.strategy(after) };
      else if (nextPanel === 'SEO findings')
        result = { kind: 'findings', value: await c.findings(after) };
      else if (nextPanel === 'Analytics')
        result = { kind: 'operations', value: await c.operations({ day, dimension }) };
      else if (nextPanel === 'Ad revenue')
        result = { kind: 'revenue', value: await c.revenue({ day, account, dimension, currency }) };
      else result = { kind: 'configuration', value: await c.configuration() };
      if (valid()) {
        setData(result);
        setMessage('Current masked result loaded.');
        if (result.kind === 'configuration') {
          setPolicy(
            result.value.policy
              ? JSON.stringify(result.value.policy, null, 2)
              : JSON.stringify(
                  {
                    schemaVersion: 1,
                    issuedAt: new Date().toISOString(),
                    expiresAt: new Date(Date.now() + 3600000).toISOString(),
                    accountId: null,
                    adsTxt: [],
                    blockedCategories: [],
                    blockedUrls: [],
                    slots: [],
                  },
                  null,
                  2,
                ),
          );
        }
      }
    });
  }
  async function send(input: Pending) {
    if (!session || working.current) return;
    const command = structuredClone(input);
    setPending(command);
    await work(async (valid) => {
      try {
        const c = client(session);
        const receipt =
          command.kind === 'recover'
            ? await c.recover(command.input, command.key)
            : await c.publish(command.input, command.key, command.reviewer);
        if (!valid()) return;
        if ('state' in receipt && ['unknown', 'executing'].includes(receipt.state)) {
          setPending({ ...command, uncertain: true });
          setMessage(
            'Recovery has a recorded unresolved outcome. Reconcile its original audit; do not create a replacement command.',
          );
          return;
        }
        setPending(null);
        setConfirmed(false);
        setReviewer('');
        setPreview(null);
        setMessage(
          command.kind === 'recover'
            ? 'Recovery command recorded: ' +
                ('state' in receipt ? receipt.state : 'unavailable') +
                '. Review the queue before another action.'
            : 'Policy version ' +
                ('version' in receipt ? receipt.version : 'unavailable') +
                ' recorded. External advertising remains held.',
        );
      } catch (error) {
        if (valid()) {
          if (failure(error, command.uncertain).preserveCommand)
            setPending({ ...command, uncertain: true });
          else {
            setPending(null);
            setReviewer('');
            setPreview(null);
            setConfirmed(false);
          }
        }
        throw error;
      }
    });
  }
  const recovery =
    panel === 'Sends'
      ? 'mail_reconcile'
      : panel === 'Callbacks'
        ? 'callback_replay'
        : panel === 'Privacy'
          ? 'privacy_retry'
          : null;
  async function validatePreview() {
    let raw: unknown;
    try {
      raw = JSON.parse(policy);
    } catch {
      setMessage('Policy JSON is invalid. Correct it before requesting a preview.');
      return;
    }
    const parsed = commercialPolicySchema.safeParse(raw);
    if (!parsed.success) {
      setMessage('Policy fields are invalid. Correct them before requesting a preview.');
      return;
    }
    if (!session) return;
    await work(async (valid) => {
      const p = await client(session).preview(parsed.data, crypto.randomUUID());
      if (valid()) {
        setPreview({ version: p.version, policy: p.policy });
        setMessage(
          'Preview validated at version ' +
            p.version +
            '. Publication still requires a distinct reviewer.',
        );
      }
    });
  }
  const nextCursor = data && 'next' in data.value ? data.value.next : null;
  return (
    <div className="staff-shell">
      <a className="skip-link" href="#staff-main">
        Skip to staff workspace
      </a>
      <header className="staff-top">
        <a href="/">TIRES &amp; TREAD</a>
        <span>LOCAL STAFF WORKSPACE</span>
        <strong>Activation held</strong>
      </header>
      <main id="staff-main" tabIndex={-1}>
        <h1>Operations, with clear authority</h1>
        <p>
          Masked records, explicit missing data and audited service actions. No live providers or
          recipient notifications.
        </p>
        <p role="status" aria-live="polite" className="notice">
          {message}
        </p>
        {!session ? (
          <form onSubmit={connect} className="staff-card">
            <h2>Connect locally</h2>
            <label>
              Staff credential
              <input
                type="password"
                autoComplete="off"
                value={credential}
                onChange={(e) => setCredential(e.target.value)}
                required
                maxLength={43}
              />
            </label>
            <button disabled={busy}>Connect</button>
            <p>
              Credentials stay in this page's memory. Recent MFA and current staff permissions are
              checked by the server.
            </p>
          </form>
        ) : (
          <>
            <div className="staff-toolbar">
              <span>Local session · current roles checked per request</span>
              <button onClick={disconnect}>Disconnect</button>
            </div>
            <details className="staff-card">
              <summary>Renew the same staff session</summary>
              <form onSubmit={connect}>
                <label>
                  Fresh staff credential
                  <input
                    type="password"
                    autoComplete="off"
                    value={credential}
                    onChange={(e) => setCredential(e.target.value)}
                    required
                    maxLength={43}
                  />
                </label>
                <button disabled={busy}>Renew same staff session</button>
                <p>
                  Obtain recent MFA through the existing local issuer. Renewal must identify the
                  same staff member and preserves any unresolved command.
                </p>
              </form>
            </details>
            <nav aria-label="Staff views" className="staff-tabs">
              {panels.map((p) => (
                <button
                  key={p}
                  aria-current={panel === p ? 'page' : undefined}
                  disabled={busy || !!pending}
                  onClick={() => {
                    setPanel(p);
                    setConfirmed(false);
                    void load(p);
                  }}
                >
                  {p}
                </button>
              ))}
            </nav>
            <section className="staff-card" aria-busy={busy}>
              <h2>{panel}</h2>
              {(panel === 'Analytics' || panel === 'Ad revenue') && (
                <div className="staff-fields">
                  <label>
                    Day
                    <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
                  </label>
                  <label>
                    Dimension
                    <input
                      value={dimension}
                      onChange={(e) => setDimension(e.target.value)}
                      maxLength={60}
                    />
                  </label>
                  {panel === 'Ad revenue' && (
                    <>
                      <label>
                        Account reference
                        <input
                          value={account}
                          onChange={(e) => setAccount(e.target.value)}
                          maxLength={36}
                        />
                      </label>
                      <label>
                        Currency
                        <input
                          value={currency}
                          onChange={(e) => setCurrency(e.target.value)}
                          maxLength={3}
                        />
                      </label>
                    </>
                  )}
                </div>
              )}
              <button disabled={busy || !!pending} onClick={() => void load()}>
                Load current view
              </button>
              {data?.kind === 'queue' && <QueueTable value={data.value} />}{' '}
              {data?.kind === 'sources' && <SourceView value={data.value} />}{' '}
              {data?.kind === 'strategy' && <StrategyView value={data.value} />}{' '}
              {data?.kind === 'findings' && <FindingsView value={data.value} />}{' '}
              {data?.kind === 'operations' && <OperationsViewPanel value={data.value} />}{' '}
              {data?.kind === 'revenue' && <RevenueViewPanel value={data.value} />}{' '}
              {data?.kind === 'configuration' && <ConfigurationSummary value={data.value} />}{' '}
              {nextCursor && (
                <button disabled={busy || !!pending} onClick={() => void load(panel, nextCursor)}>
                  Next page
                </button>
              )}
              {recovery && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!confirmed) return;
                    const input = staffInputSchemas.recoverOperation.safeParse({
                      kind: recovery,
                      target,
                      evidence,
                    });
                    if (!input.success) {
                      setMessage(
                        'Recovery reference or evidence digest is invalid. No command was dispatched.',
                      );
                      return;
                    }
                    void send({
                      kind: 'recover',
                      key: crypto.randomUUID(),
                      input: input.data,
                    });
                  }}
                >
                  <h3>Reviewed recovery</h3>
                  <p>
                    Uses the existing recovery service. Uncertain sends are reconciled, never
                    force-sent. Evidence is a SHA-256 reference, not customer details.
                  </p>
                  <fieldset disabled={busy || !!pending}>
                    <label>
                      Target reference
                      <input
                        value={target}
                        onChange={(e) => setTarget(e.target.value)}
                        required
                        pattern="[0-9a-fA-F-]{36}"
                        maxLength={36}
                      />
                    </label>
                    <label>
                      Evidence digest
                      <input
                        value={evidence}
                        onChange={(e) => setEvidence(e.target.value)}
                        required
                        pattern="[a-f0-9]{64}"
                        maxLength={64}
                      />
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={confirmed}
                        onChange={(e) => setConfirmed(e.target.checked)}
                      />
                      I reviewed the target, evidence and permitted recovery.
                    </label>
                    <button disabled={!confirmed}>Record recovery</button>
                  </fieldset>
                </form>
              )}
              {panel === 'Imports' && (
                <p>
                  Import preparation, validation, approval, publication and rollback remain in the
                  script-first ingestion services. This console does not accept uploads or override
                  their gates.
                </p>
              )}
              {data?.kind === 'configuration' && (
                <>
                  <h3>Reviewed configuration</h3>
                  <p>
                    Preview a bounded policy, then provide a distinct currently authorized reviewer
                    credential. Publication records a versioned audit. A conflict requires loading
                    the current policy and a fresh review; it does not confirm a lost
                    acknowledgement.
                  </p>
                  <fieldset disabled={busy || !!pending}>
                    <label>
                      Policy JSON
                      <textarea
                        rows={14}
                        value={policy}
                        onChange={(e) => {
                          setPolicy(e.target.value);
                          setPreview(null);
                          setConfirmed(false);
                        }}
                        maxLength={65536}
                      />
                    </label>
                    <button onClick={() => void validatePreview()}>Validate preview</button>
                    <label>
                      Reviewer credential
                      <input
                        type="password"
                        autoComplete="off"
                        value={reviewer}
                        onChange={(e) => setReviewer(e.target.value)}
                        maxLength={43}
                      />
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={confirmed}
                        onChange={(e) => setConfirmed(e.target.checked)}
                      />
                      The reviewer approved this exact policy and current version.
                    </label>
                    <button
                      disabled={!preview || !confirmed || !/^[A-Za-z0-9_-]{43}$/.test(reviewer)}
                      onClick={() => {
                        if (preview)
                          void send({
                            kind: 'publish',
                            key: crypto.randomUUID(),
                            reviewer,
                            input: { expectedVersion: preview.version, policy: preview.policy },
                          });
                      }}
                    >
                      Publish reviewed policy
                    </button>
                  </fieldset>
                </>
              )}
              {pending && (
                <div className="notice">
                  <p>A command is awaiting a definite receipt. Its inputs and key are frozen.</p>
                  <p>
                    Reference: <code>{pending.key}</code>. A later permission refusal or version
                    conflict does not resolve an earlier unknown outcome.
                  </p>
                  {pending.kind === 'publish' && (
                    <>
                      <label>
                        Fresh reviewer credential
                        <input
                          type="password"
                          autoComplete="off"
                          value={reviewer}
                          onChange={(e) => setReviewer(e.target.value)}
                          maxLength={43}
                        />
                      </label>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void work(async (valid) => {
                            const current = await client(session).configuration();
                            if (valid()) {
                              setData({ kind: 'configuration', value: current });
                              setMessage(
                                'Current policy loaded. Matching content alone does not confirm the original command. Its inputs and key remain frozen.',
                              );
                            }
                          })
                        }
                      >
                        Inspect current policy
                      </button>
                    </>
                  )}
                  <button
                    disabled={busy}
                    onClick={() =>
                      void send(
                        pending.kind === 'publish' && reviewer ? { ...pending, reviewer } : pending,
                      )
                    }
                  >
                    Retry unchanged command
                  </button>
                </div>
              )}
            </section>
          </>
        )}
        <aside className="staff-card">
          <h2>Unavailable or inactive</h2>
          <p>
            Licensed catalog/fitment/pricing, specialist acceptance, real Search Console, live
            advertising and inbox-client acceptance remain pending. Partner portal, mobile
            administration, audience segments and Phase 2 revenue CSV uploads are inactive. Six S3
            acceptance gates and deployment remain held. Operators, coverage and rates remain
            unconfirmed.
          </p>
        </aside>
        <noscript>
          The staff console requires JavaScript. Existing reviewed scripts remain available for
          local operations.
        </noscript>
      </main>
    </div>
  );
}
