import type { createP2OwnerClient } from '../../../../../packages/contracts/src/phase2-owner-client.ts';
import type { createP2PresentationClient } from '../../../../../packages/contracts/src/phase2-presentation-client.ts';
import type { createResultsClient } from '../../../../../packages/contracts/src/results-client.ts';
import type { createDeliveryPrivacyClient } from '../../../../../packages/contracts/src/delivery-privacy-client.ts';
import type { createPhotoPresentationClient } from '../../../../../packages/contracts/src/phase2-photo-presentation-client.ts';
import type { assessmentController } from '../../assessment/controller.ts';
export interface OwnerClients {
  photos: ReturnType<typeof createPhotoPresentationClient>;
  assessment: ReturnType<typeof assessmentController>;
  analysis: ReturnType<typeof createP2OwnerClient>;
  presentation: ReturnType<typeof createP2PresentationClient>;
  reports: ReturnType<typeof createResultsClient>;
  delivery: ReturnType<typeof createDeliveryPrivacyClient>;
}
