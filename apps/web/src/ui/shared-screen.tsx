import { useEffect, useRef, useState } from 'react';
import { createComparisonClient } from '@tt/contracts/comparison';
import type { SharedReportView } from '@tt/contracts/comparison-views';
import { ReportBody } from './report-body.tsx';
import { ComparisonBody } from './comparison-body.tsx';
import { PrivatePdfs } from './private-pdfs.tsx';
import { Button } from './controls.tsx';
export function SharedScreen() {
  const [view, setView] = useState<SharedReportView | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    generation = useRef(0),
    token = useRef(''),
    client = useRef<ReturnType<typeof createComparisonClient> | null>(null),
    pdfAttempt = useRef<{ assetId: string; key: string } | null>(null);
  async function load() {
    const stamp = ++generation.current;
    setLoading(true);
    setError('');
    setView(null);
    pdfAttempt.current = null;
    try {
      token.current = decodeURIComponent(location.hash.slice(1));
      client.current ??= createComparisonClient(location.origin);
      const result = await client.current.shared(token.current);
      if (stamp === generation.current) setView(result);
    } catch {
      if (stamp === generation.current)
        setError(
          'This read-only link is unavailable, expired or revoked. Ask its owner for a valid link. No private report access is confirmed.',
        );
    } finally {
      if (stamp === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    const changed = () => void load();
    window.addEventListener('hashchange', changed);
    return () => {
      generation.current++;
      window.removeEventListener('hashchange', changed);
    };
  }, []);
  async function pdf(assetId: string) {
    if (pdfAttempt.current && pdfAttempt.current.assetId !== assetId)
      throw Error('Retry the pending download');
    const a = (pdfAttempt.current ??= { assetId, key: crypto.randomUUID() });
    const grant = await client.current!.sharedPdf(token.current, assetId, a.key);
    if (grant.report_version !== view!.version) throw Error('Invalid PDF version');
    const bytes = await client.current!.download(grant.token);
    pdfAttempt.current = null;
    return bytes;
  }
  if (loading) return <p role="status">Loading the read-only shared view…</p>;
  if (error || !view)
    return (
      <section className="callout warning" role="alert">
        <p>{error}</p>
        <Button tone="secondary" onClick={() => void load()}>
          Retry shared view
        </Button>
      </section>
    );
  return (
    <>
      <p className="callout info">
        Read-only, redacted shared view. Owner answers and private quote/shop notes are omitted. No
        edit controls or owner session are required.
      </p>
      <ReportBody output={view.output} safety={view.safety} version={view.version} />
      {view.comparison ? <ComparisonBody value={view.comparison} /> : null}
      <PrivatePdfs
        key={generation.current + ':' + view.version}
        assets={view.pdfs ?? []}
        version={view.version}
        load={pdf}
      />
    </>
  );
}
