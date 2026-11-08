import { analysisApiContracts } from './phase2-analysis.ts';
import { analysisDeliveryContract } from './phase2-owner-client.ts';
import { presentationApiContracts } from './phase2-presentation-client.ts';
import { photoPresentationContracts } from './phase2-photo-presentation-client.ts';
import { sessionContracts, type EndpointContract } from './http.ts';
// Narrow local owner composition. No session creation, public capability or arbitrary proxy.
export const ownerWebContracts: readonly EndpointContract[] = [
  ...analysisApiContracts.filter((c) => c.operationId !== 'p2PhotoSave'),
  ...photoPresentationContracts,
  analysisDeliveryContract,
  ...presentationApiContracts,
  sessionContracts[1],
  { operationId: 'readReport', method: 'GET', path: '/api/v1/reports/:reportId', access: 'owner' },
  {
    operationId: 'createReport',
    method: 'POST',
    path: '/api/v1/reports',
    access: 'owner',
    command: true,
  },
  { operationId: 'lookupReference', method: 'GET', path: '/api/v1/reference', access: 'public' },
  {
    operationId: 'getConsentPolicy',
    method: 'GET',
    path: '/api/v1/consent/policy',
    access: 'public',
  },
  {
    operationId: 'getDelivery',
    method: 'GET',
    path: '/api/v1/deliveries/:sendId',
    access: 'owner',
  },
  {
    operationId: 'cancelDelivery',
    method: 'POST',
    path: '/api/v1/deliveries/:sendId/cancel',
    access: 'owner',
    command: true,
  },
];
