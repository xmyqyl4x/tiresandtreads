import './browser-runtime.ts';
import {
  object,
  array,
  string,
  number,
  boolean,
  literal,
  nullable,
  optional,
  uuid,
  int,
  minimum,
  maximum,
  maxLength,
  regex,
  enum as enumeration,
} from 'zod/mini';
import { assessmentInputSchema } from './assessment-input.ts';
const revision = string().check(regex(/^[1-9][0-9]{0,18}$/)),
  version = number().check(int(), minimum(1), maximum(2147483647));
const ids = array(uuid()).check(maxLength(1000));
const money = object({
  low: string().check(regex(/^\d{1,19}$/)),
  high: string().check(regex(/^\d{1,19}$/)),
  currency: literal('USD'),
});
const sku = object({
  id: optional(uuid()),
  modelId: optional(uuid()),
  sizeCode: optional(string()),
});
export const safetyView = object({
  checkedAt: string(),
  status: enumeration(['current', 'review_required', 'unavailable']),
  matched: array(string()).check(maxLength(1000)),
  unresolved: boolean(),
});
export const reportOutputView = object({
  purpose: literal('technical_evaluation'),
  issuanceAuthorized: literal(false),
  historical: literal(true),
  result: object({
    asOf: string(),
    versions: object({
      engine: string(),
      schema: number(),
      policy: string(),
      scoring: string(),
      bundleId: uuid(),
      datasets: ids,
      ruleVersionId: uuid(),
    }),
    picks: array(uuid()).check(maxLength(5)),
    decisions: array(
      object({
        id: uuid(),
        status: enumeration(['eligible', 'blocked', 'unverified']),
        reasons: array(string()).check(maxLength(100)),
        scoreBp: nullable(number().check(int(), minimum(0), maximum(10000))),
        confidence: optional(nullable(number().check(int(), minimum(0), maximum(3)))),
        suitability: optional(nullable(enumeration(['comparable', 'evidence_limited']))),
        budget: optional(nullable(enumeration(['within', 'above', 'unknown', 'not_requested']))),
      }),
    ).check(maxLength(1000)),
    exclusions: optional(nullable(ids)),
    aboveBudget: optional(nullable(ids)),
    budgetUnknown: optional(nullable(ids)),
  }),
  options: array(object({ id: uuid(), front: sku, rear: sku })).check(maxLength(1000)),
  products: array(
    object({
      id: optional(uuid()),
      modelId: optional(uuid()),
      brand: optional(string()),
      model: optional(string()),
      sizeCode: optional(string()),
    }),
  ).check(maxLength(1000)),
  prices: array(
    object({
      id: uuid(),
      planId: optional(nullable(uuid())),
      currency: literal('USD'),
      quantity: number().check(int(), minimum(1), maximum(4)),
      asOf: string(),
      observedAt: string(),
      validUntil: nullable(string()),
      freshness: enumeration(['fresh', 'stale', 'expired', 'unavailable']),
      merchandise: nullable(money),
      installed: nullable(money),
      historical: literal(true),
      reasons: optional(array(string())),
      assumptionVersion: optional(string()),
    }),
  ).check(maxLength(1000)),
  sources: optional(
    array(
      object({ datasetId: uuid(), kind: string(), fetchedAt: string(), validUntil: string() }),
    ).check(maxLength(100)),
  ),
  followUp: optional(
    object({
      maintenance: literal('not_assessed'),
      questions: array(string()).check(maxLength(100)),
    }),
  ),
});
export const ownerReportView = object({
  reportId: uuid(),
  version,
  revision,
  input: assessmentInputSchema,
  output: reportOutputView,
  diff: nullable(
    object({
      answersChanged: boolean(),
      dataChanged: boolean(),
      rulesChanged: boolean(),
      scoresComparable: boolean(),
      added: ids,
      removed: ids,
      reranked: ids,
    }),
  ),
  safety: safetyView,
});
export const draftView = object({
  reportId: uuid(),
  draft: nullable(
    object({
      baseVersion: version,
      schemaVersion: literal(1),
      revision,
      input: assessmentInputSchema,
      expiresAt: string(),
    }),
  ),
});
export const reportCommandView = object({
  schema_version: literal(1),
  resource_id: uuid(),
  status: enumeration(['created', 'accepted']),
  report_id: uuid(),
  report_version: version,
  result_revision: optional(revision),
});
export type OwnerReportView = ReturnType<typeof ownerReportView.parse>;
export type DraftView = NonNullable<ReturnType<typeof draftView.parse>['draft']>;
export type ReportOutputView = ReturnType<typeof reportOutputView.parse>;
export type SafetyView = ReturnType<typeof safetyView.parse>;
