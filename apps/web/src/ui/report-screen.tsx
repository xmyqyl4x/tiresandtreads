import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  assessmentSignature,
  reportRoute,
  reportUrl,
  resultsController,
  type LoadedReport,
} from '../results/controller.ts';
import type { AssessmentRequest } from '../../../../packages/contracts/src/report-inputs.ts';
import { Button, Field } from './controls.tsx';
import { ReportBody } from './report-body.tsx';
import { when } from '../results/presentation.ts';
import { assessmentInputSchema } from '../../../../packages/contracts/src/assessment-input.ts';
import { showDollarInput, parseDollarInput } from '../results/presentation.ts';
type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';
export function ReportScreen() {
  const [view, setView] = useState<LoadedReport | null>(null),
    [input, setInput] = useState<AssessmentRequest | null>(null),
    [saveState, setSaveState] = useState<SaveState>('idle'),
    [saveMessage, setSaveMessage] = useState(''),
    [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState(''),
    [refining, setRefining] = useState(false),
    [refineError, setRefineError] = useState(''),
    [rebase, setRebase] = useState(false),
    [reference, setReference] = useState(''),
    [chosenVersion, setChosenVersion] = useState(''),
    [budgetText, setBudgetText] = useState(''),
    [budgetError, setBudgetError] = useState('');
  const controller = useRef<ReturnType<typeof resultsController> | null>(null),
    ack = useRef(''),
    generation = useRef(0),
    notice = useRef<HTMLDivElement>(null),
    pendingSave = useRef<AssessmentRequest | null>(null);
  const inputValid = !!input && assessmentInputSchema.safeParse(input).success;
  const dirty = !!budgetError || (!!input && assessmentSignature(input) !== ack.current);
  async function load(preserve = false) {
    const route = reportRoute(location.search),
      stamp = ++generation.current;
    setLoading(true);
    setLoadError('');
    if (!route) {
      setLoading(false);
      setLoadError('Enter a valid report reference from this browser session.');
      return;
    }
    controller.current ??= resultsController(location.origin, route.id);
    try {
      const loaded = await controller.current.load(preserve ? undefined : route.version);
      if (preserve) history.replaceState(null, '', reportUrl(route.id));
      if (stamp !== generation.current) return;
      setView(loaded);
      setReference(route.id);
      setChosenVersion(String(loaded.report.version));
      setRefineError('');
      setSaveState('idle');
      setSaveMessage('');
      const saved =
        !loaded.historical && loaded.draft?.baseVersion === loaded.current.version
          ? loaded.draft.input
          : loaded.report.input;
      ack.current = assessmentSignature(saved);
      pendingSave.current = null;
      if (preserve) {
        setRebase(true);
      } else {
        setInput(saved);
        setBudgetText(showDollarInput(saved.budget?.ceilingMinor));
        setBudgetError('');
        setRebase(!!loaded.draft && loaded.draft.baseVersion !== loaded.current.version);
      }
    } catch {
      if (stamp === generation.current)
        setLoadError(
          'This private report could not be loaded. Use its original browser session and a valid reference, or retry. No report existence or ownership is confirmed.',
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
  async function save(retry = false) {
    if (!input || !controller.current || !view) return;
    setSaveState('saving');
    setSaveMessage('Saving draft…');
    const attempt = retry ? pendingSave.current : input;
    if (!attempt) {
      setSaveState('error');
      setSaveMessage('Reload current information before retrying.');
      return;
    }
    pendingSave.current = attempt;
    try {
      const r = await (retry ? controller.current.retrySave() : controller.current.save(attempt));
      ack.current = assessmentSignature(r.input);
      pendingSave.current = null;
      setSaveState('saved');
      setSaveMessage('Draft saved. The current report has not changed.');
    } catch (error) {
      const conflict =
        !!error && typeof error === 'object' && 'code' in error && error.code === 'conflict';
      setSaveState(conflict ? 'conflict' : 'error');
      setSaveMessage(
        conflict
          ? 'Another draft or report version changed. Your answers remain in this tab. Reload current information before choosing how to continue.'
          : 'The save was not confirmed. Keep this tab open and retry the same request, or reload current information.',
      );
      requestAnimationFrame(() => notice.current?.focus());
    }
  }
  useEffect(() => {
    if (
      !input ||
      !view ||
      !inputValid ||
      budgetError ||
      view.historical ||
      rebase ||
      refining ||
      refineError ||
      loading ||
      ['saving', 'error', 'conflict'].includes(saveState) ||
      assessmentSignature(input) === ack.current
    )
      return;
    const timer = setTimeout(() => void save(), 600);
    return () => clearTimeout(timer);
  }, [input, view, saveState, rebase, refining, refineError, loading, inputValid, budgetError]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  async function refine() {
    if (!controller.current) return;
    setRefining(true);
    setRefineError('');
    try {
      const loaded = await controller.current.refine();
      setView(loaded);
      setInput(loaded.report.input);
      setBudgetText(showDollarInput(loaded.report.input.budget?.ceilingMinor));
      setBudgetError('');
      ack.current = assessmentSignature(loaded.report.input);
      setSaveState('idle');
      setSaveMessage('A new immutable report version is saved.');
      setChosenVersion(String(loaded.report.version));
      history.replaceState(null, '', reportUrl(loaded.report.reportId, loaded.report.version));
      requestAnimationFrame(() => notice.current?.focus());
    } catch {
      setRefineError(
        'The refinement was not confirmed. Retry the same refinement safely, or reload current information. Your saved version is retained.',
      );
      requestAnimationFrame(() => notice.current?.focus());
    } finally {
      setRefining(false);
    }
  }
  function open(e: FormEvent) {
    e.preventDefault();
    try {
      location.assign(reportUrl(reference));
    } catch {
      setLoadError('Enter a valid report reference.');
    }
  }
  if (loading) return <p role="status">Loading your private saved report…</p>;
  if (loadError || !view || !input)
    return (
      <div>
        <section className="callout warning" role="alert">
          <p>{loadError || 'Report unavailable.'}</p>
        </section>
        <form onSubmit={open}>
          <Field
            id="report-reference"
            label="Report reference"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
          <Button type="submit">Open private report</Button>
        </form>
        <Button tone="secondary" onClick={() => void load()}>
          Retry current link
        </Button>
      </div>
    );
  const current = view.current,
    report = view.report;
  function change<K extends keyof AssessmentRequest>(key: K, value: AssessmentRequest[K]) {
    setInput((v) => (v ? { ...v, [key]: value } : v));
  }
  const disabled = view.historical || refining || !!refineError || rebase;
  return (
    <>
      <div className="report-toolbar">
        <p>
          Report <code>{report.reportId}</code> · version {report.version}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            try {
              location.assign(reportUrl(report.reportId, Number(chosenVersion)));
            } catch {
              setSaveMessage('Choose a positive report version.');
            }
          }}
        >
          <Field
            id="report-version"
            label="Stored version"
            type="number"
            min="1"
            max={current.version}
            value={chosenVersion}
            onChange={(e) => setChosenVersion(e.target.value)}
          />
          <Button type="submit" tone="secondary">
            View version
          </Button>
        </form>
        {view.historical ? (
          <p className="callout warning">
            This version is historical and read-only.{' '}
            <a href={reportUrl(report.reportId)}>Return to current version {current.version}</a>.
          </p>
        ) : null}
      </div>
      <p>
        <a
          className="button secondary"
          href={'/preview/compare?report=' + report.reportId + '&version=' + report.version}
        >
          Compare options and shop quotes
        </a>
      </p>
      <ReportBody output={report.output} safety={report.safety} version={report.version} />
      {report.diff ? (
        <section className="callout info">
          <h2>What changed in this version</h2>
          <ul>
            <li>Answers: {report.diff.answersChanged ? 'changed' : 'unchanged'}</li>
            <li>Source data: {report.diff.dataChanged ? 'changed' : 'unchanged'}</li>
            <li>Rules: {report.diff.rulesChanged ? 'changed' : 'unchanged'}</li>
            <li>
              Score comparison:{' '}
              {report.diff.scoresComparable
                ? 'permitted by the recorded rule versions'
                : 'not comparable across changed rules'}
            </li>
            <li>
              Added {report.diff.added.length}; removed {report.diff.removed.length}; reranked{' '}
              {report.diff.reranked.length}.
            </li>
          </ul>
        </section>
      ) : null}
      <section className="report-section">
        <h2>Refine your answers</h2>
        <p>
          Changes autosave to a separate private draft. Your current report changes only when you
          choose Create refined version.
        </p>
        {view.draft ? (
          <p className="hint">
            Stored draft revision {view.draft.revision}; expires {when(view.draft.expiresAt)}.
          </p>
        ) : null}
        {rebase ? (
          <div className="callout warning">
            <p>
              Current information was reloaded. Choose explicitly whether to keep your tab's answers
              or use the server's current answers. No draft is overwritten automatically.
            </p>
            <div className="actions">
              <Button
                onClick={() => {
                  ack.current = '';
                  setRebase(false);
                  setSaveState('idle');
                }}
              >
                Keep my answers on current version
              </Button>
              <Button
                tone="secondary"
                onClick={() => {
                  const saved =
                    view.draft?.baseVersion === current.version ? view.draft.input : current.input;
                  setInput(saved);
                  setBudgetText(showDollarInput(saved.budget?.ceilingMinor));
                  setBudgetError('');
                  ack.current = assessmentSignature(saved);
                  setRebase(false);
                  setSaveState('idle');
                }}
              >
                Use saved current answers
              </Button>
            </div>
          </div>
        ) : null}
        <fieldset disabled={disabled}>
          <legend>Current draft controls</legend>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="refine-strategy">Seasonal strategy</label>
              <select
                id="refine-strategy"
                value={input.strategy}
                onChange={(e) =>
                  change('strategy', e.target.value as AssessmentRequest['strategy'])
                }
              >
                <option value="year_round">One set year round</option>
                <option value="summer_set">Summer set</option>
                <option value="winter_set">Winter set</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="refine-winter">Winter conditions</label>
              <select
                id="refine-winter"
                value={input.winterUse}
                onChange={(e) =>
                  change('winterUse', e.target.value as AssessmentRequest['winterUse'])
                }
              >
                <option value="unknown">Not sure</option>
                <option value="none">No snow or ice</option>
                <option value="snow">Snow</option>
                <option value="ice">Ice</option>
              </select>
            </div>
            <Field
              id="refine-mileage"
              label="Annual mileage context"
              type="number"
              min="0"
              max="200000"
              value={input.annualMiles ?? ''}
              error={
                input.annualMiles !== null &&
                input.annualMiles !== undefined &&
                (!Number.isInteger(input.annualMiles) ||
                  input.annualMiles < 0 ||
                  input.annualMiles > 200000)
                  ? 'Enter whole annual miles from 0 to 200,000.'
                  : undefined
              }
              onChange={(e) =>
                change('annualMiles', e.target.value === '' ? null : Number(e.target.value))
              }
            />
            <Field
              id="refine-budget"
              label="Maximum budget (USD)"
              inputMode="decimal"
              value={budgetText}
              error={budgetError || undefined}
              hint="Clear to leave the budget unknown."
              onChange={(e) => {
                const text = e.target.value;
                setBudgetText(text);
                const minor = parseDollarInput(text);
                if (minor === false) {
                  setBudgetError('Enter dollars with up to two decimal places.');
                  return;
                }
                setBudgetError('');
                change(
                  'budget',
                  minor === null
                    ? null
                    : {
                        basis: input.budget?.basis ?? 'installed',
                        currency: 'USD',
                        ceilingMinor: minor,
                      },
                );
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="refine-budget-basis">Budget basis</label>
            <select
              id="refine-budget-basis"
              value={input.budget?.basis ?? 'installed'}
              disabled={!input.budget}
              onChange={(e) =>
                change(
                  'budget',
                  input.budget
                    ? { ...input.budget, basis: e.target.value as 'installed' | 'merchandise' }
                    : null,
                )
              }
            >
              <option value="installed">Installed total</option>
              <option value="merchandise">Tires only</option>
            </select>
          </div>
          <div role="group" aria-label="Refinement priorities">
            <p>Choose up to three priorities</p>
            {(
              [
                'wet',
                'longevity',
                'comfort',
                'dry',
                'value',
                'noise',
                'efficiency',
                'snow',
                'ice',
              ] as const
            ).map((p) => (
              <label className="check-field" key={p}>
                <input
                  type="checkbox"
                  checked={input.priorities.includes(p)}
                  disabled={!input.priorities.includes(p) && input.priorities.length >= 3}
                  onChange={(e) =>
                    change(
                      'priorities',
                      e.target.checked
                        ? [...input.priorities, p]
                        : input.priorities.filter((v) => v !== p),
                    )
                  }
                />
                {p === 'wet'
                  ? 'Wet roads'
                  : p === 'longevity'
                    ? 'Tread life'
                    : p === 'efficiency'
                      ? 'Efficiency'
                      : p[0]!.toUpperCase() + p.slice(1)}
              </label>
            ))}
          </div>
        </fieldset>
        <div
          ref={notice}
          tabIndex={-1}
          role={
            saveState === 'error' || saveState === 'conflict' || refineError ? 'alert' : 'status'
          }
        >
          <p>
            {!inputValid || budgetError
              ? 'Check the highlighted values; the saved report is unchanged.'
              : dirty && !['saving', 'error', 'conflict'].includes(saveState)
                ? 'Unsaved draft changes. Waiting to save…'
                : saveMessage || 'No unsaved changes.'}
          </p>
          {refineError ? <p>{refineError}</p> : null}
        </div>
        <div className="actions">
          <Button
            busy={refining}
            disabled={
              disabled ||
              dirty ||
              !inputValid ||
              !(saveState === 'saved' || view.draft?.baseVersion === current.version) ||
              saveState === 'saving' ||
              saveState === 'error' ||
              saveState === 'conflict'
            }
            onClick={() => void refine()}
          >
            Create refined version
          </Button>
          {refineError ? (
            <Button tone="secondary" onClick={() => void refine()}>
              Retry refinement
            </Button>
          ) : null}
          {saveState === 'error' ? (
            <Button tone="secondary" onClick={() => void save(true)}>
              Retry draft save
            </Button>
          ) : null}
          <Button
            tone="secondary"
            disabled={saveState === 'saving' || refining}
            onClick={() => void load(true)}
          >
            Reload current information
          </Button>
          <a className="plain-link" href="/preview/find-tires">
            Start a new assessment
          </a>
        </div>
      </section>
    </>
  );
}
