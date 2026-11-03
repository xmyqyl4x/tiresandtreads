import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
export function Button({
  tone = 'primary',
  busy = false,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: 'primary' | 'secondary' | 'danger';
  busy?: boolean;
}) {
  return (
    <button
      {...props}
      type={props.type ?? 'button'}
      className={'button ' + tone + (props.className ? ' ' + props.className : '')}
      disabled={props.disabled || busy}
      aria-busy={busy}
    >
      {busy ? 'Working…' : children}
    </button>
  );
}
export function Field({
  id,
  label,
  hint,
  error,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  hint?: string;
  error?: string;
}) {
  const descriptions = [hint ? id + '-hint' : null, error ? id + '-error' : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {props.required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {hint ? (
        <p className="hint" id={id + '-hint'}>
          {hint}
        </p>
      ) : null}
      <input
        {...props}
        id={id}
        aria-invalid={!!error}
        aria-describedby={descriptions || undefined}
      />
      {error ? (
        <p className="field-error" id={id + '-error'}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
export function Callout({
  title,
  children,
  tone = 'info',
}: {
  title: string;
  children: ReactNode;
  tone?: 'info' | 'warning' | 'error' | 'success';
}) {
  return (
    <section
      className={'callout ' + tone}
      aria-label={title}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <h3>{title}</h3>
      {children}
    </section>
  );
}
export function ReservedHouseSlot() {
  return (
    <aside className="house-slot" aria-label="House content">
      <p className="eyebrow">From Tires &amp; Tread</p>
      <h3>A clearer path to your next set.</h3>
      <p>Reviewed tire guides will appear here as they become available.</p>
    </aside>
  );
}
