export interface ReviewPin {
  readonly path: string;
  readonly sha256: string;
}
export interface PinCatalog {
  sources: ReviewPin[];
  historical: ReviewPin[];
  inputs: ReviewPin[];
  sp08: ReviewPin[];
  all: ReviewPin[];
  priorExceptions: 5;
  localToolExceptions: 2;
}
export const manifestPaths: readonly string[];
export const supplementalHistoryPaths: readonly string[];
export const inputPaths: readonly string[];
export function reviewPath(raw: unknown): string;
export function pinList(raw: unknown): ReviewPin[];
export function mergeReviewedPins(
  previous: unknown,
  current: unknown,
  exceptions: unknown,
): ReviewPin[];
export function combinePins(raw: unknown): ReviewPin[];
export function compileEvidenceCatalog(raw: unknown): PinCatalog;
