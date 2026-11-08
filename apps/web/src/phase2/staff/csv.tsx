import { p2Uuid } from '../../../../../packages/contracts/src/phase2-wire.ts';
import { useState } from 'react';
import { ActionForm, Field } from '../workbench.tsx';
import { text, uploadBytes } from '../partner/forms.ts';
import { csvMetadata, templateInput } from './forms.ts';
import { CsvDownload } from './download.tsx';
import type { StaffWorkspace, StaffClients } from './types.ts';
type Csv = StaffClients['csv'];
type Schema = Awaited<ReturnType<Csv['p2CsvSchema']>>['data'];
type Status = Awaited<ReturnType<Csv['p2CsvStatus']>>['data'];
type Preview = Awaited<ReturnType<Csv['p2CsvPreview']>>['data'];
type Review = Awaited<ReturnType<Csv['p2CsvReview']>>['data'];
export function CsvPanel({ w }: { w: StaffWorkspace }) {
  const [template, setTemplate] = useState(''),
    [schema, setSchema] = useState<Schema | null>(null),
    [intake, setIntake] = useState(''),
    [status, setStatus] = useState<Status | null>(null),
    [preview, setPreview] = useState<Preview | null>(null),
    [review, setReview] = useState<Review | null>(null),
    [errors, setErrors] = useState<{ csv: string; filename: string } | null>(null),
    [receipt, setReceipt] = useState<{ id: string; publicationBundleId: string } | null>(null),
    [note, setNote] = useState('Upload and validate before capturing immutable review evidence.');
  const disabled = w.busy || w.blocked,
    path = { intake };
  const clear = () => {
    setStatus(null);
    setPreview(null);
    setReview(null);
    setErrors(null);
    setReceipt(null);
  };
  return (
    <>
      <section className="staff-card">
        <h2>CSV publication workspace</h2>
        <p>{note}</p>
        <p>
          Use the installed mapping and the approved source/license references. Uploading never
          publishes. An independent reviewer approves immutable evidence; a current publisher
          commits it. No uploaded code or arbitrary field mapping is executed.
        </p>
      </section>
      <div className="p2-grid">
        <ActionForm
          title="Create installed template"
          disabled={disabled}
          action={(f) =>
            w.command(
              'Template creation',
              (c) => w.client.csv.p2CsvTemplate({ body: templateInput(f), command: c }),
              (r) => {
                setTemplate(r.data.id);
                setSchema(null);
                setNote(
                  'Template created. Read its columns and download the header before uploading.',
                );
              },
            )
          }
        >
          <Field
            name="mapping"
            label="Installed mapping"
            options={['tire_models_v1', 'domain_companies_v1']}
          />
          <Field name="version" label="Template version" type="number" min="1" value="1" required />
          <Field
            name="maxRows"
            label="Maximum rows"
            type="number"
            min="1"
            max="100000"
            value="100000"
            required
          />
          <Field
            name="maxBytes"
            label="Maximum bytes"
            type="number"
            min="1"
            max="16777216"
            value="16777216"
            required
          />
        </ActionForm>
        <ActionForm
          title="Read template and download header"
          disabled={w.busy}
          action={(f) =>
            w.read(
              'Template schema',
              () => w.client.csv.p2CsvSchema({ path: { template: text(f, 'template') } }),
              (r) => {
                setTemplate(r.data.template.id);
                setSchema(r.data);
              },
            )
          }
        >
          <Field name="template" label="Template reference" value={template} required />
          {schema ? (
            <>
              <p>
                {schema.template.key} · version{schema.template.version} · {schema.template.state}
              </p>
              <p>
                Bound: {schema.template.maxRows} rows / {schema.template.maxBytes} bytes.
              </p>
              <ul>
                {schema.template.columns.map((c) => (
                  <li key={c.name}>
                    {c.name}: {c.type}
                    {c.required ? ' · required' : ' · optional'}
                    {c.unit ? ' · ' + c.unit : ''}
                  </li>
                ))}
              </ul>
              <CsvDownload
                csv={schema.csv}
                filename={schema.filename}
                label="Download CSV template"
              />
            </>
          ) : null}
        </ActionForm>
        <ActionForm
          key={template || 'upload'}
          title="Upload private CSV"
          disabled={disabled}
          action={(f) =>
            w.command(
              'CSV upload',
              async (c) =>
                w.client.csv.p2CsvUpload({
                  query: csvMetadata(f),
                  bytes: await uploadBytes(f, schema?.template.maxBytes ?? 16777216),
                  command: c,
                }),
              (r) => {
                clear();
                if (r.data.id) setIntake(r.data.id);
                setErrors({ csv: r.data.errors, filename: 'csv-validation-errors.csv' });
                setNote(
                  r.data.id
                    ? 'Upload receipt ' + r.data.id + ' · ' + r.data.phase
                    : 'File refused before intake creation. Correct the safe rejection report and upload again.',
                );
              },
            )
          }
        >
          <Field name="template" label="Upload template reference" value={template} required />
          <Field name="provider" label="Approved provider reference" required />
          <Field name="license" label="Permitted license reference" required />
          <Field
            name="effective"
            label="Source effective time (UTC)"
            type="datetime-local"
            required
          />
          <Field name="externalVersion" label="Upstream version" required />
          <Field name="file" label="Private CSV file (up to16 MB)" type="file" required />
          <p>
            Uploading is shown as busy until an authoritative receipt or reconciliation state is
            available. Reload an existing intake by its receipt; uncertain uploads are never blindly
            repeated.
          </p>
        </ActionForm>
        <ActionForm
          title="Open or refresh an intake"
          disabled={w.busy}
          action={(f) =>
            w.read(
              'Intake status',
              () => w.client.csv.p2CsvStatus({ path: { intake: text(f, 'intake') } }),
              (r) => {
                if (r.data.id !== intake) clear();
                setIntake(r.data.id);
                setStatus(r.data);
              },
            )
          }
        >
          <Field name="intake" label="Intake reference" value={intake} required />
          {status ? (
            <dl className="p2-facts">
              <dt>Phase</dt>
              <dd>{status.phase}</dd>
              <dt>Run</dt>
              <dd>{status.runId ?? 'Not registered'}</dd>
              <dt>Expires</dt>
              <dd>{status.expiresAt}</dd>
              <dt>Published bundle</dt>
              <dd>{status.publicationBundleId ?? 'Not published'}</dd>
            </dl>
          ) : null}
        </ActionForm>
        <ActionForm
          title="Select publication or rollback intake"
          disabled={disabled}
          action={(f) => {
            const id = p2Uuid.parse(text(f, 'publicationIntake'));
            clear();
            setIntake(id);
            setNote(
              'Reference selected. This does not grant status, source, review or publication access. Each operation checks its own current permission.',
            );
          }}
        >
          <Field name="publicationIntake" label="Publication intake reference" required />
          <p>
            Publishers can select the intake on an independently approved review without requesting
            review-only source/status access. Enter the exact reference supplied with that approval.
          </p>
        </ActionForm>
        <ActionForm
          title="Validate or resume preparation"
          disabled={disabled || !intake}
          action={() =>
            w.command(
              'CSV validation',
              (c) => w.client.csv.p2CsvValidate({ path, body: {}, command: c }),
              (r) => {
                setPreview(null);
                setReview(null);
                setErrors({ csv: r.data.errors, filename: 'csv-validation-errors.csv' });
                setNote(
                  'Validation receipt: ' + r.data.phase + '. Refresh current status before review.',
                );
              },
            )
          }
        >
          <p>
            Intake: {intake || 'Open an intake first'}. This uses the same parser and ingestion
            services as scripts. Rejected rows do not become publishable facts.
          </p>
        </ActionForm>
        <ActionForm
          title="Capture current diff and validation"
          disabled={disabled || !intake}
          action={() =>
            w.command(
              'Immutable CSV preview',
              (c) => w.client.csv.p2CsvPreview({ path, body: {}, command: c }),
              (r) => {
                setPreview(r.data);
                setReview(null);
              },
            )
          }
        >
          <p>
            Captures the current publication head, run revision and fence. A changed head requires
            fresh evidence and independent approval.
          </p>
        </ActionForm>
        {preview ? (
          <section className="staff-card">
            <h2>Immutable review evidence</h2>
            <dl className="p2-facts">
              <dt>Preview</dt>
              <dd>{preview.id}</dd>
              <dt>Run revision / fence</dt>
              <dd>
                {preview.runRevision} / {preview.fence}
              </dd>
              <dt>Expected head</dt>
              <dd>
                {preview.head
                  ? preview.head.bundleId + ' · ' + preview.head.revision
                  : 'No prior publication'}
              </dd>
              <dt>Expires</dt>
              <dd>{preview.expiresAt}</dd>
              <dt>Accepted / rejected</dt>
              <dd>
                {preview.evidence.validation.accepted} / {preview.evidence.validation.rejected}
              </dd>
              <dt>Mapping template / parser</dt>
              <dd>
                {preview.evidence.validation.templateId} /{' '}
                {preview.evidence.validation.parserRevision}
              </dd>
            </dl>
            <ul>
              {preview.evidence.changes.map((c) => (
                <li key={c.kind}>
                  {c.kind}: +{c.added} / −{c.removed} / changed {c.changed}
                </li>
              ))}
            </ul>
            <p>
              {preview.complete
                ? 'Complete immutable evidence'
                : 'Incomplete evidence — do not approve'}
            </p>
          </section>
        ) : null}
        <ActionForm
          title="Independently review this evidence"
          disabled={disabled || !intake}
          action={(f) =>
            w.command(
              'CSV independent review',
              (c) =>
                w.client.csv.p2CsvReview({
                  path,
                  body: {
                    previewId: text(f, 'preview'),
                    decision: text(f, 'decision') as 'approved' | 'rejected',
                    reason: text(f, 'reason'),
                  },
                  command: c,
                }),
              (r) => {
                setReview(r.data);
                setNote(
                  'Review committed: ' +
                    r.data.decision +
                    '. Give its reference to the current publisher.',
                );
              },
            )
          }
        >
          <Field
            name="preview"
            label="Exact preview reference"
            value={preview?.id ?? ''}
            required
          />
          <Field name="decision" label="Decision" options={['rejected', 'approved']} />
          <Field name="reason" label="Reason code" required />
          <label>
            <input type="checkbox" required />I independently reviewed this exact diff and
            validation evidence.
          </label>
          {review ? (
            <p>
              Review reference: <code>{review.id}</code> · {review.decision} · expected head
              revision{review.expectedHead}
            </p>
          ) : null}
        </ActionForm>
        <ActionForm
          title="Publish approved review"
          disabled={disabled || !intake}
          action={(f) =>
            w.command(
              'CSV publication',
              (c) =>
                w.client.csv.p2CsvPublish({
                  path,
                  body: { reviewId: text(f, 'review') },
                  command: c,
                }),
              () => {
                setPreview(null);
                setReview(null);
                setNote(
                  'Publication committed. Read the durable publication receipt; this browser acknowledgement is not a provider/source acceptance.',
                );
              },
            )
          }
        >
          <Field
            name="review"
            label="Approved review reference"
            value={review?.decision === 'approved' ? review.id : ''}
            required
          />
          <label>
            <input type="checkbox" required />I am the current publisher and checked the independent
            approval and publication head.
          </label>
          <p>
            Stale heads and self-approval are refused by the service. Reconcile a conflict, then
            reconnect and capture fresh evidence; do not repeat an uncertain effect with a new key.
          </p>
        </ActionForm>
        <ActionForm
          title="Read publication receipt"
          disabled={w.busy || !intake}
          action={() =>
            w.read(
              'Publication receipt',
              () => w.client.csv.p2CsvReceipt({ path }),
              (r) => setReceipt(r.data),
            )
          }
        >
          {receipt ? (
            <p>
              Intake {receipt.id} · committed bundle <code>{receipt.publicationBundleId}</code>
            </p>
          ) : (
            <p>A durable receipt is available only after committed publication.</p>
          )}
        </ActionForm>
        <ActionForm
          title="Read safe rejection report"
          disabled={w.busy || !intake}
          action={() =>
            w.read(
              'CSV rejection report',
              () => w.client.csv.p2CsvErrors({ path }),
              (r) => setErrors(r.data),
            )
          }
        >
          <p>
            Reports contain bounded, spreadsheet-safe validation explanations, not raw private
            source cells.
          </p>
        </ActionForm>
        {errors ? (
          <section className="staff-card">
            <h2>Validation explanations</h2>
            <pre className="p2-preview" tabIndex={0}>
              {errors.csv || 'No row explanations returned.'}
            </pre>
            <CsvDownload
              csv={errors.csv}
              filename={errors.filename}
              label="Download safe rejection report"
            />
          </section>
        ) : null}
        <ActionForm
          title="Cancel intake"
          disabled={disabled || !intake}
          action={() =>
            w.command(
              'CSV cancellation',
              (c) => w.client.csv.p2CsvCancel({ path, body: {}, command: c }),
              () => {
                clear();
                setNote('Cancellation committed. Read current status.');
              },
            )
          }
        >
          <label>
            <input type="checkbox" required />
            Cancel this intake; this does not roll back an existing publication.
          </label>
        </ActionForm>
        <ActionForm
          title="Rollback with existing independent approval"
          disabled={disabled || !intake}
          action={(f) =>
            w.command(
              'CSV rollback',
              (c) =>
                w.client.csv.p2CsvRollback({
                  path,
                  body: {
                    bundleId: text(f, 'bundle'),
                    expectedBundleId: text(f, 'expectedBundle'),
                    expected: text(f, 'expectedRevision'),
                    approvalId: text(f, 'approval'),
                  },
                  command: c,
                }),
              () => {
                clear();
                setNote(
                  'Rollback acknowledgement received. Refresh the authoritative publication state.',
                );
              },
            )
          }
        >
          <Field name="bundle" label="Rollback target bundle" required />
          <Field name="expectedBundle" label="Current publication bundle" required />
          <Field name="expectedRevision" label="Current publication revision" required />
          <Field name="approval" label="Pre-recorded independent rollback approval" required />
          <label>
            <input type="checkbox" required />I checked the current head, approved target and
            permitted publisher role.
          </label>
          <p>
            This screen cannot create a rollback approval or bypass current source/license and
            publication checks.
          </p>
        </ActionForm>
      </div>
    </>
  );
}
