import type { createP2StaffClient } from '../../../../../packages/contracts/src/phase2-staff-client.ts';
import type { createP2PartnerClient } from '../../../../../packages/contracts/src/phase2-partner-client.ts';
import type { createP2ReviewClient } from '../../../../../packages/contracts/src/phase2-review-client.ts';
import type { Workspace } from '../workbench.tsx';
export type StaffClients = {
  csv: ReturnType<typeof createP2StaffClient>;
  partner: ReturnType<typeof createP2PartnerClient>;
  review: ReturnType<typeof createP2ReviewClient>;
};
export type StaffWorkspace = Workspace<StaffClients>;
