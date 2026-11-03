import { useEffect, useRef, useState } from 'react';
import { createResultsClient } from '@tt/contracts/results';
import type { OwnerReportView } from '@tt/contracts/report-views';
import type { OwnerComparisonView, QuotePageView } from '@tt/contracts/comparison-views';
import type { QuoteInput } from '@tt/contracts/quote-input';
import type { Selection } from '@tt/contracts/comparison';
import { comparisonController } from '../comparison/controller.ts';
import { addChoice, replaceChoice, removeChoice, type Choices } from '../comparison/model.ts';
import { reportRoute, reportUrl } from '../results/controller.ts';
import { money, when } from '../results/presentation.ts';
import { Button } from './controls.tsx';
import { QuoteForm } from './quote-form.tsx';
import { SharePanel } from './share-panel.tsx';
import { PrivatePdfs } from './private-pdfs.tsx';
import { ComparisonBody } from './comparison-body.tsx';
type Controller = ReturnType<typeof comparisonController>;
type Detail = Awaited<ReturnType<Controller['saveQuote']>>;
export function ComparisonScreen() {
  const [report, setReport] = useState<OwnerReportView | null>(null),
    [quotes, setQuotes] = useState<QuotePageView['items']>([]),
    [next, setNext] = useState<string | null>(null),
    [saved, setSaved] = useState<OwnerComparisonView | null>(null),
    [choices, setChoices] = useState<Choices>({ items: [], pending: null }),
    [detail, setDetail] = useState<Detail | null>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [correctable, setCorrectable] = useState(false),
    [message, setMessage] = useState('');
  const gateway = useRef<Controller | null>(null),
    flight = useRef(false),
    retry = useRef<(() => Promise<void>) | null>(null),
    generation = useRef(0),
    status = useRef<HTMLDivElement>(null),
    replacement = useRef<HTMLDivElement>(null);
  async function load(preserve = false) {
    const stamp = ++generation.current;
    setLoading(true);
    setError('');
    setCorrectable(false);
    setMessage('');
    try {
      const route = reportRoute(location.search);
      if (!route) throw Error('Invalid report');
      const value = await createResultsClient(location.origin).read(route.id, route.version),
        controller = comparisonController(location.origin, route.id, value.version),
        page = await controller.quotes(),
        revision = preserve
          ? (value.comparisonRevision ?? null)
          : (new URLSearchParams(location.search).get('revision') ??
            value.comparisonRevision ??
            null),
        comparison = revision ? await controller.comparison(revision) : null;
      if (stamp !== generation.current) return;
      gateway.current = controller;
      setReport(value);
      setQuotes(page.items);
      setNext(page.next);
      setSaved(comparison);
      if (!preserve) {
        setChoices({ items: [], pending: null });
        setDetail(null);
      }
      const url = new URLSearchParams({ report: value.reportId, version: String(value.version) });
      if (comparison) url.set('revision', comparison.comparison.revision);
      history.replaceState(null, '', '/preview/compare?' + url);
      if (preserve)
        setMessage(
          'Current comparison reloaded. Your selections and quote fields are retained; review them before saving.',
        );
      retry.current = null;
    } catch {
      if (stamp === generation.current)
        setError(
          'The private comparison could not be loaded. Use the report’s original browser session and a valid version.',
        );
    } finally {
      if (stamp === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, []);
  async function run(work: () => Promise<void>) {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError('');
    setCorrectable(false);
    retry.current = work;
    try {
      await work();
      retry.current = null;
    } catch (e) {
      const conflict = !!e && typeof e === 'object' && 'code' in e && e.code === 'conflict';
      const invalid =
        !!e &&
        typeof e === 'object' &&
        'code' in e &&
        e.code === 'invalid_input' &&
        'retryable' in e &&
        e.retryable === false;
      setCorrectable(invalid);
      if (invalid) retry.current = null;
      setError(
        invalid
          ? 'The service refused these values. Correct the quote fields and try again; your inputs and saved report are retained.'
          : conflict
            ? 'Another comparison changed. Your selections and quote fields remain here. Reload current data before explicitly creating a revised comparison.'
            : 'This action was not confirmed. Your inputs remain here. Retry the same request, or reload current data before changing it.',
      );
    } finally {
      flight.current = false;
      setBusy(false);
      requestAnimationFrame(() => status.current?.focus());
    }
  }
  if (loading && !report) return <p role="status">Loading your private comparison…</p>;
  if (!report || !gateway.current)
    return (
      <section className="callout warning" role="alert">
        <p>{error}</p>
        <Button onClick={() => void load()}>Retry private comparison</Button>
        <a className="plain-link" href="/preview/find-tires">
          Start an assessment
        </a>
      </section>
    );
  const controller = gateway.current,
    locked = loading || busy || (!!error && !correctable),
    staleComparison =
      !!saved &&
      !!report.comparisonRevision &&
      saved.comparison.revision !== report.comparisonRevision;
  function label(item: Selection) {
    if (item.kind === 'quote') {
      const q = quotes.find((q) => q.id === item.key);
      return q
        ? 'Shop quote · ' +
            money(q.totalMinor) +
            ' · ' +
            q.quantity +
            ' tires · ' +
            q.basis.replaceAll('_', ' ')
        : 'Saved shop quote';
    }
    const index = report!.output.result.picks.indexOf(item.key);
    return 'Catalog option ' + (index + 1);
  }
  function choose(item: Selection) {
    const next = addChoice(choices, item);
    setChoices(next);
    setMessage(
      next.pending
        ? 'Choose explicitly which slot to replace.'
        : 'Selection updated; the saved comparison is unchanged.',
    );
    requestAnimationFrame(() =>
      next.pending ? replacement.current?.focus() : status.current?.focus(),
    );
  }
  async function saveQuote(body: QuoteInput) {
    await run(async () => {
      const q = await controller.saveQuote(body);
      setDetail(q);
      setQuotes((old) => [q.quote, ...old.filter((x) => x.id !== q.quote.id)].slice(0, 100));
      setMessage(
        'Quote saved privately. Add it explicitly to the comparison to check its service verdict.',
      );
    });
  }
  return (
    <>
      {loading ? <p role="status">Reloading current data; your entries are retained.</p> : null}
      <p>
        Private report version {report.version}.{' '}
        <a href={reportUrl(report.reportId, report.version)}>Return to saved report</a>
      </p>
      <p className="callout warning">
        Current safety: {report.safety.status.replaceAll('_', ' ')}. Checked{' '}
        {when(report.safety.checkedAt)}. This technical preview does not issue tire advice or safety
        clearance.
      </p>
      <section className="report-section">
        <h2>Choose up to four items</h2>
        {staleComparison ? (
          <p className="callout warning">
            This saved comparison is historical. Reload current data before revising it; your
            selections and quote fields will be retained.
          </p>
        ) : null}
        <p>
          Selections stay separate from the saved comparison. Adding a fifth requires an explicit
          replacement or removal.
        </p>
        <div className="result-grid">
          {report.output.result.picks.map((id, i) => {
            const option = report.output.options.find((x) => x.id === id),
              product = report.output.products.find(
                (x) => x.id === option?.front.id || x.modelId === option?.front.modelId,
              );
            return (
              <article className="card" key={id}>
                <h3>Catalog option {i + 1}</h3>
                <p>
                  {[product?.brand, product?.model].filter(Boolean).join(' ') ||
                    'Stored supported option'}
                </p>
                <p>
                  Front {option?.front.sizeCode ?? 'unavailable'} · rear{' '}
                  {option?.rear.sizeCode ?? 'unavailable'}
                </p>
                <Button
                  tone="secondary"
                  disabled={
                    locked || choices.items.some((x) => x.kind === 'catalog' && x.key === id)
                  }
                  onClick={() => choose({ kind: 'catalog', key: id })}
                >
                  Add catalog option {i + 1}
                </Button>
              </article>
            );
          })}
        </div>
        {!report.output.result.picks.length ? (
          <p>
            No supported catalog choices are available. An unverified shop quote does not supply
            missing fitment evidence.
          </p>
        ) : null}
        <h3>Saved private shop quotes</h3>
        {quotes.length ? (
          <ul className="quote-list">
            {quotes.map((q, i) => (
              <li key={q.id}>
                <p>
                  {money(q.totalMinor)} USD · {q.quantity} tires · {q.basis.replaceAll('_', ' ')} ·
                  quoted {q.observedOn}
                </p>
                <div className="actions">
                  <Button
                    tone="secondary"
                    disabled={
                      locked || choices.items.some((x) => x.kind === 'quote' && x.key === q.id)
                    }
                    onClick={() => choose({ kind: 'quote', key: q.id })}
                  >
                    Add shop quote {i + 1}
                  </Button>
                  <Button
                    tone="secondary"
                    disabled={locked}
                    onClick={() =>
                      void run(async () => {
                        setDetail(await controller.readQuote(q.id));
                        setMessage('Private quote details loaded for the owner.');
                      })
                    }
                  >
                    View shop quote {i + 1}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p>No current quotes are loaded.</p>
        )}
        {next && quotes.length < 100 ? (
          <Button
            tone="secondary"
            disabled={locked}
            onClick={() =>
              void run(async () => {
                const p = await controller.quotes(next);
                setQuotes((old) =>
                  [...old, ...p.items.filter((q) => !old.some((x) => x.id === q.id))].slice(0, 100),
                );
                setNext(p.next);
              })
            }
          >
            More saved quotes
          </Button>
        ) : null}
        {next && quotes.length >= 100 ? <p>Only the first 100 current quotes are shown.</p> : null}
        <h3>Current selection · {choices.items.length} of 4</h3>
        <ol>
          {choices.items.map((item, i) => (
            <li key={item.kind + item.key}>
              <span>{label(item)}</span>{' '}
              <Button
                tone="secondary"
                disabled={locked}
                onClick={() => {
                  setChoices(removeChoice(choices, i));
                  setMessage('Slot removed. No pending item is added automatically.');
                  requestAnimationFrame(() => status.current?.focus());
                }}
              >
                Remove slot {i + 1}
              </Button>
            </li>
          ))}
        </ol>
        {choices.pending ? (
          <div
            className="callout warning"
            role="region"
            aria-label="Choose replacement"
            ref={replacement}
            tabIndex={-1}
          >
            <h3>
              {choices.items.length === 4 ? 'Comparison has four items' : 'A slot is available'}
            </h3>
            <p>
              Add {label(choices.pending)} by explicitly replacing a slot, or cancel. Removing a
              slot alone does not add the pending item.
            </p>
            <div className="actions">
              {choices.items.map((item, i) => (
                <Button
                  tone="secondary"
                  key={i}
                  disabled={locked}
                  onClick={() => {
                    setChoices(replaceChoice(choices, i));
                    setMessage(
                      'Slot ' + (i + 1) + ' explicitly replaced. Save to update the comparison.',
                    );
                    requestAnimationFrame(() => status.current?.focus());
                  }}
                >
                  Replace slot {i + 1}
                </Button>
              ))}
              <Button
                tone="secondary"
                disabled={locked}
                onClick={() => {
                  setChoices({ ...choices, pending: null });
                  setMessage('Replacement canceled. Selection unchanged.');
                  requestAnimationFrame(() => status.current?.focus());
                }}
              >
                Cancel replacement
              </Button>
              {choices.items.length < 4 ? (
                <Button
                  disabled={locked}
                  onClick={() => {
                    setChoices(addChoice({ ...choices, pending: null }, choices.pending!));
                    setMessage('Pending item explicitly added.');
                    requestAnimationFrame(() => status.current?.focus());
                  }}
                >
                  Add pending item
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="actions">
          <Button
            busy={busy}
            disabled={locked || staleComparison || !choices.items.length || !!choices.pending}
            onClick={() => {
              const items = structuredClone(choices.items),
                expected = saved?.comparison.revision ?? null;
              void run(async () => {
                const result = await controller.compare(items, expected);
                setSaved(result);
                setReport((old) =>
                  old ? { ...old, comparisonRevision: result.comparison.revision } : old,
                );
                const q = new URLSearchParams({
                  report: report.reportId,
                  version: String(report.version),
                  revision: result.comparison.revision,
                });
                history.replaceState(null, '', '/preview/compare?' + q);
                setMessage('Comparison saved. Its immutable snapshot is shown below.');
              });
            }}
          >
            Save comparison
          </Button>
          <Button tone="secondary" disabled={busy} onClick={() => void load(true)}>
            Reload current data
          </Button>
        </div>
        <div ref={status} tabIndex={-1} role={error ? 'alert' : 'status'}>
          {error ? <p className="callout error">{error}</p> : <p>{message}</p>}
          {error && retry.current ? (
            <Button tone="secondary" busy={busy} onClick={() => void run(retry.current!)}>
              Retry unchanged request
            </Button>
          ) : null}
        </div>
      </section>
      {saved ? <ComparisonBody value={saved.comparison} asOf={saved.scenario.asOf} /> : null}
      <section className="report-section">
        <QuoteForm busy={locked} onSave={saveQuote} />
        {detail ? (
          <div className="callout info">
            <h3>Owner-only quote details</h3>
            <p>
              {detail.private?.productText ?? 'Private product text unavailable'}
              {detail.private?.shopName ? ' · ' + detail.private.shopName : ''}
            </p>
            <p>
              Recorded amount: {money(detail.quote.totalMinor)} USD · {detail.quote.quantity} tires
              · {detail.quote.basis.replaceAll('_', ' ')}. This is the entered quote, not a verified
              installed estimate. Product and source evidence remain required.
            </p>
          </div>
        ) : null}
      </section>
      <p>
        <a
          className="button secondary"
          href={
            '/preview/delivery?report=' +
            report.reportId +
            '&version=' +
            report.version +
            (saved ? '&comparison=' + saved.comparison.revision : '')
          }
        >
          Choose email delivery for this saved version{saved ? ' and comparison' : ''}
        </a>
      </p>
      <SharePanel
        key={'share:' + report.reportId + ':' + report.version}
        controller={controller}
        version={report.version}
        revision={saved?.comparison.revision ?? null}
      />
      <PrivatePdfs
        key={'pdf:' + report.reportId + ':' + report.version}
        assets={report.pdfs ?? []}
        version={report.version}
        load={controller.pdf}
      />
    </>
  );
}
