'use client';
import { useRef, useState, type FormEvent } from 'react';
import { Button, Field, Callout, ReservedHouseSlot } from './controls.tsx';
import { display } from '../locale.ts';
export function ComponentDemo() {
  const [sample, setSample] = useState(''),
    [error, setError] = useState(''),
    [done, setDone] = useState(false),
    summary = useRef<HTMLDivElement>(null);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDone(false);
    if (!sample.trim()) {
      setError('Enter an example value.');
      requestAnimationFrame(() => summary.current?.focus());
    } else {
      setError('');
      setDone(true);
    }
  }
  return (
    <div className="component-grid">
      <section className="card">
        <h2>Buttons and feedback</h2>
        <p>Consistent targets, visible focus and clear status.</p>
        <div className="actions">
          <Button onClick={() => setDone(true)}>Primary action</Button>
          <Button tone="secondary" onClick={() => setDone(false)}>
            Secondary action
          </Button>
          <Button disabled>Unavailable</Button>
          <Button busy>Loading</Button>
        </div>
        <Callout title="Information stays clear">
          <p>Unknown information is shown as unavailable.</p>
        </Callout>
        <Callout tone="warning" title="Review needed">
          <p>A warning explains the next action in words.</p>
        </Callout>
        <Callout tone="error" title="Example error">
          <p>Errors keep your input and explain how to continue.</p>
        </Callout>
        {done ? (
          <Callout tone="success" title="Example complete">
            <p>The example action is complete. Nothing was sent or stored.</p>
          </Callout>
        ) : null}
      </section>
      <section className="card">
        <h2>Fields and error recovery</h2>
        <p>This component example does not submit an assessment.</p>
        {error ? (
          <div ref={summary} tabIndex={-1} className="error-summary" role="alert">
            <h3>Check this field</h3>
            <a
              href="#example-value"
              onClick={() => document.getElementById('example-value')?.focus()}
            >
              {error}
            </a>
          </div>
        ) : null}
        <form onSubmit={submit} noValidate>
          <Field
            id="example-value"
            label="Example value"
            hint="Required. Used only in this local example."
            value={sample}
            onChange={(e) => setSample(e.target.value)}
            required
            {...(error ? { error } : {})}
          />
          <div className="field">
            <label htmlFor="example-distance">Distance display</label>
            <select id="example-distance" defaultValue="miles">
              <option value="miles">Miles</option>
              <option value="kilometers">Kilometers</option>
            </select>
          </div>
          <Button type="submit">Validate example</Button>
        </form>
        <p className="hint">
          Locale examples: {display.currency(74900)} · {display.number(50000)} ·{' '}
          {display.date(new Date('2026-01-15T00:00:00Z'))}. Synthetic formatting examples.
        </p>
      </section>
      <section className="card">
        <h2>Reserved house content</h2>
        <p>
          Fixed space prevents layout shifts. Commercial scripts remain off. No slots appear in
          assessment, comparison, email or privacy flows.
        </p>
        <ReservedHouseSlot />
      </section>
    </div>
  );
}
