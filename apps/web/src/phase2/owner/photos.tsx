import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  photoFieldInput,
  type photoStatusView,
} from '../../../../../packages/contracts/src/phase2-analysis.ts';
import type { photoOptionsView } from '../../../../../packages/contracts/src/phase2-photo-presentation-client.ts';
import { z } from '../../../../../packages/contracts/src/phase2-wire.ts';
import type { Workspace } from '../workbench.tsx';
import { CandidateField } from './photo-fields.tsx';
import type { OwnerClients } from './types.ts';
import { photoFile, type ConfirmedSizeApplication } from './photo-forms.ts';
import { recoverMissingPhoto } from './photo-read.ts';
type Status = z.output<typeof photoStatusView>;
type Options = z.output<typeof photoOptionsView>;
type Prepared = {
  bytes: Uint8Array;
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  sha256: string;
  name: string;
};
export function PhotoPanel({
  w,
  onApply,
}: {
  w: Workspace<OwnerClients>;
  onApply: (v: ConfirmedSizeApplication) => void;
}) {
  const [options, setOptions] = useState<Options | null>(null),
    [allowed, setAllowed] = useState(false),
    [file, setFile] = useState<Prepared | null>(null),
    [batch, setBatch] = useState<string | null>(null),
    [intent, setIntent] = useState<{ id: string; grant: string } | null>(null),
    [status, setStatus] = useState<Status | null>(null),
    [message, setMessage] = useState(
      'Photo processing is optional. Continue with manual entry below.',
    ),
    [preparing, setPreparing] = useState(false),
    [inputKey, setInputKey] = useState(0);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const blocked = w.busy || w.blocked || preparing;
  const reading = w.busy || preparing;
  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(
      () => {
        generation.current++;
        setStatus(null);
        setIntent(null);
        setFile(null);
        setBatch(null);
        setPreparing(false);
        setInputKey((v) => v + 1);
        setMessage(
          'Photo expired. Private readings have been cleared; your assessment answers are retained. Continue manually or retake.',
        );
      },
      Math.min(2147483647, Math.max(0, Date.parse(status.expiresAt) - Date.now())),
    );
    return () => clearTimeout(timer);
  }, [status?.id, status?.expiresAt]);
  function clearPhoto(text: string) {
    setIntent(null);
    setStatus(null);
    setFile(null);
    setBatch(null);
    setInputKey((v) => v + 1);
    setMessage(text);
  }
  function received(value: Status) {
    if (
      ['deleted', 'deleting'].includes(value.state) ||
      Date.parse(value.expiresAt) <= Date.now()
    ) {
      clearPhoto(
        'Photo removed or expired. Your assessment answers are retained; continue manually or retake.',
      );
      return;
    }
    setStatus(value);
    setMessage(
      'Current photo state: ' + value.state + '. No suggestions have been applied automatically.',
    );
  }
  async function choose(e: ChangeEvent<HTMLInputElement>) {
    const selected = e.currentTarget.files?.[0],
      epoch = ++generation.current;
    setFile(null);
    setIntent(null);
    setStatus(null);
    setPreparing(true);
    try {
      if (!selected) return;
      const mime = photoFile(selected, allowed),
        bytes = new Uint8Array(await selected.arrayBuffer());
      if (bytes.byteLength !== selected.size) throw Error('File changed');
      const digest = new Uint8Array(
        await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer),
      );
      if (epoch !== generation.current) return;
      setFile({
        bytes,
        mime,
        sha256: Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join(''),
        name: selected.name,
      });
      setMessage(
        'File prepared locally. Create an upload intent and explicitly upload it; no extraction has started.',
      );
    } catch {
      if (epoch === generation.current)
        setMessage(
          'Choose a JPEG, PNG or WebP up to 10 MiB after allowing processing. Use a clear, close sidewall photo without unrelated personal details, or enter manually.',
        );
    } finally {
      if (epoch === generation.current) setPreparing(false);
    }
  }
  const refresh = (upload: string) =>
    w.read(
      'Photo status',
      () =>
        recoverMissingPhoto(
          async () => (await w.client.analysis.p2PhotoStatus({ path: { upload } })).data,
        ),
      (r) =>
        r.missing
          ? clearPhoto('Photo is unavailable or expired. Assessment answers are retained.')
          : received(r.value),
    );
  const confirmed = status?.confirmations.find((c) => c.field === 'tire_size');
  return (
    <section className="p2-photo" aria-label="Optional tire photo">
      <h3>Optional tire photo</h3>
      <p>
        Photograph readable sidewall text in good light. Retake blurred or cropped markings.
        Extraction does not inspect tire safety, fitment or recall status. A partial DOT/TIN cannot
        clear a recall.
      </p>
      <button
        type="button"
        disabled={reading}
        onClick={() =>
          void w.read(
            'Photo options',
            async () => (await w.client.photos.p2PhotoOptions({})).data,
            (v) => {
              setOptions(v);
              setAllowed(false);
              clearPhoto('Current purpose notice loaded. Processing is off until you choose it.');
            },
          )
        }
      >
        Check photo options and recent uploads
      </button>
      {options ? (
        <>
          <p>{options.processing.notice}</p>
          <p>
            Notice {options.processing.noticeVersion} · checked{' '}
            {new Date(options.checkedAt).toLocaleString()}
          </p>
          {!options.processing.available ? (
            <p>
              Processing is unavailable. Continue with manual entry; prior owned uploads may still
              be read or removed.
            </p>
          ) : null}
          <label>
            <input
              type="checkbox"
              checked={allowed}
              disabled={blocked || !options.processing.available}
              onChange={(e) => {
                setAllowed(e.target.checked);
                if (!e.target.checked) {
                  generation.current++;
                  setPreparing(false);
                  setFile(null);
                  setInputKey((v) => v + 1);
                }
              }}
            />
            I allow this optional photo to be processed under the displayed notice.
          </label>
          <label>
            Choose or capture a sidewall photo
            <input
              key={inputKey}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              disabled={blocked || !allowed || !options.processing.available}
              onChange={(e) => void choose(e)}
            />
          </label>
          {preparing || w.busy ? <progress aria-label="Photo operation in progress" /> : null}
          {file ? (
            <p>
              Prepared: {file.name} · {file.bytes.byteLength.toLocaleString()} bytes. No percentage
              is estimated; server scanning/quality checks follow upload.
            </p>
          ) : null}
          <div className="staff-toolbar">
            <button
              type="button"
              disabled={blocked || !allowed || !file || !!batch || !options.processing.policyId}
              onClick={() =>
                void w.command(
                  'Start photo capture',
                  async (command) =>
                    (
                      await w.client.analysis.p2PhotoCapture({
                        body: { policyId: options.processing.policyId! },
                        command,
                      })
                    ).data,
                  (v) => setBatch(v.batchId),
                )
              }
            >
              Start capture batch
            </button>
            <button
              type="button"
              disabled={
                blocked || !allowed || !file || !batch || !!intent || !options.processing.policyId
              }
              onClick={() =>
                void w.command(
                  'Create photo upload',
                  async (command) =>
                    (
                      await w.client.analysis.p2PhotoIntent({
                        body: {
                          allowed: true,
                          batchId: batch!,
                          policyId: options.processing.policyId!,
                          mime: file!.mime,
                          size: file!.bytes.byteLength,
                          sha256: file!.sha256,
                          noticeVersion: options.processing.noticeVersion,
                        },
                        command,
                      })
                    ).data,
                  (v) => {
                    if (v.state === 'manual')
                      clearPhoto('Processing admission is unavailable. Continue manually.');
                    else {
                      setIntent({ id: v.id, grant: v.grant });
                      setMessage('Upload intent recorded. Explicitly upload the prepared file.');
                    }
                  },
                )
              }
            >
              Create upload intent
            </button>
            <button
              type="button"
              disabled={blocked || !allowed || !file || !intent || status !== null}
              onClick={() =>
                void w.command(
                  'Upload and check photo',
                  async (command) =>
                    recoverMissingPhoto(
                      async () =>
                        (
                          await w.client.analysis.p2PhotoFinalize({
                            path: { upload: intent!.id },
                            bytes: file!.bytes,
                            grant: intent!.grant,
                            command,
                          })
                        ).data,
                    ),
                  (v) => {
                    setFile(null);
                    setIntent(null);
                    if (v.missing)
                      clearPhoto(
                        'Upload expired. Retake or enter manually; your assessment is retained.',
                      );
                    else received(v.value);
                  },
                )
              }
            >
              Upload and check photo
            </button>
          </div>
          <h4>Recent owned uploads</h4>
          <p>
            Up to 25 items per page. No private image URLs are exposed. Refresh explicitly to
            reauthorize current state.
          </p>
          <ul>
            {options.items.map((i) => (
              <li key={i.id}>
                <button
                  type="button"
                  disabled={reading}
                  onClick={() => {
                    setIntent(null);
                    setFile(null);
                    void refresh(i.id);
                  }}
                >
                  {i.id} · {i.state}
                </button>{' '}
                · expires {new Date(i.expiresAt).toLocaleString()}
              </li>
            ))}
          </ul>
          {options.next ? (
            <button
              type="button"
              disabled={reading}
              onClick={() =>
                void w.read(
                  'More owned photos',
                  async () =>
                    (await w.client.photos.p2PhotoOptions({ query: { after: options.next! } }))
                      .data,
                  setOptions,
                )
              }
            >
              Next owned uploads
            </button>
          ) : null}
        </>
      ) : null}
      <p role="status" aria-live="polite">
        {message}
      </p>
      {status ? (
        <>
          <p>
            Photo {status.id} · {status.state} · expires{' '}
            {new Date(status.expiresAt).toLocaleString()}. DOT/TIN:{' '}
            {status.dotStatus.replaceAll('_', ' ')}; even a full reading is unverified.
          </p>
          <p>
            Confirm each reading separately. Unknown and conflicting values stay unknown until you
            check them. No condition assessment or fitment clearance is provided.
          </p>
          <div className="staff-toolbar">
            <button type="button" disabled={reading} onClick={() => void refresh(status.id)}>
              Refresh selected photo
            </button>
            <button
              type="button"
              disabled={blocked || !allowed || !['ready', 'complete'].includes(status.state)}
              onClick={() =>
                void w.command(
                  'Request photo extraction',
                  async (command) =>
                    recoverMissingPhoto(
                      async () =>
                        (
                          await w.client.analysis.p2PhotoExtract({
                            path: { upload: status.id },
                            body: {},
                            command,
                          })
                        ).data,
                    ),
                  (v) => {
                    if (v.missing) clearPhoto('Photo expired; continue manually.');
                    else {
                      setMessage(
                        'Extraction ' + v.value.state + '. Refresh explicitly to read suggestions.',
                      );
                      setStatus({
                        ...status,
                        state: 'processing',
                        candidates: [],
                        confirmations: [],
                      });
                    }
                  },
                )
              }
            >
              Request text extraction
            </button>
            <button
              type="button"
              disabled={blocked}
              onClick={() => {
                const upload = status.id;
                setStatus(null);
                void w.command(
                  'Remove photo',
                  async (command) =>
                    recoverMissingPhoto(
                      async () =>
                        (
                          await w.client.analysis.p2PhotoDelete({
                            path: { upload },
                            body: {},
                            command,
                          })
                        ).data,
                    ),
                  (v) =>
                    clearPhoto(
                      v.missing
                        ? 'Photo already unavailable. Assessment answers retained.'
                        : 'Removal registered; cleanup remains pending. Assessment answers retained.',
                    ),
                );
              }}
            >
              Remove selected photo
            </button>
            <button
              type="button"
              disabled={blocked}
              onClick={() =>
                clearPhoto(
                  'Retake or enter manually. Prior upload is not deleted; select it from recent uploads to remove it.',
                )
              }
            >
              Retake / continue manually
            </button>
          </div>
          <div className="p2-grid">
            {photoFieldInput.options.map((field) => (
              <CandidateField
                key={
                  status.id +
                  ':' +
                  field +
                  ':' +
                  status.candidates
                    .filter((c) => c.field === field)
                    .map((c) => c.id)
                    .join(':')
                }
                field={field}
                status={status}
                w={w}
                onConfirmed={received}
              />
            ))}
          </div>
          {confirmed ? (
            <div className="p2-warning">
              <p>
                Confirmed tire size: {confirmed.value}. Applying is a separate explicit choice and
                does not verify fitment.
              </p>
              {(['front', 'rear'] as const).map((axle) => (
                <button
                  type="button"
                  key={axle}
                  disabled={blocked}
                  onClick={() => {
                    onApply({
                      key: status.id + ':' + confirmed.revision + ':' + crypto.randomUUID(),
                      axle,
                      value: confirmed.value,
                    });
                    setMessage(
                      'Confirmed size applied to ' +
                        axle +
                        ' only. Check both axle sizes and the vehicle placard.',
                    );
                  }}
                >
                  Apply confirmed size to {axle}
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
