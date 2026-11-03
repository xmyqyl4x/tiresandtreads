import * as z from 'zod/mini';
import { browserChoicesInput } from './browser-consent-input.ts';
import {
  contactRequestSchema,
  deliveryRequestSchema,
  cancelDeliverySchema,
  ownerRightsSchema,
  emailRightsSchema,
} from './delivery-privacy-inputs.ts';
export { contactRequestSchema } from './delivery-privacy-inputs.ts';
export const consentInputSchemas = {
  requestContact: contactRequestSchema,
  requestDelivery: deliveryRequestSchema,
  cancelDelivery: cancelDeliverySchema,
  setBrowserConsent: browserChoicesInput,
  requestOwnerRights: ownerRightsSchema,
  requestEmailRights: emailRightsSchema,
  confirmPrivacyProof: z.strictObject({}),
};
export type ConsentOperation = keyof typeof consentInputSchemas;
