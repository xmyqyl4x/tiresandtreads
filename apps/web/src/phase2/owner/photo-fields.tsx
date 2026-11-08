import { useState } from 'react';
import type { photoStatusView } from '../../../../../packages/contracts/src/phase2-analysis.ts';
import type { z } from '../../../../../packages/contracts/src/phase2-wire.ts';
import { ActionForm, Field, type Workspace } from '../workbench.tsx';
import type { OwnerClients } from './types.ts';
import { confirmationInput } from './photo-forms.ts';
import { recoverMissingPhoto } from './photo-read.ts';
type Status = z.output<typeof photoStatusView>;
const labels = {
  brand: 'Brand',
  model: 'Model',
  tire_size: 'Tire size',
  load_index: 'Load index',
  speed_rating: 'Speed rating',
  dot_tin: 'DOT / TIN',
  date_code: 'Date code',
  seasonal_marking: 'Seasonal marking',
  run_flat_marking: 'Run-flat marking',
} as const;
export function CandidateField({
  field,
  status,
  w,
  onConfirmed,
}: {
  field: keyof typeof labels;
  status: Status;
  w: Workspace<OwnerClients>;
  onConfirmed: (s: Status) => void;
}) {
  const candidates = status.candidates.filter((c) => c.field === field),
    confirmed = status.confirmations.find((c) => c.field === field),
    [candidate, setCandidate] = useState(candidates.find((c) => c.value !== null)?.id ?? 'manual');
  const distinct = new Set(candidates.map((c) => c.value).filter((v) => v !== null));
  return (
    <ActionForm
      title={labels[field]}
      disabled={w.busy || w.blocked}
      action={async (f) => {
        const body = confirmationInput(f, field, confirmed?.revision ?? null);
        await w.command(
          'Confirm ' + labels[field],
          async (command) =>
            recoverMissingPhoto(
              async () =>
                (
                  await w.client.analysis.p2PhotoConfirm({
                    path: { upload: status.id },
                    body,
                    command,
                  })
                ).data,
            ),
          (r) => {
            if (r.missing) {
              onConfirmed({ ...status, state: 'deleted', candidates: [], confirmations: [] });
              return;
            }
            onConfirmed({
              ...status,
              confirmations: [...status.confirmations.filter((c) => c.field !== field), r.value],
            });
          },
        );
      }}
    >
      <p>
        {distinct.size > 1
          ? 'Conflicting readings: compare the sidewall and correct explicitly.'
          : candidates.length
            ? 'Suggestions only; check the actual sidewall.'
            : 'Unknown: no supported visible reading. Enter manually if you can check it.'}
      </p>
      {candidates.map((c) => (
        <p key={c.id}>
          Reading {c.ordinal + 1}: {c.value ?? 'unknown'} · {c.quality}
          {c.unknownReason ? ' · ' + c.unknownReason.replaceAll('_', ' ') : ''}
          {c.rawText ? ' · visible text: ' + c.rawText : ''}
        </p>
      ))}
      <label>
        Reading to confirm or correct
        <select name="candidate" value={candidate} onChange={(e) => setCandidate(e.target.value)}>
          <option value="manual">Manual entry</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id} disabled={c.value === null}>
              {c.value ?? 'Unknown reading'} · {c.quality}
            </option>
          ))}
        </select>
      </label>
      <Field
        key={(confirmed?.revision ?? 'none') + ':' + candidate}
        name="value"
        label={'Checked ' + labels[field].toLowerCase()}
        value={confirmed?.value ?? candidates.find((c) => c.id === candidate)?.value ?? ''}
        required
      />
      {confirmed ? (
        <p>
          Confirmed revision {confirmed.revision}: <strong>{confirmed.value}</strong> ·{' '}
          {confirmed.origin.replaceAll('_', ' ')} ·{' '}
          {new Date(confirmed.confirmedAt).toLocaleString()}
        </p>
      ) : (
        <p>Not confirmed. This field has not changed your assessment.</p>
      )}
    </ActionForm>
  );
}
