import { useState } from 'react';
import { createP2PartnerClient } from '../../../../../packages/contracts/src/phase2-partner-client.ts';
import {
  Workbench,
  privateTransport,
  ActionForm,
  Field,
  Receipt,
  type Workspace,
} from '../workbench.tsx';
import { text, uploadBytes } from './forms.ts';
import { OffersPanel } from './offers.tsx';
import { PilotPanel } from './pilot.tsx';
export type PartnerClient = ReturnType<typeof createP2PartnerClient>;
export type PartnerWorkspace = Workspace<PartnerClient>;
type Organization = Awaited<ReturnType<PartnerClient['p2Organization']>>['data'];
type Action = Awaited<ReturnType<PartnerClient['p2Register']>>['data'];
async function connect(bearer: string, signal: AbortSignal) {
  const client = createP2PartnerClient(
    window.location.origin,
    privateTransport(window.location.origin, bearer, signal),
  );
  const { data } = await client.p2PartnerSession({ signal });
  return { client, csrf: data.csrf };
}
export function PartnerPortal() {
  return (
    <Workbench title="Your reseller workspace" connect={connect}>
      {(w) => <PartnerSpace w={w} />}
    </Workbench>
  );
}
function PartnerSpace({ w }: { w: PartnerWorkspace }) {
  const [org, setOrg] = useState(''),
    [current, setCurrent] = useState<Organization | null>(null),
    [panel, setPanel] = useState('Business'),
    [receipt, setReceipt] = useState<Action | null>(null),
    [asset, setAsset] = useState<string | null>(null),
    [invitation, setInvitation] = useState<string | null>(null);
  const disabled = w.busy || w.blocked;
  const load = (id = org) =>
    w.read(
      'Current business status',
      () => w.client.p2Organization({ path: { org: id } }),
      (r) => {
        if (id !== org) {
          setAsset(null);
          setInvitation(null);
          setReceipt(null);
          setPanel('Business');
        }
        setOrg(id);
        setCurrent(r.data);
      },
    );
  const changed = (r: { data: Action }) => {
    setReceipt(r.data);
    setCurrent(null);
  };
  return (
    <>
      <section className="p2-grid">
        <ActionForm
          title="Create your business"
          disabled={disabled || !!org}
          action={(f) =>
            w.command(
              'Business registration',
              (c) =>
                w.client.p2Register({
                  body: { legalName: text(f, 'legalName'), market: 'US' },
                  command: c,
                }),
              (r) => {
                setReceipt(r.data);
                if (r.data.id) setOrg(r.data.id);
              },
            )
          }
        >
          <Field name="legalName" label="Legal business name" required />
          <p>
            Registration starts pending. Verification and agreements are reviewed independently.
          </p>
        </ActionForm>
        <ActionForm
          title="Open existing business"
          disabled={w.busy}
          submit="Load current status"
          action={(f) => load(text(f, 'organization'))}
        >
          <Field name="organization" label="Business reference" required value={org} />
          <p>
            Use the reference on your registration receipt. Each request checks your membership.
          </p>
        </ActionForm>
      </section>
      <Receipt value={receipt} />
      {org ? (
        <>
          <section className="staff-card">
            <h2>Business status</h2>
            <p>
              Reference: <code>{org}</code>
            </p>
            <button disabled={w.busy} onClick={() => void load()}>
              Refresh current status
            </button>
            {current ? (
              <dl className="p2-facts">
                <dt>Status</dt>
                <dd>{current.organization.status}</dd>
                <dt>Verification</dt>
                <dd>{current.organization.verification}</dd>
                <dt>Your role</dt>
                <dd>
                  {current.member.role} · {current.member.status}
                </dd>
                <dt>Business revision</dt>
                <dd>{current.organization.revision}</dd>
                <dt>Onboarding state</dt>
                <dd>{current.profile.state}</dd>
                <dt>Profile revision</dt>
                <dd>{current.profile.revision}</dd>
                <dt>Your member revision</dt>
                <dd>{current.member.revision}</dd>
              </dl>
            ) : (
              <p>
                Load current status before changing versioned details. Pending or suspended
                businesses cannot publish offers.
              </p>
            )}
          </section>
          <nav className="staff-tabs" aria-label="Reseller workspace sections">
            {['Business', 'Offers and codes', 'Pilot activity'].map((p) => (
              <button
                key={p}
                aria-current={p === panel ? 'page' : undefined}
                disabled={w.busy || w.blocked}
                onClick={() => setPanel(p)}
              >
                {p}
              </button>
            ))}
          </nav>
          {panel === 'Business' ? (
            <div className="p2-grid">
              <ActionForm
                key={current?.profile.revision ?? 'profile'}
                title="Business services"
                disabled={
                  disabled ||
                  !current ||
                  current.member.role !== 'owner' ||
                  !['draft', 'rejected'].includes(current.profile.state)
                }
                action={(f) =>
                  w.command(
                    'Profile update',
                    (c) =>
                      w.client.p2Profile({
                        path: { org },
                        body: {
                          expected: current!.profile.revision,
                          services: f.getAll('services').map(String) as Parameters<
                            PartnerClient['p2Profile']
                          >[0]['body']['services'],
                        },
                        command: c,
                      }),
                    () => {
                      setCurrent(null);
                    },
                  )
                }
              >
                <label>
                  Services
                  <select
                    name="services"
                    multiple
                    required
                    defaultValue={current?.profile.services ?? ['sales']}
                    aria-describedby="services-help"
                  >
                    {[
                      'sales',
                      'fitting',
                      'alignment',
                      'tpms',
                      'repair',
                      'rotation',
                      'balancing',
                      'mobile_service',
                    ].map((s) => (
                      <option key={s} value={s}>
                        {s.replaceAll('_', ' ')}
                      </option>
                    ))}
                  </select>
                </label>
                <p id="services-help">
                  Draft and rejected profiles can be edited. Submitted and approved profiles are
                  read-only. Refresh status after a change to obtain its new revision.
                </p>
              </ActionForm>
              <ActionForm
                title="Add a location"
                disabled={disabled}
                action={(f) =>
                  w.command(
                    'Location',
                    (c) =>
                      w.client.p2Location({
                        path: { org },
                        body: {
                          key: text(f, 'locationKey'),
                          region: text(f, 'state').toUpperCase(),
                          address: {
                            line1: text(f, 'line1'),
                            city: text(f, 'city'),
                            postal: text(f, 'postal'),
                            country: 'US',
                          },
                        },
                        command: c,
                      }),
                    changed,
                  )
                }
              >
                <Field name="locationKey" label="Location name or internal reference" required />
                <Field name="state" label="State (two letters)" required />
                <Field name="line1" label="Street address" required />
                <Field name="city" label="City" required />
                <Field name="postal" label="ZIP code" required />
              </ActionForm>
              <ActionForm
                title="Upload verification or agreement"
                disabled={disabled}
                action={(f) =>
                  w.command(
                    'Private document upload',
                    async (c) =>
                      w.client.p2Upload({
                        path: { org },
                        query: {
                          purpose: text(f, 'purpose') as 'verification' | 'agreement',
                          mime: 'application/json',
                        },
                        bytes: await uploadBytes(f, 65536),
                        command: c,
                      }),
                    (r) => setAsset(r.data.id),
                  )
                }
              >
                <Field
                  name="purpose"
                  label="Document purpose"
                  options={['verification', 'agreement']}
                />
                <Field
                  name="file"
                  label="Current evidence package (JSON, up to 64 KB)"
                  type="file"
                  required
                />
                <p>
                  Use the current structured evidence package supplied by your reviewer. An
                  agreement must match the current policy hash. Uploads do not approve verification
                  or terms.
                </p>
              </ActionForm>
              <ActionForm
                key={asset ?? 'agreement'}
                title="Accept current agreement"
                disabled={disabled}
                action={(f) =>
                  w.command(
                    'Agreement acceptance',
                    (c) =>
                      w.client.p2Agreement({
                        path: { org },
                        body: {
                          kind: text(f, 'agreementKind') as 'pilot_terms' | 'privacy' | 'dpa',
                          assetId: text(f, 'asset'),
                        },
                        command: c,
                      }),
                    changed,
                  )
                }
              >
                <Field
                  name="agreementKind"
                  label="Agreement"
                  options={['pilot_terms', 'privacy', 'dpa']}
                />
                <Field
                  name="asset"
                  label="Uploaded agreement reference"
                  value={asset ?? ''}
                  required
                />
                <label>
                  <input name="acceptTerms" type="checkbox" required />I have read and accept this
                  agreement for my business.
                </label>
              </ActionForm>
              <ActionForm
                title="Submit for independent review"
                disabled={
                  disabled || !current || !['draft', 'rejected'].includes(current.profile.state)
                }
                action={() =>
                  w.command(
                    'Business submission',
                    (c) =>
                      w.client.p2Submit({
                        path: { org },
                        body: { expected: current!.profile.revision },
                        command: c,
                      }),
                    changed,
                  )
                }
              >
                <p>
                  Submit the current profile and evidence. Only authorized reviewers can approve,
                  suspend or activate a business.
                </p>
                <label>
                  <input type="checkbox" required />I have checked the current business information.
                </label>
              </ActionForm>
              <ActionForm
                title="Invite a team member"
                disabled={disabled}
                action={(f) =>
                  w.command(
                    'Member invitation',
                    (c) =>
                      w.client.p2Invite({
                        path: { org },
                        body: {
                          subject: text(f, 'subject'),
                          role: text(f, 'role') as 'manager' | 'analyst',
                        },
                        command: c,
                      }),
                    (r) => setInvitation(r.data.token),
                  )
                }
              >
                <Field name="subject" label="Verified member account reference" required />
                <Field name="role" label="Role" options={['analyst', 'manager']} />
                <p>
                  No invitation email is sent. Give the private one-time invitation to the intended
                  account holder.
                </p>
              </ActionForm>
              {invitation ? (
                <section className="staff-card">
                  <h2>Private invitation</h2>
                  <p>
                    Share only with the intended member. This value is cleared when you disconnect.
                  </p>
                  <code>{invitation}</code>
                  <button onClick={() => setInvitation(null)}>Hide invitation</button>
                </section>
              ) : null}
              <ActionForm
                title="Accept an invitation"
                disabled={disabled}
                action={(f) =>
                  w.command(
                    'Invitation acceptance',
                    (c) =>
                      w.client.p2AcceptInvite({
                        path: { org },
                        body: { token: text(f, 'invitation') },
                        command: c,
                      }),
                    changed,
                  )
                }
              >
                <Field name="invitation" label="One-time invitation" type="password" required />
              </ActionForm>
              <ActionForm
                title="Update a team member"
                disabled={disabled}
                action={(f) =>
                  w.command(
                    'Membership update',
                    (c) =>
                      w.client.p2Member({
                        path: { org },
                        body: {
                          subject: text(f, 'member'),
                          expected: text(f, 'memberRevision'),
                          role: text(f, 'memberRole') as 'owner' | 'manager' | 'analyst',
                          status: text(f, 'memberStatus') as 'active' | 'revoked',
                        },
                        command: c,
                      }),
                    changed,
                  )
                }
              >
                <Field name="member" label="Verified member account reference" required />
                <Field
                  name="memberRevision"
                  label="Current member revision from its latest receipt"
                  required
                />
                <Field
                  name="memberRole"
                  label="Member role"
                  options={['analyst', 'manager', 'owner']}
                />
                <Field
                  name="memberStatus"
                  label="Membership status"
                  options={['active', 'revoked']}
                />
                <label>
                  <input type="checkbox" required />I checked this member and its current revision.
                </label>
              </ActionForm>
              <ActionForm
                title="Close this business"
                disabled={disabled || !current}
                action={() =>
                  w.command(
                    'Business closure',
                    (c) =>
                      w.client.p2Lifecycle({
                        path: { org },
                        body: {
                          expected: current!.organization.revision,
                          state: 'closed',
                          reason: 'owner_requested',
                        },
                        command: c,
                      }),
                    changed,
                  )
                }
              >
                <p>
                  Closure stops eligible commercial activity. It is distinct from deleting personal
                  information.
                </p>
                <label>
                  <input type="checkbox" required />I understand and want to close this business.
                </label>
              </ActionForm>
            </div>
          ) : panel === 'Offers and codes' ? (
            <OffersPanel key={org} w={w} org={org} />
          ) : (
            <PilotPanel key={org} w={w} org={org} />
          )}
        </>
      ) : null}
    </>
  );
}
