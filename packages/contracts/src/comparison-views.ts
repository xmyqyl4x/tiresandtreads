import './browser-runtime.ts';
import * as z from 'zod/mini';
import { reportOutputView, safetyView, pdfAssetsView } from './report-views.ts';
const rev = z.string().check(z.regex(/^[1-9][0-9]{0,18}$/)),
  version = z.number().check(z.int(), z.minimum(1), z.maximum(2147483647)),
  cents = z.string().check(z.regex(/^(0|[1-9][0-9]{0,18})$/));
const money = z.object({ low: cents, high: cents, currency: z.literal('USD') });
const price = z.object({
  merchandise: z.nullable(money),
  installed: z.nullable(money),
  historical: z.literal(true),
  quantity: z.optional(z.number()),
  freshness: z.optional(z.string()),
});
export const comparisonView = z.object({
  revision: rev,
  items: z
    .array(
      z.object({
        slot: z.number().check(z.int(), z.minimum(1), z.maximum(4)),
        kind: z.enum(['catalog', 'quote']),
        snapshot: z.object({
          productKnown: z.boolean(),
          fit: z.enum(['eligible', 'blocked', 'unverified']),
          climate: z.enum(['suitable', 'unsuitable', 'unknown']),
          scoreBp: z.nullable(z.number()),
          price: z.nullable(price),
          verdict: z.nullable(
            z.object({
              fit: z.string(),
              climate: z.string(),
              relation: z.string(),
              evidenceMissing: z.boolean(),
              score: z.nullable(z.number()),
              delta: z.nullable(
                z.object({
                  lowMinor: z.string().check(z.regex(/^-?\d{1,19}$/)),
                  highMinor: z.string().check(z.regex(/^-?\d{1,19}$/)),
                  currency: z.literal('USD'),
                }),
              ),
            }),
          ),
        }),
      }),
    )
    .check(z.maxLength(4)),
});
export const ownerComparisonView = z.object({
  reportId: z.uuid(),
  version,
  comparison: comparisonView,
  safety: safetyView,
  scenario: z.object({
    asOf: z.string(),
    ownershipScenario: z.literal('not_requested'),
    issuanceAuthorized: z.literal(false),
  }),
});
export const sharedReportView = z.object({
  version,
  output: reportOutputView,
  safety: safetyView,
  comparison: z.nullable(comparisonView),
  access: z.literal('read_only'),
  pdfs: z.optional(pdfAssetsView),
});
const quote = z.object({
  id: z.uuid(),
  currency: z.literal('USD'),
  totalMinor: cents,
  quantity: z.number().check(z.int(), z.minimum(1), z.maximum(4)),
  basis: z.enum(['per_tire', 'set', 'installed_set']),
  observedOn: z.string(),
  expiresAt: z.string(),
});
export const quotePageView = z.object({
  reportId: z.uuid(),
  items: z.array(quote).check(z.maxLength(50)),
  next: z.nullable(z.string()),
});
export const privateQuoteView = z.object({
  quote,
  private: z.nullable(z.object({ productText: z.string(), shopName: z.nullable(z.string()) })),
});
export const actionReceipt = z.object({
  schema_version: z.literal(1),
  resource_id: z.uuid(),
  status: z.enum(['created', 'accepted']),
  report_id: z.uuid(),
  report_version: z.optional(version),
  result_revision: z.optional(rev),
});
export const tokenReceipt = z.object({
  schema_version: z.literal(1),
  resource_id: z.uuid(),
  status: z.literal('created'),
  report_id: z.uuid(),
  report_version: version,
  expires_at: z.string(),
  token: z.string().check(z.minLength(1), z.maxLength(256)),
});
export type ComparisonView = ReturnType<typeof comparisonView.parse>;
export type OwnerComparisonView = ReturnType<typeof ownerComparisonView.parse>;
export type SharedReportView = ReturnType<typeof sharedReportView.parse>;
export type QuotePageView = ReturnType<typeof quotePageView.parse>;
