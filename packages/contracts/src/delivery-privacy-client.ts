import * as z from 'zod/mini';
import { createApiClient } from './transport.ts';
import { consentPolicyView } from './consent-views.ts';
import {
  resourceId,
  contactRequestSchema,
  deliveryRequestSchema,
  cancelDeliverySchema,
  ownerRightsSchema,
  emailRightsSchema,
  type ContactInput,
  type DeliveryInput,
  type OwnerRightsInput,
  type EmailRightsInput,
} from './delivery-privacy-inputs.ts';
import {
  deliveryView,
  contactReceipt,
  confirmationView,
  emailPreferenceView,
  privacyStatusView,
  privacyProofView,
  checkedProof,
} from './delivery-privacy-views.ts';
export type {
  DeliveryView,
  DeliveryReceipt,
  PrivacyStatusView,
  ConfirmationView,
  EmailPreferenceView,
} from './delivery-privacy-views.ts';
export type {
  DeliveryChoice,
  OwnerRightsInput,
  EmailRightsInput,
} from './delivery-privacy-inputs.ts';
export function createDeliveryPrivacyClient(origin: string, send: typeof fetch = fetch) {
  const bounded: typeof fetch = (url, options) =>
      send(url, { ...options, signal: options?.signal ?? AbortSignal.timeout(15000) }),
    api = createApiClient(origin, bounded);
  const postOwner = (path: string, input: unknown, csrf: string, key: string) => {
    if (!/^[a-f0-9]{64}$/.test(csrf) || !/^[A-Za-z0-9_-]{8,100}$/.test(key))
      throw Error('Invalid command');
    return api.request<unknown>(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf, 'idempotency-key': key },
      body: JSON.stringify(input),
    });
  };
  const privateRequest = (
    path: string,
    proof: string,
    kind: 'verify' | 'unsubscribe' | 'privacy',
    method: 'GET' | 'POST' = 'GET',
  ) =>
    api.request<unknown>(path, {
      method,
      credentials: 'omit',
      headers: {
        authorization: 'Bearer ' + checkedProof(proof, kind),
        ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
      },
      ...(method === 'POST' ? { body: '{}' } : {}),
    });
  return {
    async policy() {
      return consentPolicyView.parse((await api.request<unknown>('/api/v1/consent/policy')).data);
    },
    async deliver(input: DeliveryInput, csrf: string, key: string) {
      return deliveryView.parse(
        (await postOwner('/api/v1/deliveries', deliveryRequestSchema.parse(input), csrf, key)).data,
      );
    },
    async contact(input: ContactInput, csrf: string, key: string) {
      return contactReceipt.parse(
        (await postOwner('/api/v1/contacts', contactRequestSchema.parse(input), csrf, key)).data,
      );
    },
    async delivery(id: string) {
      resourceId.parse(id);
      const view = deliveryView.parse(
        (await api.request<unknown>('/api/v1/deliveries/' + id, { credentials: 'same-origin' }))
          .data,
      );
      if (view.id !== id) throw Error('Invalid delivery binding');
      return view;
    },
    async cancel(
      id: string,
      input: { expectedRevision: string; reason: 'cancel' | 'correct_address' },
      csrf: string,
      key: string,
    ) {
      resourceId.parse(id);
      const view = deliveryView.parse(
        (
          await postOwner(
            '/api/v1/deliveries/' + id + '/cancel',
            cancelDeliverySchema.parse(input),
            csrf,
            key,
          )
        ).data,
      );
      if (view.id !== id || view.state !== 'cancelled') throw Error('Invalid cancellation receipt');
      return view;
    },
    async ownerRights(input: OwnerRightsInput, csrf: string, key: string) {
      const r = privacyProofView.parse(
        (
          await postOwner(
            '/api/v1/privacy/owner-requests',
            ownerRightsSchema.parse(input),
            csrf,
            key,
          )
        ).data,
      );
      checkedProof(r.proof, 'privacy');
      if (r.proof.split('.')[2] !== r.id) throw Error('Invalid privacy receipt binding');
      return r;
    },
    async emailRights(input: EmailRightsInput) {
      return z.strictObject({ accepted: z.literal(true) }).parse(
        (
          await api.request<unknown>('/api/v1/privacy/email-requests', {
            method: 'POST',
            credentials: 'omit',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(emailRightsSchema.parse(input)),
          })
        ).data,
      );
    },
    async confirmation(proof: string) {
      return confirmationView.parse(
        (await privateRequest('/api/v1/email/confirmation', proof, 'verify')).data,
      );
    },
    async preferences(proof: string) {
      return emailPreferenceView.parse(
        (await privateRequest('/api/v1/email/preferences', proof, 'unsubscribe')).data,
      );
    },
    async confirmEmail(proof: string) {
      return z
        .strictObject({ status: z.literal('confirmed') })
        .parse((await privateRequest('/api/v1/email/confirm', proof, 'verify', 'POST')).data);
    },
    async withdraw(proof: string) {
      return z
        .strictObject({ status: z.literal('withdrawn') })
        .parse((await privateRequest('/api/v1/email/withdraw', proof, 'unsubscribe', 'POST')).data);
    },
    async privacyStatus(proof: string) {
      const r = privacyStatusView.parse(
        (await privateRequest('/api/v1/privacy/status', proof, 'privacy')).data,
      );
      if (r.id !== proof.split('.')[2]) throw Error('Invalid privacy status binding');
      return r;
    },
    async confirmPrivacy(proof: string) {
      return z
        .strictObject({ verified: z.literal(true) })
        .parse((await privateRequest('/api/v1/privacy/confirm', proof, 'privacy', 'POST')).data);
    },
  };
}
