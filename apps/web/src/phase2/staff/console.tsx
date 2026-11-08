import { useState } from 'react';
import { createP2StaffClient } from '../../../../../packages/contracts/src/phase2-staff-client.ts';
import { createP2PartnerClient } from '../../../../../packages/contracts/src/phase2-partner-client.ts';
import { createP2ReviewClient } from '../../../../../packages/contracts/src/phase2-review-client.ts';
import { Workbench, privateTransport, type Workspace } from '../workbench.tsx';
import { CsvPanel } from './csv.tsx';
import { ModerationPanel } from './moderation.tsx';
import type { StaffClients } from './types.ts';
async function connect(bearer: string, signal: AbortSignal) {
  const base = window.location.origin,
    transport = privateTransport(base, bearer, signal, fetch, 'staff'),
    client = {
      csv: createP2StaffClient(base, transport),
      partner: createP2PartnerClient(base, transport),
      review: createP2ReviewClient(base, transport),
    };
  const { data } = await client.review.p2StaffSession({ signal });
  return { client, csrf: data.csrf };
}
function StaffSpace({ w }: { w: Workspace<StaffClients> }) {
  const [panel, setPanel] = useState('CSV imports');
  return (
    <>
      <nav className="staff-tabs" aria-label="Staff review sections">
        {['CSV imports', 'Business review', 'Offer moderation'].map((p) => (
          <button
            key={p}
            disabled={w.busy || w.blocked}
            aria-current={p === panel ? 'page' : undefined}
            onClick={() => setPanel(p)}
          >
            {p}
          </button>
        ))}
      </nav>
      {panel === 'CSV imports' ? (
        <CsvPanel w={w} />
      ) : (
        <ModerationPanel
          key={panel}
          w={w}
          kind={panel === 'Business review' ? 'businesses' : 'offers'}
        />
      )}
    </>
  );
}
export function P2StaffConsole() {
  return (
    <Workbench title="Data and partner review" connect={connect}>
      {(w) => <StaffSpace w={w} />}
    </Workbench>
  );
}
