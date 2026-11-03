import { useState, useRef, type FormEvent } from 'react';
import { blankQuote, quoteBody, chargeNames, type QuoteFields } from '../comparison/model.ts';
import type { QuoteInput } from '@tt/contracts/quote-input';
import { Button, Field } from './controls.tsx';
export function QuoteForm({
  busy,
  onSave,
}: {
  busy: boolean;
  onSave: (input: QuoteInput) => Promise<void>;
}) {
  const [f, setF] = useState(blankQuote),
    [errors, setErrors] = useState<Record<string, string>>({}),
    summary = useRef<HTMLDivElement>(null);
  function change<K extends keyof QuoteFields>(key: K, value: QuoteFields[K]) {
    setF((old) => ({ ...old, [key]: value }));
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const v = quoteBody(f);
    if (!v.ok) {
      setErrors(v.errors);
      requestAnimationFrame(() => summary.current?.focus());
      return;
    }
    setErrors({});
    await onSave(v.input);
  }
  return (
    <form onSubmit={(e) => void submit(e)} noValidate aria-label="Shop quote check">
      <h2>Check a shop quote</h2>
      <p>
        Enter what the shop quoted. A typed product name is unverified; it does not establish
        fitment, climate suitability or a comparable installed total.
      </p>
      {Object.keys(errors).length ? (
        <div id="quote-quote" ref={summary} tabIndex={-1} role="alert" className="callout error">
          <p>Review the quote:</p>
          <ul>
            {Object.entries(errors).map(([key, message]) => (
              <li key={key}>
                <a
                  href={'#quote-' + key}
                  onClick={(e) => {
                    e.preventDefault();
                    document.getElementById('quote-' + key)?.focus();
                  }}
                >
                  {message}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <fieldset disabled={busy}>
        <legend>Quoted product and price</legend>
        <div className="form-grid">
          <Field
            id="quote-product"
            label="Quoted tire product"
            value={f.product}
            maxLength={200}
            error={errors.product}
            onChange={(e) => change('product', e.target.value)}
          />
          <Field
            id="quote-shop"
            label="Shop name (private, optional)"
            value={f.shop}
            maxLength={200}
            error={errors.shop}
            onChange={(e) => change('shop', e.target.value)}
          />
          <Field
            id="quote-size"
            label="Quoted size (optional)"
            value={f.size}
            maxLength={80}
            onChange={(e) => change('size', e.target.value)}
          />
          <Field
            id="quote-amount"
            label="Quoted amount (USD)"
            inputMode="decimal"
            value={f.amount}
            error={errors.amount}
            onChange={(e) => change('amount', e.target.value)}
          />
          <div className="field">
            <label htmlFor="quote-quantity">Quoted tire quantity</label>
            <select
              id="quote-quantity"
              aria-describedby={errors.quantity ? 'quote-quantity-error' : undefined}
              aria-invalid={!!errors.quantity}
              value={f.quantity}
              onChange={(e) => change('quantity', e.target.value)}
            >
              <option value="">Choose quantity</option>
              {[1, 2, 4].map((n) => (
                <option key={n} value={n}>
                  {n} tire{n === 1 ? '' : 's'}
                </option>
              ))}
            </select>
            {errors.quantity ? (
              <p className="field-error" id="quote-quantity-error">
                {errors.quantity}
              </p>
            ) : null}
          </div>
          <div className="field">
            <label htmlFor="quote-basis">Price basis</label>
            <select
              id="quote-basis"
              aria-describedby={errors.basis ? 'quote-basis-error' : undefined}
              aria-invalid={!!errors.basis}
              value={f.basis}
              onChange={(e) => change('basis', e.target.value)}
            >
              <option value="">Choose price basis</option>
              <option value="per_tire">Per tire</option>
              <option value="set">Tires-only set</option>
              <option value="installed_set">Installed set</option>
            </select>
            {errors.basis ? (
              <p className="field-error" id="quote-basis-error">
                {errors.basis}
              </p>
            ) : null}
          </div>
          <Field
            id="quote-observedOn"
            label="Quote date"
            type="date"
            value={f.observedOn}
            error={errors.observedOn}
            onChange={(e) => change('observedOn', e.target.value)}
          />
        </div>
        <label className="check-field">
          <input
            type="checkbox"
            checked={f.taxConfirmed}
            onChange={(e) => change('taxConfirmed', e.target.checked)}
          />
          I confirmed the shop's tax basis. Applicable source/tax evidence is still required.
        </label>
        <label className="check-field">
          <input
            type="checkbox"
            checked={f.alignment}
            onChange={(e) => change('alignment', e.target.checked)}
          />
          Include alignment in this cost scenario
        </label>
        <details>
          <summary>Included fees and cost assumptions</summary>
          <p>
            Unknown fees stay unknown. Mark a confirmed zero explicitly. These entries are checked
            by the service; this page does not calculate installed costs or lifetime savings.
          </p>
          {(Object.keys(chargeNames) as (keyof typeof chargeNames)[])
            .filter((k) => k !== 'alignment' || f.alignment)
            .map((k) => {
              const c = f.charges[k];
              function fee(values: Partial<typeof c>) {
                change('charges', { ...f.charges, [k]: { ...c, ...values } });
              }
              return (
                <fieldset key={k}>
                  <legend>{chargeNames[k]}</legend>
                  <div className="form-grid">
                    <div className="field">
                      <label htmlFor={'quote-charge-' + k}>{chargeNames[k]} charge</label>
                      <select
                        id={'quote-charge-' + k}
                        value={c.state}
                        onChange={(e) => fee({ state: e.target.value as typeof c.state })}
                      >
                        <option value="unknown">Unknown</option>
                        <option value="included">Included in quoted amount</option>
                        <option value="extra">Extra amount</option>
                        <option value="zero">Confirmed no charge</option>
                      </select>
                    </div>
                    {c.state === 'extra' ? (
                      <>
                        <Field
                          id={'quote-extra-' + k}
                          label={chargeNames[k] + ' extra (USD)'}
                          inputMode="decimal"
                          value={c.amount}
                          error={errors['extra-' + k]}
                          onChange={(e) => fee({ amount: e.target.value })}
                        />
                        <div className="field">
                          <label htmlFor={'quote-fee-basis-' + k}>
                            {chargeNames[k]} extra basis
                          </label>
                          <select
                            id={'quote-fee-basis-' + k}
                            value={c.basis}
                            onChange={(e) => fee({ basis: e.target.value as typeof c.basis })}
                          >
                            <option value="per_order">Per order</option>
                            <option value="per_tire">Per tire</option>
                            <option value="per_axle">Per axle</option>
                          </select>
                        </div>
                      </>
                    ) : null}
                  </div>
                </fieldset>
              );
            })}
        </details>
      </fieldset>
      <Button type="submit" busy={busy}>
        Save and check quote
      </Button>
    </form>
  );
}
