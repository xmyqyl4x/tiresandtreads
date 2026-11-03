import { useRef, useState } from 'react';
import type { comparisonController } from '../comparison/controller.ts';
import { existingShare, shareReference } from '../comparison/model.ts';
import { when } from '../results/presentation.ts';
import { Button, Field } from './controls.tsx';
export function SharePanel({
  controller,
  revision,
  version,
}: {
  controller: ReturnType<typeof comparisonController>;
  revision: string | null;
  version: number;
}) {
  const [latest, setLatest] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [link, setLink] = useState(''),
    [capability, setCapability] = useState(''),
    [expires, setExpires] = useState(''),
    [restore, setRestore] = useState(''),
    [binding, setBinding] = useState('');
  const flight = useRef(false),
    retry = useRef<(() => Promise<void>) | null>(null),
    status = useRef<HTMLDivElement>(null);
  async function run(work: () => Promise<void>) {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError('');
    retry.current = work;
    try {
      await work();
      retry.current = null;
    } catch {
      setError(
        'This share action was not confirmed. Retry the same action or reload before changing it. Your report is retained.',
      );
    } finally {
      flight.current = false;
      setBusy(false);
      requestAnimationFrame(() => status.current?.focus());
    }
  }
  function create() {
    const follow = latest,
      comparison = revision;
    void run(async () => {
      const r = await controller.share(follow, comparison);
      setLink(shareReference(location.origin, r.token));
      setCapability(r.resource_id);
      setExpires(r.expires_at);
      setBinding(
        follow
          ? 'Follows the latest report version; no fixed comparison.'
          : 'Fixed report version ' +
              version +
              (comparison ? ' and saved comparison revision ' + comparison : '.'),
      );
      setMessage(
        'A read-only link is ready. It omits owner inputs, contact data and private shop notes. Copy it explicitly to share.',
      );
    });
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setMessage('Read-only link copied.');
    } catch {
      setMessage('Copy access is unavailable. Select and copy the link below.');
    }
    requestAnimationFrame(() => status.current?.focus());
  }
  function loadExisting() {
    const r = existingShare(location.origin, restore);
    if (!r) {
      setMessage('Enter a share link from this site.');
      return;
    }
    setLink(shareReference(location.origin, r.token));
    setCapability(r.capability);
    setExpires('');
    setBinding('The binding and expiry are checked by the service when the link is opened.');
    setMessage('Link loaded for owner revocation. This does not confirm it is still valid.');
  }
  return (
    <section className="report-section">
      <h2>Read-only sharing</h2>
      <p>
        Anyone with the link can read its redacted view until it expires or is revoked. Copying the
        link gives read access. Unsaved selections, drafts and private notes are not included.
      </p>
      <label className="check-field">
        <input
          type="checkbox"
          checked={latest}
          disabled={busy || !!error}
          onChange={(e) => setLatest(e.target.checked)}
        />
        For the next link, follow the latest report version instead of fixing this version and saved
        comparison
      </label>
      <div className="actions">
        <Button busy={busy} disabled={!!error} onClick={create}>
          Create read-only link
        </Button>
        {link ? (
          <>
            <Button tone="secondary" disabled={busy} onClick={() => void copy()}>
              Copy share link
            </Button>
            <Button
              tone="secondary"
              disabled={busy || !!error}
              onClick={() =>
                void run(async () => {
                  await controller.revoke(capability);
                  setLink('');
                  setCapability('');
                  setExpires('');
                  setBinding('');
                  setRestore('');
                  setMessage(
                    'Share revoked. New reads and downloads through this link are refused.',
                  );
                })
              }
            >
              Revoke share link
            </Button>
          </>
        ) : null}
      </div>
      {link ? (
        <div className="field">
          <label htmlFor="share-link">Read-only share link</label>
          <p>{binding}</p>
          <textarea id="share-link" readOnly rows={4} value={link} />
          {expires ? <p>Expires {when(expires)}.</p> : null}
        </div>
      ) : null}
      <details>
        <summary>Revoke an existing link</summary>
        <Field
          id="existing-share"
          label="Existing share link from this site"
          value={restore}
          onChange={(e) => setRestore(e.target.value)}
        />
        <Button tone="secondary" disabled={busy || !!error} onClick={loadExisting}>
          Load existing link
        </Button>
      </details>
      <div ref={status} tabIndex={-1} role={error ? 'alert' : 'status'}>
        {error ? <p className="callout error">{error}</p> : <p>{message}</p>}
        {error ? (
          <Button
            tone="secondary"
            busy={busy}
            onClick={() => retry.current && void run(retry.current)}
          >
            Retry same share action
          </Button>
        ) : null}
      </div>
    </section>
  );
}
