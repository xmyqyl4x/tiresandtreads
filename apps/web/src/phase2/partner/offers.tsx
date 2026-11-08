import { useState } from 'react';
import { ActionForm, Field, Receipt } from '../workbench.tsx';
import { offerDraft, simulation, text, optional, uploadBytes, utcDate } from './forms.ts';
import type { PartnerClient, PartnerWorkspace } from './types.ts';
type Draft = Awaited<ReturnType<PartnerClient['p2OfferDraft']>>['data'];
type Simulated = Awaited<ReturnType<PartnerClient['p2Simulate']>>['data'];
type ImportStatus = Awaited<ReturnType<PartnerClient['p2ImportStatus']>>['data'];
export function OffersPanel({ w, org }: { w: PartnerWorkspace; org: string }) {
  const [offer, setOffer] = useState(''),
    [version, setVersion] = useState('1'),
    [draft, setDraft] = useState<Draft | null>(null),
    [preview, setPreview] = useState<string | null>(null),
    [simulated, setSimulated] = useState<Simulated | null>(null),
    [stage, setStage] = useState('Load a saved offer reference or create a new draft.'),
    [pool, setPool] = useState(''),
    [asset, setAsset] = useState<string | null>(null),
    [logo, setLogo] = useState<string | null>(null),
    [job, setJob] = useState<ImportStatus | null>(null),
    [stats, setStats] = useState<{ total: number; available: number; low: boolean } | null>(null),
    [errors, setErrors] = useState<{ csv: string; truncated: boolean } | null>(null);
  const disabled = w.busy || w.blocked,
    path = { org, offer };
  return (
    <>
      <section className="staff-card">
        <h2>Offers and code inventory</h2>
        <p>{stage}</p>
        <div className="staff-fields">
          <label>
            Saved offer reference
            <input
              value={offer}
              onChange={(e) => {
                setOffer(e.target.value);
                setDraft(null);
                setPreview(null);
                setSimulated(null);
              }}
              maxLength={36}
            />
          </label>
          <label>
            Offer version
            <input
              type="number"
              min="1"
              max="2147483647"
              value={version}
              onChange={(e) => {
                setVersion(e.target.value);
                setDraft(null);
                setPreview(null);
                setSimulated(null);
              }}
            />
          </label>
        </div>
        <p>
          Keep the references and versions from your receipts. An independently reviewed offer is
          required before publication. Offers never alter tire ranking.
        </p>
      </section>
      <div className="p2-grid">
        <ActionForm
          title="Save an offer draft"
          disabled={disabled}
          action={(f) => {
            const id = offer || crypto.randomUUID(),
              targetId = crypto.randomUUID();
            setOffer(id);
            return w.command(
              'Offer draft',
              (c) =>
                w.client.p2OfferDraft({
                  path: { org, offer: id },
                  body: offerDraft(f, targetId),
                  command: c,
                }),
              (r) => {
                setDraft(r.data);
                setVersion(String(r.data.version));
                setSimulated(null);
                setStage('Draft saved. Submit this exact version for independent moderation.');
                setPreview(null);
              },
            );
          }}
        >
          <Field
            key={version}
            name="version"
            label="New draft version"
            value={version}
            type="number"
            min="1"
            required
          />
          <Field name="title" label="Offer title" required />
          <Field name="description" label="Description" type="textarea" />
          <Field
            name="included"
            label="Included items (one per line)"
            type="textarea"
            value="Tires"
          />
          <Field name="terms" label="Terms and conditions" type="textarea" required />
          <Field
            name="kind"
            label="Discount type"
            options={[
              'amount_off',
              'percent_off',
              'set_of_four_off',
              'buy_three_get_one',
              'free_service',
              'mail_in_rebate',
              'price_match',
            ]}
          />
          <Field name="amount" label="Amount in USD, or percentage for percent off" value="25.00" />
          <Field
            name="service"
            label="Service for a free-service offer"
            options={['fitting', 'alignment', 'tpms']}
          />
          <Field
            name="minimumTires"
            label="Minimum tire quantity"
            type="number"
            min="1"
            max="4"
            value="4"
            required
          />
          <Field name="minimumPurchase" label="Minimum purchase in USD (optional)" />
          <Field name="validFrom" label="Valid from (UTC)" type="datetime-local" required />
          <Field name="validUntil" label="Valid until (UTC)" type="datetime-local" required />
          <p>
            Offer validity must span 3–366 days and end in the future. The service validates the
            current rules.
          </p>
          <Field
            name="redemptionMethod"
            label="Redemption method"
            options={['in_store_code', 'online_code', 'link']}
          />
          <Field name="redemptionDomain" label="Approved redemption domain, if used" />
          <Field name="redemptionUrl" label="Approved HTTPS redemption URL, if used" type="url" />
          <Field
            name="strategy"
            label="Target audience"
            options={[
              'store_wide',
              'sku',
              'model',
              'brand',
              'category',
              'size',
              'vehicle_type',
              'tier',
              'region',
              'postal',
              'rim',
              'radius',
            ]}
          />
          <Field name="target" label="Target value or catalog reference" />
          <Field
            name="location"
            label="Verified location reference (for location/radius targeting)"
          />
          <Field name="logoAssetId" label="Uploaded logo reference (optional)" />
          <label>
            <input type="checkbox" name="logoRightsWarranted" />I have rights to the supplied logo.
          </label>
        </ActionForm>
        <section className="staff-card">
          <h2>Review the saved version</h2>
          {draft ? (
            <Receipt
              value={{ id: draft.offerId, status: draft.status, revision: String(draft.version) }}
            />
          ) : null}
          <button
            disabled={w.busy || !offer}
            onClick={() =>
              void w.read(
                'Offer preview',
                () => w.client.p2OfferPreview({ path, query: { version: Number(version) } }),
                (r) => setPreview(r.data.text),
              )
            }
          >
            Read saved preview
          </button>
          {preview ? (
            <div className="p2-preview" tabIndex={0} aria-label="Saved offer text">
              {preview}
            </div>
          ) : (
            <p>
              The preview is read from the saved version. It does not reserve inventory or publish
              an offer.
            </p>
          )}
        </section>
        <ActionForm
          title="Submit saved offer for moderation"
          disabled={disabled || !offer}
          action={() =>
            w.command(
              'Offer submission',
              (c) =>
                w.client.p2OfferSubmit({ path, body: { version: Number(version) }, command: c }),
              () => {
                setDraft(null);
                setPreview(null);
                setStage(
                  'Submitted for independent moderation. This receipt does not publish the offer.',
                );
              },
            )
          }
        >
          <label>
            <input type="checkbox" required />I reviewed this saved version and its terms.
          </label>
        </ActionForm>
        <section className="staff-card" aria-label="Independent offer publication">
          <h2>Independent offer publication</h2>
          <p>
            An authorized independent staff reviewer publishes approved offers. Give the reviewer
            this saved offer reference and exact version. Reseller membership cannot publish its own
            offer.
          </p>
          {offer ? (
            <p>
              Offer <code>{offer}</code> · version {version}
            </p>
          ) : null}
          <p>
            Approval alone does not publish an offer or reserve code inventory. Current eligibility
            and inventory remain checked at allocation.
          </p>
        </section>
        <ActionForm
          title="Pause this offer"
          disabled={disabled || !offer}
          action={() =>
            w.command(
              'Offer pause',
              (c) => w.client.p2OfferPause({ path, body: {}, command: c }),
              () => {
                setDraft(null);
                setPreview(null);
                setStage('Offer paused. New allocations are stopped.');
              },
            )
          }
        >
          <label>
            <input type="checkbox" required />
            Pause new allocations for this offer.
          </label>
        </ActionForm>
        <ActionForm
          title="Simulate eligibility"
          disabled={disabled || !offer}
          action={(f) =>
            w.command(
              'Offer simulation',
              (c) =>
                w.client.p2Simulate({
                  path,
                  body: { version: Number(version), audience: simulation(f) },
                  command: c,
                }),
              (r) => setSimulated(r.data),
            )
          }
        >
          <Field
            name="quantity"
            label="Tire quantity"
            type="number"
            min="1"
            max="4"
            value="4"
            required
          />
          <Field name="subtotal" label="Hypothetical subtotal in USD" />
          <Field name="region" label="State" />
          <Field name="postal" label="ZIP code" />
          <Field name="skuId" label="Catalog SKU reference" required />
          <Field name="modelId" label="Catalog model reference" required />
          <Field name="brandId" label="Catalog manufacturer reference" />
          <Field name="size" label="Tire size" required />
          <Field name="rim" label="Rim diameter (inches)" required />
          <Field name="category" label="Tire category" required />
          <Field name="vehicleType" label="Vehicle type" />
          <Field name="tier" label="Catalog tier" />
        </ActionForm>
        {simulated ? (
          <section className="staff-card">
            <h2>Hypothetical eligibility</h2>
            <p>
              Inventory was not checked or reserved. The server applied the stored offer and current
              matching rules.
            </p>
            <ul>
              {simulated.decisions.map((d) => (
                <li key={d.offerId}>
                  {d.eligible ? 'Eligible' : 'Not eligible'} ·{' '}
                  {d.selected ? 'Selected in simulation' : 'Not selected'} ·{' '}
                  {d.reasons.join(', ') || 'No additional reasons'}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <ActionForm
          title="Upload private code inventory or logo"
          disabled={disabled}
          action={(f) =>
            w.command(
              'Private offer asset',
              async (c) =>
                w.client.p2Upload({
                  path: { org },
                  query: {
                    purpose: text(f, 'purpose') as 'coupon_pool' | 'logo',
                    mime: text(f, 'purpose') === 'logo' ? 'image/png' : 'text/csv',
                  },
                  bytes: await uploadBytes(f, text(f, 'purpose') === 'logo' ? 8388608 : 16777216),
                  command: c,
                }),
              (r) => {
                if (text(f, 'purpose') === 'coupon_pool') setAsset(r.data.id);
                else setLogo(r.data.id);
              },
            )
          }
        >
          <Field name="purpose" label="Asset purpose" options={['coupon_pool', 'logo']} />
          <Field
            name="file"
            label="Private CSV (up to 16 MB) or PNG logo (up to 8 MB)"
            type="file"
            required
          />
          {asset ? (
            <p>
              CSV upload reference: <code>{asset}</code>
            </p>
          ) : null}
          {logo ? (
            <p>
              PNG logo reference: <code>{logo}</code>. Enter this in the offer draft when needed.
            </p>
          ) : null}
        </ActionForm>
        <ActionForm
          title="Create a code pool"
          disabled={disabled || !offer}
          action={(f) => {
            const id = crypto.randomUUID();
            setPool(id);
            return w.command(
              'Code pool',
              (c) =>
                w.client.p2Pool({
                  path: { org },
                  body: {
                    id,
                    offerId: offer,
                    version: Number(version),
                    mode: text(f, 'mode') as 'shared' | 'generated' | 'unique',
                    assetId: text(f, 'mode') === 'unique' ? asset : null,
                    prefix: text(f, 'mode') === 'generated' ? optional(f, 'prefix') : null,
                    sharedCode: text(f, 'mode') === 'shared' ? optional(f, 'sharedCode') : null,
                  },
                  command: c,
                }),
              () =>
                setStage(
                  'Code pool created. Imported unique codes require job completion before use.',
                ),
            );
          }}
        >
          <Field name="mode" label="Pool mode" options={['unique', 'shared', 'generated']} />
          <Field name="prefix" label="Generated-code prefix, if used" />
          <Field name="sharedCode" label="Shared code, if used" />
          <p>Unique pools use the private CSV upload. Raw codes are not shown in pilot reports.</p>
        </ActionForm>
        <ActionForm
          title="Start unique-code import"
          disabled={disabled || !pool || !asset}
          action={(f) =>
            w.command(
              'Unique-code import',
              (c) =>
                w.client.p2Queue({
                  path: { org },
                  body: {
                    poolId: pool,
                    assetId: asset!,
                    expiresAt: utcDate(f, 'expires'),
                  },
                  command: c,
                }),
              (r) => setJob(r.data),
            )
          }
        >
          <Field name="expires" label="Code expiry (UTC)" type="datetime-local" required />
          <p>
            Pool: <code>{pool || 'Create a pool first'}</code>
          </p>
        </ActionForm>
        <ActionForm
          title="Read inventory and import status"
          disabled={w.busy}
          submit="Refresh inventory"
          action={(f) =>
            w.read(
              'Inventory status',
              () => w.client.p2PoolStats({ path: { org, pool: text(f, 'pool') } }),
              (r) => {
                setPool(text(f, 'pool'));
                setStats(r.data);
              },
            )
          }
        >
          <Field name="pool" label="Code pool reference" value={pool} required />
          {stats ? (
            <dl className="p2-facts">
              <dt>Total</dt>
              <dd>{stats.total}</dd>
              <dt>Available</dt>
              <dd>{stats.available}</dd>
              <dt>Low inventory</dt>
              <dd>{stats.low ? 'Yes' : 'No'}</dd>
            </dl>
          ) : null}
        </ActionForm>
        <ActionForm
          title="Read code-import progress"
          disabled={w.busy}
          submit="Refresh import"
          action={(f) =>
            w.read(
              'Import progress',
              () => w.client.p2ImportStatus({ path: { org, import: text(f, 'import') } }),
              (r) => setJob(r.data),
            )
          }
        >
          <Field name="import" label="Import reference" value={job?.id ?? ''} required />
          {job ? (
            <dl className="p2-facts">
              <dt>State</dt>
              <dd>{job.state}</dd>
              <dt>Accepted</dt>
              <dd>{job.accepted}</dd>
              <dt>Rejected</dt>
              <dd>{job.rejected}</dd>
              <dt>Duplicates</dt>
              <dd>{job.duplicates}</dd>
              <dt>Processed through</dt>
              <dd>{job.through}</dd>
            </dl>
          ) : null}
        </ActionForm>
        {job ? (
          <section className="staff-card">
            <h2>Import recovery</h2>
            <button
              disabled={w.busy}
              onClick={() =>
                void w.read(
                  'Import errors',
                  () => w.client.p2ImportErrors({ path: { org, import: job.id } }),
                  (r) => setErrors(r.data),
                )
              }
            >
              Read safe error report
            </button>
            <button
              disabled={disabled}
              onClick={() =>
                void w.command(
                  'Import reauthorization',
                  (c) =>
                    w.client.p2Reauthorize({ path: { org, import: job.id }, body: {}, command: c }),
                  (r) => setJob(r.data),
                )
              }
            >
              Reauthorize current import
            </button>
            {errors ? (
              <>
                <p>
                  {errors.truncated
                    ? 'Partial error report; additional rows were omitted.'
                    : 'Complete available error report.'}
                </p>
                <pre className="p2-preview" tabIndex={0}>
                  {errors.csv}
                </pre>
              </>
            ) : null}
          </section>
        ) : null}
      </div>
    </>
  );
}
