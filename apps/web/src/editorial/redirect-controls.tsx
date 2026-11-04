import { useRef, useState, type FormEvent } from 'react';
import type {
  createEditorialClient,
  RedirectEditorCommand,
  RedirectEditorState,
} from '../../../../packages/contracts/src/editorial-client.ts';
export function RedirectControls({ client }: { client: ReturnType<typeof createEditorialClient> }) {
  const [current, setCurrent] = useState<RedirectEditorState | null>(null),
    [csv, setCsv] = useState(
      'source,target,code,mode\n/learn/old-guide,/learn/tire-basics,301,exact',
    ),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [unknown, setUnknown] = useState(false);
  const pending = useRef<RedirectEditorCommand | null>(null),
    form = useRef<HTMLFormElement>(null);
  async function load() {
    setBusy(true);
    try {
      setCurrent(await client.redirects());
      setMessage('Current redirect snapshot loaded.');
    } catch {
      setMessage(
        'Current redirects are unavailable. Reconnect with an authorized publisher credential.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      let command = pending.current;
      if (!command) {
        if (!current) throw Error('invalid_input');
        const values = new FormData(form.current!),
          issuedAt = current.serverTime;
        command = {
          action: 'redirects',
          reviewerCredential: String(values.get('reviewer')),
          revision: current.latestRevision + 1,
          issuedAt,
          expiresAt: new Date(Date.parse(issuedAt) + 3600000).toISOString(),
          csv,
        };
        pending.current = structuredClone(command);
      }
      const receipt = await client.publishRedirects(command);
      pending.current = null;
      setUnknown(false);
      form.current?.reset();
      try {
        setCurrent(await client.redirects());
      } catch {
        setCurrent(null);
      }
      setMessage(
        'Published redirect snapshot ' + receipt.revision + '. This is local development only.',
      );
    } catch (e) {
      const error = e instanceof Error ? e.message : '';
      if (
        ['forbidden', 'unauthenticated', 'conflict', 'invalid_input', 'not_found'].includes(error)
      ) {
        pending.current = null;
        setUnknown(false);
        setMessage(
          error === 'conflict'
            ? 'The redirect revision changed. Load the current snapshot before trying again.'
            : 'Redirects were refused. Check the reviewer credential and CSV rules.',
        );
      } else {
        setUnknown(true);
        setMessage('The result is unconfirmed. Retry the unchanged snapshot to reconcile it.');
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card editorial-redirects">
      <h2>Safe redirects.</h2>
      <p>
        Publish a bounded, same-site redirect snapshot after a separate reviewer confirms it.
        External destinations, private paths, loops and chains are refused. A rollback is a newly
        reviewed higher revision.
      </p>
      <button
        type="button"
        className="button secondary"
        disabled={busy || unknown}
        onClick={() => {
          void load();
        }}
      >
        Load current rules
      </button>
      {current ? (
        <p>
          Latest allocated revision: {current.latestRevision}. Next revision:{' '}
          {current.latestRevision + 1}. Live rules: {current.current ? 'available' : 'none'}.
        </p>
      ) : null}
      {current?.current ? (
        <details>
          <summary>Current rules</summary>
          <ul>
            {current.current.rules.map((r) => (
              <li key={r.source}>
                {r.code} · {r.source} → {r.target ?? 'Gone'}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <p role="status" aria-live="polite">
        {message}
      </p>
      <form
        ref={form}
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <fieldset disabled={busy || unknown || !current}>
          <label htmlFor="redirect-file">Load CSV file</label>
          <input
            id="redirect-file"
            type="file"
            accept=".csv,text/csv"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 60000) {
                setMessage('Choose a CSV file smaller than 60 KB.');
                return;
              }
              setCsv(await file.text());
            }}
          />
          <label htmlFor="redirect-csv">CSV rules · source, target, code, mode</label>
          <textarea
            id="redirect-csv"
            value={csv}
            rows={8}
            maxLength={60000}
            onChange={(e) => setCsv(e.target.value)}
            required
          />
          <label htmlFor="redirect-reviewer">Separate local reviewer credential</label>
          <input
            id="redirect-reviewer"
            name="reviewer"
            type="password"
            autoComplete="off"
            required
          />
          <button className="button primary">Publish reviewed snapshot</button>
        </fieldset>
      </form>
      {unknown ? (
        <button
          type="button"
          className="button primary"
          disabled={busy}
          onClick={() => {
            void submit();
          }}
        >
          Retry unchanged snapshot
        </button>
      ) : null}
    </section>
  );
}
