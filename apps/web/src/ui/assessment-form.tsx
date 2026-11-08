'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Field } from './controls.tsx';
import { blankAssessment, assessmentAnswers, type AssessmentFields } from '../assessment/model.ts';
import { assessmentController, usableReference } from '../assessment/controller.ts';
import type { ReferencePage } from '@tt/contracts/assessment';
import { applyConfirmedSize, type ConfirmedSizeApplication } from '../assessment/model.ts';
type Rows = ReferencePage['items'];
const priorityNames = {
  wet: 'Wet roads',
  longevity: 'Tread life',
  comfort: 'Comfort',
  dry: 'Dry handling',
  value: 'Value',
  noise: 'Low noise',
  efficiency: 'Efficiency',
  snow: 'Snow',
  ice: 'Ice',
} as const;
const positions = {
  front_left: 'Front left',
  front_right: 'Front right',
  rear_left: 'Rear left',
  rear_right: 'Rear right',
} as const;
export function AssessmentForm({
  controller,
  confirmedSize = null,
  onOpen,
  disabled = false,
  onAccessFailure,
  onSubmittingChange,
}: {
  controller?: ReturnType<typeof assessmentController>;
  confirmedSize?: ConfirmedSizeApplication | null;
  onOpen?: (report: string) => void;
  disabled?: boolean;
  onAccessFailure?: (e: unknown) => void;
  onSubmittingChange?: (value: boolean) => void;
} = {}) {
  const [fields, setFields] = useState<AssessmentFields>(blankAssessment),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [vehicles, setVehicles] = useState<Rows>([]),
    [packages, setPackages] = useState<Rows>([]),
    [phase, setPhase] = useState('idle'),
    [submitting, setSubmitting] = useState(false),
    [lookupMessage, setLookupMessage] = useState(''),
    [next, setNext] = useState<string | null>(null),
    [bundle, setBundle] = useState<string | null>(null),
    [failure, setFailure] = useState(''),
    [created, setCreated] = useState<string | null>(null);
  const summary = useRef<HTMLDivElement>(null),
    status = useRef<HTMLDivElement>(null),
    busy = useRef(false),
    sequence = useRef(0),
    abort = useRef<AbortController | null>(null),
    gateway = useRef<ReturnType<typeof assessmentController> | null>(null);
  useEffect(
    () => () => {
      sequence.current++;
      abort.current?.abort();
    },
    [],
  );
  function api() {
    return controller ?? (gateway.current ??= assessmentController(location.origin));
  }
  useEffect(() => {
    if (!confirmedSize) return;
    sequence.current++;
    abort.current?.abort();
    setVehicles([]);
    setPackages([]);
    setNext(null);
    setBundle(null);
    setPhase('idle');
    setErrors({});
    setCreated(null);
    setFields((v) => applyConfirmedSize(v, confirmedSize));
    setLookupMessage(
      'Confirmed photo size applied to ' +
        confirmedSize.axle +
        '. Check the vehicle placard and both axle sizes before submitting.',
    );
  }, [confirmedSize]);
  function change<K extends keyof AssessmentFields>(key: K, value: AssessmentFields[K]) {
    setFields((v) => ({ ...v, [key]: value }));
    setCreated(null);
  }
  function resetLookups() {
    sequence.current++;
    abort.current?.abort();
    setVehicles([]);
    setPackages([]);
    setNext(null);
    setBundle(null);
    setPhase('idle');
    setLookupMessage('');
    setFields((v) => ({
      ...v,
      vehicle: '',
      configuration: '',
      wheelPackage: '',
      front: '',
      rear: '',
      confirmed: false,
    }));
  }
  async function lookup(
    kind: 'vehicles' | 'fitmentConfigurations' | 'fitmentAxles',
    filters: Record<string, string>,
    append = false,
  ) {
    if (kind === 'vehicles' && !append) {
      setVehicles([]);
      setPackages([]);
      setNext(null);
      setBundle(null);
      setFields((v) => ({
        ...v,
        vehicle: '',
        configuration: '',
        wheelPackage: '',
        front: '',
        rear: '',
        confirmed: false,
      }));
    } else if (kind === 'fitmentConfigurations') {
      setPackages([]);
      setFields((v) => ({
        ...v,
        configuration: '',
        wheelPackage: '',
        front: '',
        rear: '',
        confirmed: false,
      }));
    } else if (kind === 'fitmentAxles') {
      setFields((v) => ({ ...v, front: '', rear: '', confirmed: false }));
    }
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const generation = ++sequence.current;
    setPhase('loading');
    setLookupMessage('Loading published reference data…');
    try {
      const page = await api().lookup(
        kind,
        filters,
        AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
      );
      if (generation !== sequence.current) return;
      if (!usableReference(page)) {
        setPhase('unavailable');
        setLookupMessage(
          'Current, complete reference data is unavailable. Use manual entry; a size alone does not verify fitment.',
        );
        return;
      }
      setPhase('ready');
      setBundle(page.source!.bundleId);
      setLookupMessage(
        page.items.length
          ? 'Choose explicitly from the published options. Reference data does not replace checking the vehicle placard.'
          : 'No matching published options. Check your selection or use manual entry.',
      );
      if (kind === 'vehicles') {
        setVehicles((v) =>
          append
            ? [...v, ...page.items.filter((i) => !v.some((old) => old.fact.id === i.fact.id))]
            : page.items,
        );
        setNext(page.next);
      }
      if (kind === 'fitmentConfigurations') {
        setPackages(page.items);
        setNext(null);
        if (page.next)
          setLookupMessage(
            'More wheel packages exist than this page can show. Use manual entry if yours is missing; no package is chosen automatically.',
          );
      }
      if (kind === 'fitmentAxles') {
        const front = page.items.filter((i) => i.fact.axle === 'front'),
          rear = page.items.filter((i) => i.fact.axle === 'rear');
        if (
          front.length !== 1 ||
          rear.length !== 1 ||
          !front[0]!.fact.sizeCode ||
          !rear[0]!.fact.sizeCode ||
          page.next
        ) {
          setPhase('unavailable');
          setLookupMessage(
            'Axle details are incomplete or ambiguous. Use manual entry and check both sizes.',
          );
          return;
        }
        setFields((v) => ({
          ...v,
          front: front[0]!.fact.sizeCode!,
          rear: rear[0]!.fact.sizeCode!,
          confirmed: false,
        }));
      }
    } catch {
      if (generation !== sequence.current) return;
      setPhase('error');
      setLookupMessage(
        'Reference lookup could not finish. Retry or use manual entry; your other answers are retained.',
      );
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy.current || disabled) return;
    setFailure('');
    const checked = assessmentAnswers(fields);
    if (!checked.ok) {
      setErrors(checked.errors);
      requestAnimationFrame(() => summary.current?.focus());
      return;
    }
    if (fields.mode === 'vehicle' && (phase !== 'ready' || !fields.front || !fields.rear)) {
      setErrors({ configuration: 'Load complete wheel-package details, or use manual entry.' });
      requestAnimationFrame(() => summary.current?.focus());
      return;
    }
    setErrors({});
    busy.current = true;
    setSubmitting(true);
    onSubmittingChange?.(true);
    try {
      const receipt = await api().submit(checked.input);
      setCreated(receipt.report_id);
      requestAnimationFrame(() => status.current?.focus());
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      if (['unauthorized', 'unauthenticated', 'forbidden'].includes(code)) onAccessFailure?.(error);
      setFailure(
        code === 'invalid_input'
          ? 'The service could not accept these answers. Review the information and try again.'
          : code === 'conflict'
            ? 'These answers conflict with current information. Reload reference options before trying again.'
            : 'We could not confirm a saved report. Your answers are retained. Retry with the same answers to safely check the same request; current source data may be unavailable.',
      );
      requestAnimationFrame(() => status.current?.focus());
    } finally {
      busy.current = false;
      setSubmitting(false);
      onSubmittingChange?.(false);
    }
  }
  return (
    <form
      className="assessment-form"
      onSubmit={(event) => void submit(event)}
      noValidate
      aria-label="Tire assessment"
    >
      <fieldset disabled={disabled || submitting} className="assessment-inputs">
        {Object.keys(errors).length ? (
          <div className="error-summary" role="alert" tabIndex={-1} ref={summary}>
            <h2>Check your answers</h2>
            <ul>
              {Object.entries(errors).map(([id, error]) => (
                <li key={id}>
                  <a
                    href={'#' + id}
                    onClick={(event) => {
                      event.preventDefault();
                      document.getElementById(id)?.focus();
                    }}
                  >
                    {error}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <fieldset disabled={submitting}>
          <legend>1. Vehicle and tire sizes</legend>
          <div className="actions">
            {(['vehicle', 'manual'] as const).map((mode) => (
              <label className="check-field" key={mode}>
                <input
                  type="radio"
                  name="entry-mode"
                  checked={fields.mode === mode}
                  onChange={() => {
                    resetLookups();
                    change('mode', mode);
                  }}
                />
                {mode === 'vehicle' ? 'Look up my vehicle' : 'Enter sizes manually'}
              </label>
            ))}
          </div>
          {fields.mode === 'vehicle' ? (
            <>
              <Field
                id="year"
                label="Model year"
                type="number"
                min="1900"
                max="2200"
                value={fields.year}
                onChange={(e) => {
                  resetLookups();
                  change('year', e.target.value);
                }}
                hint="Choose your exact vehicle and wheel package; we never select one for you."
              />
              <Button
                tone="secondary"
                busy={phase === 'loading'}
                disabled={!/^\d{4}$/.test(fields.year)}
                onClick={() => void lookup('vehicles', { modelYear: fields.year })}
              >
                Look up vehicles
              </Button>
              <div className="lookup-status" role="status" aria-live="polite">
                {lookupMessage}
              </div>
              {vehicles.length ? (
                <div className="field">
                  <label htmlFor="vehicle">Vehicle</label>
                  <select
                    id="vehicle"
                    value={fields.vehicle}
                    onChange={(e) => {
                      sequence.current++;
                      abort.current?.abort();
                      setPhase('idle');
                      setLookupMessage('Choose a vehicle and wheel package.');
                      change('vehicle', e.target.value);
                      setFields((v) => ({
                        ...v,
                        configuration: '',
                        front: '',
                        rear: '',
                        wheelPackage: '',
                        confirmed: false,
                      }));
                      setPackages([]);
                      if (e.target.value && bundle)
                        void lookup('fitmentConfigurations', { vehicleId: e.target.value, bundle });
                    }}
                  >
                    <option value="">Choose vehicle</option>
                    {vehicles.map(({ fact }) => (
                      <option key={fact.id} value={fact.id}>
                        {[fact.modelYear, fact.make, fact.model, fact.trim]
                          .filter(Boolean)
                          .join(' ')}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              {next ? (
                <Button
                  tone="secondary"
                  busy={phase === 'loading'}
                  onClick={() =>
                    void lookup(
                      'vehicles',
                      { modelYear: fields.year, after: next, ...(bundle ? { bundle } : {}) },
                      true,
                    )
                  }
                >
                  More vehicles
                </Button>
              ) : null}
              <div className="field">
                <label htmlFor="configuration">Wheel package</label>
                <select
                  id="configuration"
                  aria-invalid={!!errors.configuration}
                  aria-describedby={errors.configuration ? 'configuration-error' : undefined}
                  value={fields.configuration}
                  onChange={(e) => {
                    sequence.current++;
                    abort.current?.abort();
                    setPhase('idle');
                    setLookupMessage('Choose a wheel package.');
                    const row = packages.find((x) => x.fact.id === e.target.value);
                    setFields((v) => ({
                      ...v,
                      configuration: row?.fact.id ?? '',
                      wheelPackage: row?.fact.wheelPackage ?? '',
                      front: '',
                      rear: '',
                      confirmed: false,
                    }));
                    if (row && bundle)
                      void lookup('fitmentAxles', { configurationId: row.fact.id, bundle });
                  }}
                >
                  <option value="">Choose wheel package</option>
                  {packages.map(({ fact }) => (
                    <option
                      key={fact.id}
                      value={fact.id}
                      disabled={fact.verificationStatus !== 'verified'}
                    >
                      {fact.wheelPackage}{' '}
                      {fact.verificationStatus !== 'verified' ? '(unverified)' : ''}
                    </option>
                  ))}
                </select>
                {errors.configuration ? (
                  <p className="field-error" id="configuration-error">
                    {errors.configuration}
                  </p>
                ) : null}
              </div>
              <p className="hint">
                If no verified package is available, choose manual entry. Unverified options are
                never promoted to approved fitment.
              </p>
            </>
          ) : null}
          <div className="form-grid">
            <Field
              id="wheelPackage"
              label="Wheel package / placard description"
              required
              value={fields.wheelPackage}
              readOnly={fields.mode === 'vehicle'}
              error={errors.wheelPackage}
              onChange={(e) => {
                change('wheelPackage', e.target.value);
                change('confirmed', false);
              }}
            />
            <Field
              id="front"
              label="Front tire size"
              required
              value={fields.front}
              readOnly={fields.mode === 'vehicle'}
              error={errors.front}
              placeholder="225/45R18"
              onChange={(e) => {
                change('front', e.target.value);
                change('confirmed', false);
              }}
            />
            <Field
              id="rear"
              label="Rear tire size"
              required
              value={fields.rear}
              readOnly={fields.mode === 'vehicle'}
              error={errors.rear}
              placeholder="255/40R18"
              onChange={(e) => {
                change('rear', e.target.value);
                change('confirmed', false);
              }}
            />
          </div>
          <label className="check-field">
            <input
              id="confirmed"
              type="checkbox"
              checked={fields.confirmed}
              aria-invalid={!!errors.confirmed}
              aria-describedby="fitment-note"
              onChange={(e) => change('confirmed', e.target.checked)}
            />
            I checked both sizes and the wheel package against the vehicle information.
          </label>
          <p id="fitment-note" className="hint">
            {errors.confirmed ??
              'This records your check. Manual sizes are not verified fitment or a safety clearance.'}
          </p>
        </fieldset>
        <fieldset disabled={submitting}>
          <legend>2. Driving and replacement</legend>
          <div className="form-grid">
            <Field
              id="region"
              label="Region code"
              value={fields.region}
              required
              error={errors.region}
              onChange={(e) => change('region', e.target.value)}
              hint="Use the region covered by your source data. An unsupported region will remain unsupported."
            />
            <div className="field">
              <label htmlFor="strategy">Seasonal strategy</label>
              <select
                id="strategy"
                value={fields.strategy}
                onChange={(e) => change('strategy', e.target.value as AssessmentFields['strategy'])}
              >
                <option value="year_round">One set year round</option>
                <option value="summer_set">Summer set</option>
                <option value="winter_set">Winter set</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="winterUse">Winter conditions</label>
              <select
                id="winterUse"
                value={fields.winterUse}
                onChange={(e) =>
                  change('winterUse', e.target.value as AssessmentFields['winterUse'])
                }
              >
                <option value="unknown">Not sure</option>
                <option value="none">No snow or ice</option>
                <option value="snow">Snow</option>
                <option value="ice">Ice</option>
              </select>
            </div>
            <Field
              id="annualMiles"
              label="Annual mileage (optional)"
              type="number"
              min="0"
              max="200000"
              step="1"
              value={fields.annualMiles}
              error={errors.annualMiles}
              onChange={(e) => change('annualMiles', e.target.value)}
              hint="Leave blank if unknown. Saved as context; not a tread-life promise or ranking rule."
            />
          </div>
          <div
            id="replace"
            tabIndex={-1}
            role="group"
            aria-labelledby="replace-title"
            aria-describedby={errors.replace ? 'replace-error' : undefined}
          >
            <p id="replace-title">Tire positions to replace</p>
            {Object.entries(positions).map(([position, label]) => (
              <label className="check-field" key={position}>
                <input
                  type="checkbox"
                  checked={fields.replace.includes(position as AssessmentFields['replace'][number])}
                  onChange={(e) =>
                    change(
                      'replace',
                      e.target.checked
                        ? [...fields.replace, position as AssessmentFields['replace'][number]]
                        : fields.replace.filter((v) => v !== position),
                    )
                  }
                />
                {label}
              </label>
            ))}
            {errors.replace ? (
              <p className="field-error" id="replace-error">
                {errors.replace}
              </p>
            ) : null}
            <p className="hint">
              One, two or four positions. The service checks whether the replacement pattern is
              supported.
            </p>
          </div>
        </fieldset>
        <fieldset disabled={submitting}>
          <legend>3. Priorities and budget</legend>
          <div
            id="priorities"
            tabIndex={-1}
            role="group"
            aria-labelledby="priorities-title"
            aria-describedby={errors.priorities ? 'priorities-error' : undefined}
          >
            <p id="priorities-title">Choose up to three priorities</p>
            <div className="form-grid">
              {Object.entries(priorityNames).map(([priority, label]) => (
                <label className="check-field" key={priority}>
                  <input
                    type="checkbox"
                    checked={fields.priorities.includes(
                      priority as AssessmentFields['priorities'][number],
                    )}
                    onChange={(e) =>
                      change(
                        'priorities',
                        e.target.checked
                          ? [
                              ...fields.priorities,
                              priority as AssessmentFields['priorities'][number],
                            ]
                          : fields.priorities.filter((v) => v !== priority),
                      )
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
            {errors.priorities ? (
              <p className="field-error" id="priorities-error">
                {errors.priorities}
              </p>
            ) : null}
          </div>
          <div className="form-grid">
            <Field
              id="budget"
              label="Maximum budget (USD, optional)"
              inputMode="decimal"
              value={fields.budget}
              placeholder="800.00"
              error={errors.budget}
              onChange={(e) => change('budget', e.target.value)}
            />
            <div className="field">
              <label htmlFor="budget-basis">Budget basis</label>
              <select
                id="budget-basis"
                value={fields.budgetBasis}
                onChange={(e) =>
                  change('budgetBasis', e.target.value as 'installed' | 'merchandise')
                }
              >
                <option value="installed">Installed total</option>
                <option value="merchandise">Tires only</option>
              </select>
            </div>
          </div>
        </fieldset>
        <p className="hint">
          No email or advertising permission is required. Local technical results are not approved
          live tire advice.
        </p>
        <Button type="submit" busy={submitting}>
          Create assessment
        </Button>
        <div ref={status} tabIndex={-1} role={failure ? 'alert' : 'status'}>
          {submitting ? (
            <p>
              Checking current information and saving your report. Please wait; a second submission
              is not needed.
            </p>
          ) : null}
          {failure ? <p className="callout error">{failure}</p> : null}
          {created ? (
            <div className="callout success">
              <h2>Your technical report is saved</h2>
              <p>The service returned a committed report receipt.</p>
              <p>
                Report reference: <code>{created}</code>
              </p>
              {onOpen ? (
                <button type="button" onClick={() => onOpen(created)}>
                  Open saved report
                </button>
              ) : (
                <a className="button secondary" href={'/preview/report?report=' + created}>
                  Open saved report
                </a>
              )}
            </div>
          ) : null}
        </div>
      </fieldset>
    </form>
  );
}
