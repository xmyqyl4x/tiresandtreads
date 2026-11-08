import type { createP2PartnerClient } from '../../../../../packages/contracts/src/phase2-partner-client.ts';
import type { Workspace } from '../workbench.tsx';
export type PartnerClient = ReturnType<typeof createP2PartnerClient>;
export type PartnerWorkspace = Workspace<PartnerClient>;
