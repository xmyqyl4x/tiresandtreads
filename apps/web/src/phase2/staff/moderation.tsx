import { useState } from 'react';
import { ActionForm, Field } from '../workbench.tsx';
import { text, optional, utcDate } from '../partner/forms.ts';
import type { StaffWorkspace, StaffClients } from './types.ts';
type Review = StaffClients['review'];
type Queue = Awaited<ReturnType<Review['p2BusinessQueue']>>['data'];
type Business = Awaited<ReturnType<Review['p2BusinessReview']>>['data'];
type Offer = Awaited<ReturnType<Review['p2OfferReviewDetail']>>['data'];
export function ModerationPanel({ w, kind }: { w: StaffWorkspace; kind: 'businesses' | 'offers' }) {
  const [queue, setQueue] = useState<Queue | null>(null),
    [org, setOrg] = useState(''),
    [offer, setOffer] = useState(''),
    [version, setVersion] = useState('1'),
    [business, setBusiness] = useState<Business | null>(null),
    [detail, setDetail] = useState<Offer | null>(null),
    [evidence, setEvidence] = useState<{ id: string; purpose: string; text: string } | null>(null),
    [note, setNote] = useState('Read current queue and evidence before any independent decision.');
  const disabled = w.busy || w.blocked;
  const loadBusiness = (id = org) =>
    w.read(
      'Current business review',
      () => w.client.review.p2BusinessReview({ path: { org: id } }),
      (r) => {
        setOrg(id);
        setBusiness(r.data);
        setEvidence(null);
      },
    );
  const loadOffer = (id = offer, organization = org, v = version) =>
    w.read(
      'Current offer review',
      () =>
        w.client.review.p2OfferReviewDetail({ path: { org: organization, offer: id, version: v } }),
      (r) => {
        setOrg(organization);
        setOffer(id);
        setVersion(v);
        setDetail(r.data);
      },
    );
  const changed = () => {
    setBusiness(null);
    setDetail(null);
    setEvidence(null);
    setNote(
      'Decision acknowledgement received. Reload current status and use the new revision before another change.',
    );
  };
  const page = (after: string | null) =>
    w.read(
      'Review queue',
      () =>
        kind === 'businesses'
          ? w.client.review.p2BusinessQueue({ query: { after, limit: 25 } })
          : w.client.review.p2OfferQueue({ query: { after, limit: 25 } }),
      (r) => setQueue(r.data),
    );
  return (
    <>
      <section className="staff-card">
        <h2>{kind === 'businesses' ? 'Business verification queue' : 'Offer moderation queue'}</h2>
        <p>{note}</p>
        <p>
          Queues are bounded and permission-scoped. No table editing or paid-ranking controls are
          available. Current services enforce staff roles, MFA, separation from authors and
          policy/license/source validity.
        </p>
        <button disabled={w.busy} onClick={() => void page(null)}>
          Refresh queue
        </button>
        {queue ? (
          <>
            <ul>
              {queue.items.map((r) => (
                <li key={[r.org, r.resource, r.version].join(':')}>
                  <button
                    disabled={w.busy}
                    onClick={() =>
                      void (kind === 'businesses'
                        ? loadBusiness(r.org)
                        : loadOffer(r.resource, r.org, String(r.version)))
                    }
                  >
                    {r.title} · {r.state}
                    {r.version ? ' · version' + r.version : ''}
                  </button>
                </li>
              ))}
            </ul>
            {queue.items.length === 0 ? <p>No permitted pending records in this page.</p> : null}
            <button disabled={w.busy || !queue.next} onClick={() => void page(queue.next)}>
              Next queue page
            </button>
          </>
        ) : null}
      </section>
      <div className="p2-grid">
        <ActionForm
          title="Open current review context"
          disabled={w.busy}
          action={(f) =>
            kind === 'businesses'
              ? loadBusiness(text(f, 'org'))
              : loadOffer(text(f, 'offer'), text(f, 'org'), text(f, 'version'))
          }
        >
          <Field name="org" label="Business reference" value={org} required />
          {kind === 'offers' ? (
            <>
              <Field name="offer" label="Offer reference" value={offer} required />
              <Field
                name="version"
                label="Offer version"
                value={version}
                type="number"
                min="1"
                required
              />
            </>
          ) : null}
        </ActionForm>
        {business ? (
          <section className="staff-card">
            <h2>{business.organization.legalName}</h2>
            <dl className="p2-facts">
              <dt>Business / verification</dt>
              <dd>
                {business.organization.status} / {business.organization.verification}
              </dd>
              <dt>Organization revision</dt>
              <dd>{business.organization.revision}</dd>
              <dt>Profile state / revision</dt>
              <dd>
                {business.profile.state} / {business.profile.revision}
              </dd>
              <dt>Business email domain</dt>
              <dd>{business.profile.emailDomain}</dd>
              <dt>Services</dt>
              <dd>{business.profile.services.join(', ')}</dd>
            </dl>
            <h3>Locations</h3>
            <ul>
              {business.locations.map((l) => (
                <li key={l.id}>
                  {l.key} · {l.region} · {l.status} · {l.id}
                </li>
              ))}
            </ul>
            <h3>Current agreements</h3>
            <ul>
              {business.agreements.map((g) => (
                <li key={g.kind + g.version}>
                  {g.kind} · {g.version} · {g.status} · expires{g.expiresAt}
                </li>
              ))}
            </ul>
            <h3>Private evidence packages</h3>
            <ul>
              {business.assets.map((a) => (
                <li key={a.id}>
                  {a.purpose} · {a.state} · expires{a.expiresAt}
                  <button
                    disabled={w.busy || a.state !== 'ready'}
                    onClick={() =>
                      void w.read(
                        'Private review evidence',
                        () =>
                          w.client.review.p2ReviewEvidence({
                            path: { org, asset: a.id },
                            query: { purpose: a.purpose },
                          }),
                        (r) => setEvidence(r.data),
                      )
                    }
                  >
                    Read {a.purpose} {a.id}
                  </button>
                </li>
              ))}
            </ul>
            {business.truncated ? (
              <p role="status">
                Partial context: additional records were omitted. Obtain the full permitted review
                evidence before deciding.
              </p>
            ) : null}
          </section>
        ) : null}
        {evidence ? (
          <section className="staff-card">
            <h2>Private {evidence.purpose} evidence</h2>
            <p>Reference {evidence.id}. Do not copy private content into notes or analytics.</p>
            <pre className="p2-preview" tabIndex={0}>
              {evidence.text}
            </pre>
          </section>
        ) : null}
        {kind === 'businesses' ? (
          <>
            <ActionForm
              title="Record verification decision"
              disabled={disabled || !business || business.truncated}
              action={(f) =>
                w.command(
                  'Business verification',
                  (c) =>
                    w.client.partner.p2Verification({
                      path: { org },
                      body: {
                        kind: text(f, 'kind') as 'domain' | 'registry' | 'manual',
                        assetId: text(f, 'asset'),
                        approved: text(f, 'approved') === 'approved',
                        expiresAt: utcDate(f, 'expires'),
                        domain: optional(f, 'domain'),
                      },
                      command: c,
                    }),
                  changed,
                )
              }
            >
              <Field
                name="kind"
                label="Verification method"
                options={['domain', 'registry', 'manual']}
              />
              <Field
                name="asset"
                label="Reviewed verification asset reference"
                value={evidence?.purpose === 'verification' ? evidence.id : ''}
                required
              />
              <Field
                name="approved"
                label="Verification result"
                options={['rejected', 'approved']}
              />
              <Field
                name="expires"
                label="Verification expiry (UTC)"
                type="datetime-local"
                required
              />
              <Field
                name="domain"
                label="Reviewed business domain"
                value={business?.profile.emailDomain ?? ''}
              />
              <label>
                <input type="checkbox" required />I independently reviewed this current evidence and
                expiry.
              </label>
            </ActionForm>
            <ActionForm
              title="Approve or reject submitted profile"
              disabled={
                disabled ||
                !business ||
                business.truncated ||
                business.profile.state !== 'submitted'
              }
              action={(f) =>
                w.command(
                  'Onboarding decision',
                  (c) =>
                    w.client.partner.p2Decide({
                      path: { org },
                      body: {
                        expected: business!.profile.revision,
                        approved: text(f, 'decision') === 'approved',
                        reason: text(f, 'reason'),
                        emailOverride: f.get('override') === 'on',
                      },
                      command: c,
                    }),
                  changed,
                )
              }
            >
              <Field name="decision" label="Profile decision" options={['rejected', 'approved']} />
              <Field name="reason" label="Reason code" required />
              <label>
                <input name="override" type="checkbox" />
                Explicitly allow a reviewed business-email domain exception.
              </label>
              <label>
                <input type="checkbox" required />I reviewed the current submitted profile, evidence
                and agreements independently.
              </label>
              <p>
                Expected profile revision: {business?.profile.revision ?? 'Read current context'}
              </p>
            </ActionForm>
            <ActionForm
              title="Activate approved business"
              disabled={
                disabled || !business || business.truncated || business.profile.state !== 'approved'
              }
              action={() =>
                w.command(
                  'Business activation',
                  (c) =>
                    w.client.partner.p2Activate({
                      path: { org },
                      body: { expected: business!.organization.revision },
                      command: c,
                    }),
                  changed,
                )
              }
            >
              <label>
                <input type="checkbox" required />
                Activate only this current independently approved business with valid verification
                and agreements.
              </label>
            </ActionForm>
            <ActionForm
              title="Change business lifecycle state"
              disabled={disabled || !business}
              action={(f) =>
                w.command(
                  'Business lifecycle',
                  (c) =>
                    w.client.partner.p2Lifecycle({
                      path: { org },
                      body: {
                        expected: business!.organization.revision,
                        state: text(f, 'state') as 'active' | 'suspended' | 'closed' | 'expired',
                        reason: text(f, 'reason'),
                      },
                      command: c,
                    }),
                  changed,
                )
              }
            >
              <Field
                name="state"
                label="Lifecycle decision"
                options={['suspended', 'expired', 'closed', 'active']}
              />
              <Field name="reason" label="Reason code" required />
              <label>
                <input type="checkbox" required />I checked this business, current revision and
                decision authority.
              </label>
            </ActionForm>
          </>
        ) : null}
        {detail ? (
          <section className="staff-card">
            <h2>Exact offer version{detail.version}</h2>
            <p>
              Current state: {detail.state}. This preview does not publish or reserve inventory.
            </p>
            <pre className="p2-preview" tabIndex={0}>
              {detail.text}
            </pre>
            <h3>Stored targets</h3>
            <ul>
              {detail.targets.map((t, i) => (
                <li key={i}>
                  {t.strategy} ·{' '}
                  {[t.value, t.sku, t.model, t.brand, t.location, t.rim, t.radius]
                    .filter(Boolean)
                    .join(' · ') || 'Store wide'}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {kind === 'offers' ? (
          <>
            <ActionForm
              title="Independently moderate exact offer"
              disabled={disabled || !detail || detail.state !== 'pending_review'}
              action={(f) =>
                w.command(
                  'Independent offer moderation',
                  (c) =>
                    w.client.partner.p2OfferReview({
                      path: { org, offer },
                      body: {
                        version: Number(version),
                        approved: text(f, 'decision') === 'approved',
                        reason: text(f, 'reason'),
                      },
                      command: c,
                    }),
                  changed,
                )
              }
            >
              <Field name="decision" label="Offer decision" options={['rejected', 'approved']} />
              <Field name="reason" label="Reason code" required />
              <label>
                <input type="checkbox" required />I independently reviewed these terms, targets,
                evidence and exact version.
              </label>
            </ActionForm>
            <ActionForm
              title="Publish independently reviewed offer"
              disabled={disabled || !detail || detail.state !== 'reviewed'}
              action={(f) =>
                w.command(
                  'Reviewed offer publication',
                  (c) =>
                    w.client.partner.p2OfferPublish({
                      path: { org, offer },
                      body: {
                        version: Number(version),
                        expected: optional(f, 'head') === null ? null : Number(text(f, 'head')),
                      },
                      command: c,
                    }),
                  changed,
                )
              }
            >
              <Field
                name="head"
                label="Current published version (blank if none)"
                type="number"
                min="1"
              />
              <label>
                <input type="checkbox" required />I checked the current head and independent review
                of this exact version.
              </label>
            </ActionForm>
          </>
        ) : null}
      </div>
    </>
  );
}
