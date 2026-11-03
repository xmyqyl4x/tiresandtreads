'use client';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from './controls.tsx';
import { definiteRefusal } from '../command-attempts.ts';
import type { BrowserChoices, loadChoices } from '../consent-gateway.ts';
const empty: BrowserChoices = { analytics: false, ads: false, targeted_ads: false };
type Gateway = Awaited<ReturnType<typeof loadChoices>>;
export function PrivacyChoices() {
  const id = useId(),
    dialog = useRef<HTMLDialogElement>(null),
    sequence = useRef(0),
    saving = useRef(false),
    saved = useRef<HTMLParagraphElement>(null),
    error = useRef<HTMLDivElement>(null),
    retry = useRef<BrowserChoices | null>(null);
  const [gateway, setGateway] = useState<Gateway | null>(null),
    [choices, setChoices] = useState(empty),
    [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'saved' | 'error'>('loading'),
    [gpc, setGpc] = useState(false),
    [uncertain, setUncertain] = useState(false);
  async function open() {
    if (saving.current) return;
    const generation = ++sequence.current,
      detected =
        (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
    if (!dialog.current?.open) dialog.current?.showModal();
    setStatus('loading');
    setGateway(null);
    setGpc(detected);
    setUncertain(false);
    retry.current = null;
    try {
      const api = await import('../consent-gateway.ts'),
        loaded = await api.loadChoices(location.origin);
      if (generation !== sequence.current) return;
      setGateway(loaded);
      setChoices({ ...loaded.current, targeted_ads: loaded.current.targeted_ads && !detected });
      setStatus('ready');
    } catch {
      if (generation === sequence.current) {
        setStatus('error');
        requestAnimationFrame(() => error.current?.focus());
      }
    }
  }
  function close() {
    if (saving.current) return;
    sequence.current++;
    dialog.current?.close();
  }
  async function save(next: BrowserChoices) {
    if (!gateway || saving.current) return;
    saving.current = true;
    setStatus('saving');
    const generation = sequence.current,
      snapshot = { ...next, targeted_ads: next.targeted_ads && !gpc };
    retry.current = snapshot;
    try {
      const result = await gateway.save(snapshot, gpc);
      if (generation === sequence.current) {
        retry.current = null;
        setUncertain(false);
        setChoices({ ...result, targeted_ads: result.targeted_ads && !gpc });
        setStatus('saved');
        requestAnimationFrame(() => saved.current?.focus());
      }
    } catch (e) {
      if (generation === sequence.current) {
        setUncertain(!definiteRefusal(e));
        if (definiteRefusal(e)) retry.current = null;
        setStatus('error');
        requestAnimationFrame(() => error.current?.focus());
      }
    } finally {
      saving.current = false;
    }
  }
  function cycleFocus(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab') return;
    const controls = Array.from(
        event.currentTarget.querySelectorAll<HTMLElement>(
          'button:not([disabled]),input:not([disabled]),select:not([disabled]),a[href],[tabindex="0"]',
        ),
      ).filter((e) => e.getClientRects().length > 0),
      first = controls[0],
      last = controls.at(-1),
      active = document.activeElement;
    if (!first || !last) return;
    if (event.shiftKey && (active === first || !controls.includes(active as HTMLElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !controls.includes(active as HTMLElement))) {
      event.preventDefault();
      first.focus();
    }
  }
  return (
    <>
      <button type="button" className="text-button" onClick={() => void open()}>
        Privacy choices
      </button>
      <dialog
        ref={dialog}
        className="privacy-dialog"
        onKeyDown={cycleFocus}
        aria-labelledby={id + '-title'}
        aria-describedby={id + '-description'}
        onCancel={(event) => {
          if (saving.current) event.preventDefault();
          else sequence.current++;
        }}
      >
        <div className="dialog-heading">
          <h2 id={id + '-title'}>Your privacy choices</h2>
          <Button tone="secondary" disabled={status === 'saving'} onClick={close}>
            Close
          </Button>
        </div>
        <p id={id + '-description'}>
          Essential storage keeps your session and choices working. Optional permissions stay off
          until you choose. This preview loads no advertising or analytics services.
        </p>
        <p className="hint">
          Essential storage: always on. Identity sharing: off. Email report and offers choices are
          separate.
        </p>
        {gpc ? (
          <p className="callout warning">
            Global Privacy Control is on. Targeted advertising stays off. Saving acknowledges this
            signal; it does not change email permissions.
          </p>
        ) : null}
        {status === 'loading' ? <p role="status">Loading your current choices…</p> : null}
        {status === 'error' ? (
          <div role="alert" ref={error} tabIndex={-1}>
            <p>
              We could not confirm your current choices. Optional services remain off in this
              preview.
            </p>
            {uncertain && retry.current ? (
              <Button tone="secondary" onClick={() => void save(retry.current!)}>
                Retry unchanged choices
              </Button>
            ) : null}
            <Button tone="secondary" onClick={() => void open()}>
              Reload choices
            </Button>
          </div>
        ) : null}
        {gateway && status !== 'error' ? (
          <>
            <fieldset disabled={status === 'saving'}>
              <legend>Optional permissions</legend>
              {(['analytics', 'ads', 'targeted_ads'] as const).map((p) => (
                <label className="check-field" key={p}>
                  <input
                    type="checkbox"
                    checked={choices[p]}
                    disabled={p === 'targeted_ads' && gpc}
                    onChange={(e) => setChoices((v) => ({ ...v, [p]: e.target.checked }))}
                  />
                  <span>
                    {p === 'analytics'
                      ? 'Usage analytics'
                      : p === 'ads'
                        ? 'Advertising'
                        : 'Targeted advertising'}
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="actions">
              <Button tone="secondary" busy={status === 'saving'} onClick={() => void save(empty)}>
                Reject optional
              </Button>
              <Button busy={status === 'saving'} onClick={() => void save(choices)}>
                Save choices
              </Button>
            </div>
          </>
        ) : null}
        {status === 'saved' ? (
          <p ref={saved} tabIndex={-1} role="status" className="saved-message">
            Your choices are saved.
          </p>
        ) : null}
      </dialog>
    </>
  );
}
