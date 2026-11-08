import type { ReviewPin } from './evidence-catalog.mjs';
export const productPinsPath: string;
export const editorialPinsPath: string;
export function reconcileProductPins(
  root: string,
  rawPins: unknown,
): { pins: ReviewPin[]; exceptions: number };

export const photoDependencyPins: readonly Readonly<{
  path: string;
  baselineSha256: string;
  currentSha256: string;
  reason: string;
}>[];
export const apiContractPins: typeof photoDependencyPins;
