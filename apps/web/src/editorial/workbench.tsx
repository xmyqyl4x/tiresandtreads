import { useRef, useState, type FormEvent } from 'react';
import { RedirectControls } from './redirect-controls.tsx';
import {
  createEditorialClient,
  type EditorialListItem,
  type EditorialIdentity,
  type EditorialRead,
  type EditorialCommandInput,
} from '../../../../packages/contracts/src/editorial-client.ts';
export function EditorialWorkbench() {
  const [credential, setCredential] = useState(''),
    [client, setClient] = useState<ReturnType<typeof createEditorialClient> | null>(null),
    [documents, setDocuments] = useState<EditorialListItem[]>([]),
    [selected, setSelected] = useState<EditorialRead | null>(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [unknown, setUnknown] = useState(false),
    [dirty, setDirty] = useState(false),
    [version, setVersion] = useState('');
  const [identity, setIdentity] = useState<EditorialIdentity | null>(null);
  const working = useRef(false);
  const pending = useRef<EditorialCommandInput | null>(null),
    form = useRef<HTMLFormElement>(null);
  async function connect(event: FormEvent) {
    event.preventDefault();
    if (working.current) return;
    working.current = true;
    setBusy(true);
    try {
      const next = createEditorialClient(location.origin, credential);
      const [who, items] = await Promise.all([next.identity(), next.list()]);
      setIdentity(who);
      setDocuments(items);
      setClient(next);
      setCredential('');
      setSelected(null);
      setDirty(false);
      setMessage('Connected to the local editorial workspace.');
    } catch {
      setMessage('Connection refused. Check your current local staff credential.');
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  async function choose(id: string) {
    if (!client || working.current || unknown) return;
    working.current = true;
    setBusy(true);
    try {
      setSelected(await client.read(id));
      setDirty(false);
      setVersion('');
      setMessage('');
    } catch {
      setMessage('The document could not be read.');
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  async function command(action: EditorialCommandInput['action']) {
    if (!client || working.current) return;
    if (dirty && action !== 'save' && !pending.current) {
      setMessage('Save your edits before changing review or publication state.');
      return;
    }
    working.current = true;
    setBusy(true);
    try {
      let input = pending.current;
      if (!input) {
        const current = selected?.document,
          values = new FormData(form.current!);
        input = {
          id: current?.id ?? crypto.randomUUID(),
          expectedRevision: current?.revision ?? 0,
          key: crypto.randomUUID(),
          action,
        };
        if (action === 'save')
          input.draft = {
            key: current?.draft.key ?? String(values.get('key')),
            kind: current?.draft.kind ?? (String(values.get('kind')) as 'article' | 'glossary'),
            path: String(values.get('path')),
            title: String(values.get('title')),
            summary: String(values.get('summary')),
            paragraphs: String(values.get('paragraphs'))
              .split(/\n\s*\n/)
              .map((s) => s.trim())
              .filter(Boolean),
            topics: [
              String(values.get('topic')) as 'size',
              ...(current?.draft.topics.slice(1).filter((t) => t !== String(values.get('topic'))) ??
                []),
            ],
            related: current?.draft.related ?? [],
            references: [
              { title: String(values.get('sourceTitle')), url: String(values.get('sourceUrl')) },
              ...(current?.draft.references.slice(1) ?? []),
            ],
            ...(current?.draft.questions ? { questions: current.draft.questions } : {}),
          };
        if (action === 'approve' && !values.get('expiresAt')) throw Error('invalid_input');
        if (action === 'approve')
          input.expiresAt = new Date(
            String(values.get('expiresAt')) + 'T23:59:59.000Z',
          ).toISOString();
        if (action === 'rollback') input.versionId = version;
        pending.current = structuredClone(input);
      }
      const receipt = await client.execute(input);
      pending.current = null;
      setUnknown(false);
      setDirty(false);
      try {
        setSelected(await client.read(receipt.id));
        setDocuments(await client.list());
      } catch {
        setMessage(
          'Revision ' + receipt.revision + ' was saved. Reconnect to refresh its current state.',
        );
        return;
      }
      setMessage(
        'Saved revision ' +
          receipt.revision +
          '. State: ' +
          receipt.state +
          '.' +
          (action === 'publish'
            ? ' Publication was queued; the public reader remains authoritative.'
            : ''),
      );
    } catch (e) {
      const text = e instanceof Error ? e.message : '';
      if (
        ['forbidden', 'conflict', 'not_found', 'invalid_input', 'unauthenticated'].includes(text)
      ) {
        pending.current = null;
        setUnknown(false);
        setMessage(
          text === 'conflict'
            ? 'This revision changed. Reload the document before continuing.'
            : text === 'forbidden'
              ? 'Your current role does not permit this operation.'
              : text === 'unauthenticated'
                ? 'Reconnect with your current staff credential.'
                : text === 'not_found'
                  ? 'This document or version is no longer available.'
                  : 'Check the document fields and review expiry.',
        );
      } else {
        setUnknown(true);
        setMessage('The result is unconfirmed. Retry the unchanged operation to reconcile it.');
      }
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  const doc = selected?.document,
    canAuthor = identity?.roles.includes('author') ?? false,
    canReview = identity?.roles.includes('reviewer') ?? false,
    canPublish = identity?.roles.includes('publisher') ?? false;
  return (
    <main className="container editorial-workbench">
      <p className="eyebrow">LOCAL EDITORIAL WORKSPACE</p>
      <h1>Prepare, review, publish.</h1>
      <p className="callout">
        Local development only. Staff roles and any example approvals are synthetic. Specialist
        acceptance and live publication remain pending.
      </p>
      <p role="status" aria-live="polite">
        {message}
      </p>
      {!client ? (
        <form
          onSubmit={(e) => {
            void connect(e);
          }}
          className="card"
        >
          <label htmlFor="editorial-credential">Local staff credential</label>
          <input
            id="editorial-credential"
            type="password"
            autoComplete="off"
            value={credential}
            onChange={(e) => setCredential(e.target.value)}
            required
          />
          <button className="button primary" disabled={busy}>
            Connect
          </button>
        </form>
      ) : (
        <>
          <button
            className="button secondary"
            disabled={busy || unknown}
            onClick={() => {
              setClient(null);
              setIdentity(null);
              setDocuments([]);
              setSelected(null);
              setCredential('');
            }}
          >
            Disconnect
          </button>
          <div className="editorial-grid">
            <aside className="card">
              <h2>Documents</h2>
              <button
                className="button secondary"
                disabled={busy || unknown || !canAuthor}
                onClick={() => {
                  setSelected({ document: null, versions: [] });
                  setDirty(false);
                  setMessage('New draft.');
                }}
              >
                New draft
              </button>
              <ul>
                {documents.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      disabled={busy || unknown}
                      aria-current={doc?.id === d.id ? 'page' : undefined}
                      onClick={() => {
                        void choose(d.id);
                      }}
                    >
                      {d.draft.title}
                      <span className="hint">
                        {' '}
                        · {d.state} · v{d.revision}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </aside>
            {selected ? (
              <section className="card" aria-label="Document editor">
                <h2>{doc ? 'Revision ' + doc.revision + ' · ' + doc.state : 'New document'}</h2>
                {doc ? (
                  <p>
                    Author: {doc.author.name}.{' '}
                    {doc.review
                      ? 'Reviewed by ' +
                        doc.review.actor.name +
                        ' on ' +
                        doc.review.at.slice(0, 10) +
                        '.'
                      : 'Review pending.'}
                  </p>
                ) : null}
                <form
                  ref={form}
                  key={(doc?.id ?? 'new') + ':' + (doc?.revision ?? 0)}
                  onChange={(e) => {
                    if (
                      e.target instanceof HTMLElement &&
                      e.target.getAttribute('name') !== 'expiresAt'
                    )
                      setDirty(true);
                  }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void command('save');
                  }}
                >
                  <fieldset disabled={busy || unknown}>
                    <label htmlFor="draft-key">Content key</label>
                    <input
                      id="draft-key"
                      name="key"
                      defaultValue={doc?.draft.key}
                      required
                      readOnly={!!doc || !canAuthor}
                    />
                    <label htmlFor="draft-kind">Type</label>
                    <select
                      id="draft-kind"
                      name="kind"
                      defaultValue={doc?.draft.kind ?? 'glossary'}
                      disabled={!!doc || !canAuthor}
                    >
                      <option value="glossary">Glossary</option>
                      <option value="article">Article</option>
                    </select>
                    <label htmlFor="draft-path">Public path</label>
                    <input
                      id="draft-path"
                      name="path"
                      defaultValue={doc?.draft.path}
                      placeholder="/glossary/section-width"
                      required
                      readOnly={!!doc || !canAuthor}
                    />
                    <label htmlFor="draft-title">Title</label>
                    <input
                      id="draft-title"
                      readOnly={!canAuthor}
                      name="title"
                      defaultValue={doc?.draft.title}
                      maxLength={200}
                      required
                    />
                    <label htmlFor="draft-summary">Summary</label>
                    <textarea
                      id="draft-summary"
                      readOnly={!canAuthor}
                      name="summary"
                      defaultValue={doc?.draft.summary}
                      maxLength={1000}
                      required
                    />
                    <label htmlFor="draft-paragraphs">
                      Article text · blank lines separate paragraphs
                    </label>
                    <textarea
                      id="draft-paragraphs"
                      readOnly={!canAuthor}
                      name="paragraphs"
                      rows={9}
                      defaultValue={doc?.draft.paragraphs.join('\n\n')}
                      required
                    />
                    <label htmlFor="draft-topic">Topic</label>
                    <select
                      id="draft-topic"
                      disabled={!canAuthor}
                      name="topic"
                      defaultValue={doc?.draft.topics[0] ?? 'size'}
                    >
                      {[
                        'size',
                        'ratings',
                        'winter',
                        'wet',
                        'types',
                        'maintenance',
                        'buying',
                        'warranty',
                        'noise',
                        'efficiency',
                        'heat',
                        'off_road',
                        'ev',
                        'run_flat',
                      ].map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                    <label htmlFor="source-title">Source title</label>
                    <input
                      id="source-title"
                      readOnly={!canAuthor}
                      name="sourceTitle"
                      defaultValue={doc?.draft.references[0]?.title}
                      required
                    />
                    <label htmlFor="source-url">Source URL</label>
                    <input
                      id="source-url"
                      readOnly={!canAuthor}
                      name="sourceUrl"
                      type="url"
                      defaultValue={doc?.draft.references[0]?.url}
                      required
                    />
                    <label htmlFor="review-expiry">Review valid through (UTC)</label>
                    <input
                      id="review-expiry"
                      readOnly={!canReview}
                      type="date"
                      name="expiresAt"
                      defaultValue={doc?.review?.expiresAt.slice(0, 10)}
                    />
                    <div className="actions">
                      <button className="button primary" type="submit" disabled={!canAuthor}>
                        Save draft
                      </button>
                      {doc ? (
                        <>
                          {(['submit', 'approve', 'reject', 'publish', 'withdraw'] as const)
                            .filter((action) =>
                              action === 'submit'
                                ? canAuthor &&
                                  doc.author.id === identity?.id &&
                                  ['draft', 'rejected'].includes(doc.state)
                                : ['approve', 'reject'].includes(action)
                                  ? canReview &&
                                    doc.author.id !== identity?.id &&
                                    doc.state === 'review'
                                  : canPublish &&
                                    (action === 'publish'
                                      ? doc.state === 'approved'
                                      : doc.state !== 'withdrawn'),
                            )
                            .map((action) => (
                              <button
                                type="button"
                                className="button secondary"
                                key={action}
                                disabled={dirty}
                                onClick={() => {
                                  void command(action);
                                }}
                              >
                                {
                                  (
                                    {
                                      submit: 'Send for review',
                                      approve: 'Approve review',
                                      reject: 'Reject review',
                                      publish: 'Queue publication',
                                      withdraw: 'Withdraw',
                                    } as const
                                  )[action]
                                }
                              </button>
                            ))}
                        </>
                      ) : null}
                    </div>
                  </fieldset>
                </form>
                <h3>Version history</h3>
                <p>Restoring a version creates a new draft and requires fresh review.</p>
                <label htmlFor="editorial-version">Version to restore</label>
                <select
                  id="editorial-version"
                  value={version}
                  disabled={busy || unknown}
                  onChange={(e) => setVersion(e.target.value)}
                >
                  <option value="">Choose a version</option>
                  {selected.versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      Revision {v.revision} · {v.state}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="button secondary"
                  disabled={!version || busy || unknown || dirty || !canPublish}
                  onClick={() => {
                    void command('rollback');
                  }}
                >
                  Restore as new draft
                </button>
                {dirty ? (
                  <p role="status">
                    Unsaved edits. Save the draft before submitting, reviewing or publishing.
                  </p>
                ) : null}
              </section>
            ) : (
              <section className="card">
                <h2>Select a document</h2>
                <p>Choose a draft to inspect its content, review state and version history.</p>
              </section>
            )}
          </div>
          {canPublish ? <RedirectControls client={client} /> : null}
          {unknown ? (
            <button
              className="button primary"
              disabled={busy}
              onClick={() => {
                if (pending.current) void command(pending.current.action);
              }}
            >
              Retry unchanged operation
            </button>
          ) : null}
        </>
      )}
      <p>
        <a href="/learn/tire-basics">Open the education hub</a>
      </p>
    </main>
  );
}
