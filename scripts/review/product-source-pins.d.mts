import type { ReviewPin } from './evidence-catalog.mjs';
export const productPinsPath: string;
export const editorialPinsPath: string;
export function reconcileProductPins(
  root: string,
  rawPins: unknown,
): { pins: ReviewPin[]; exceptions: number };
