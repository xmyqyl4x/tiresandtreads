import { useEffect, useRef, useState } from 'react';
import { Button } from './controls.tsx';
export function PrivatePdfs({
  assets,
  version,
  load,
}: {
  assets: readonly { assetId: string }[];
  version: number;
  load: (id: string) => Promise<Uint8Array>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [url, setUrl] = useState(''),
    [failed, setFailed] = useState<string | null>(null),
    inFlight = useRef(false),
    live = useRef(true),
    status = useRef<HTMLDivElement>(null);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  async function get(id: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    setUrl('');
    try {
      const bytes = await load(id);
      if (!live.current) return;
      setUrl(
        URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: 'application/pdf' })),
      );
      setFailed(null);
      requestAnimationFrame(() => status.current?.focus());
    } catch {
      if (!live.current) return;
      setError(
        'A private PDF could not be obtained. Access may be unavailable, expired or revoked. Retry the same request; no public file URL was created.',
      );
      setFailed(id);
    } finally {
      inFlight.current = false;
      if (live.current) setBusy(false);
    }
  }
  return (
    <section className="report-section">
      <h2>Private PDF</h2>
      {assets.length ? (
        <>
          <p>
            Available for version {version}. Access is checked again when downloading. Revoking a
            share prevents new access; it cannot retract an already saved file.
          </p>
          <div className="actions">
            {assets.map((asset, i) => (
              <Button
                key={asset.assetId}
                busy={busy}
                disabled={!!failed && failed !== asset.assetId}
                onClick={() => void get(asset.assetId)}
              >
                {failed === asset.assetId
                  ? 'Retry private PDF'
                  : 'Prepare private PDF ' + (assets.length > 1 ? i + 1 : '')}
              </Button>
            ))}
          </div>
        </>
      ) : (
        <p>
          An accessible PDF is unavailable for this view. PDF rendering and delivery are separate
          capabilities; this page does not generate or send a report.
        </p>
      )}
      <div ref={status} tabIndex={-1} role={error ? 'alert' : 'status'}>
        {error ? <p className="callout error">{error}</p> : null}
        {url ? (
          <a className="button secondary" href={url} download={'tire-report-v' + version + '.pdf'}>
            Save private PDF
          </a>
        ) : null}
      </div>
    </section>
  );
}
