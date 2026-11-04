import type {
  TemplateContext,
  TemplateProfile,
} from '../../../packages/integrations/src/report-templates/types.ts';
import type { DeliveryDocument } from '../../../packages/application/src/ports/delivery-services.ts';
type Mutable<T> = T extends string | number | boolean | null
  ? T
  : T extends readonly (infer U)[]
    ? Mutable<U>[]
    : T extends object
      ? { -readonly [K in keyof T]: Mutable<T[K]> }
      : T;
export const ref = '10000000-0000-4000-8000-000000000001';
export const pick = '10000000-0000-4000-8000-000000000002';
const sku = '10000000-0000-4000-8000-000000000003';
const proof = (kind: string) => `${kind}.synthetic.${ref}.${'a'.repeat(64)}`;
export function templateContext(): Mutable<TemplateContext> {
  return {
    reportId: ref,
    version: 1,
    comparisonRevision: null,
    expiresAt: '2026-12-03T12:00:00.000Z',
    viewUrl: 'https://preview.example.invalid/preview/shared#' + proof('share'),
    preferencesUrl:
      'https://preview.example.invalid/preview/email-preferences#' + proof('unsubscribe'),
    offersConfirmationUrl: null,
  };
}
export const templateProfile: TemplateProfile = {
  senderName: 'Tires & Tread',
  postalAddress: ['SYNTHETIC ADDRESS - NOT A LIVE SENDER', '123 Example Road, Test City, ZZ 00000'],
  origin: 'https://preview.example.invalid',
  routes: {
    report: '/preview/shared',
    preferences: '/preview/email-preferences',
    confirmation: '/preview/email-confirmation',
    privacy: '/preview/privacy',
  },
};
export function templateDocument(): Mutable<DeliveryDocument> {
  return {
    schemaVersion: 1,
    fixture: true,
    locale: 'en-US',
    market: 'US',
    sender: 'Tires & Tread <report@example.invalid>',
    policyVersion: 'synthetic',
    template: { id: ref as never, version: '1', rendererHash: 'b'.repeat(64) },
    report: {
      reportId: ref,
      version: 1,
      purpose: 'technical_evaluation',
      issuanceAuthorized: false,
      result: {
        asOf: '2026-11-03T12:00:00.000Z',
        versions: { engine: 'engine-v1', policy: 'policy-v1', scoring: 'scoring-v1', schema: 1 },
        picks: [pick],
        decisions: [
          {
            id: pick,
            status: 'eligible',
            scoreBp: 7312,
            reasons: ['FITMENT_VERIFIED', 'EVIDENCE_MISSING'],
            confidence: 2,
            budget: 'unknown',
          },
        ],
      },
      options: [
        {
          id: pick,
          front: { id: sku, modelId: ref, sizeCode: '225/45R18' },
          rear: { id: sku, modelId: ref, sizeCode: '255/40R18' },
        },
      ],
      products: [{ id: sku, modelId: ref, brand: 'Synthetic', model: 'Example Touring' }],
      prices: [
        {
          planId: pick,
          asOf: '2026-11-03T12:00:00.000Z',
          quantity: 4,
          currency: 'USD',
          merchandise: { low: '60000', high: '80000', currency: 'USD' },
          installed: { low: '70000', high: '95000', currency: 'USD' },
          freshness: 'fresh',
        },
      ],
    },
    comparison: null,
    learning: [
      {
        path: '/guides/before-you-buy',
        title: 'Before you buy checklist',
        expiresAt: '2026-12-03T12:00:00.000Z',
      },
    ],
  };
}
