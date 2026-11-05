import type { AdSlot } from './commercial-policy.ts';

// Manual inventory: adding a route requires a content, privacy and layout review.
const pages = new Set([
  '/learn/tire-basics',
  '/learn/glossary',
  '/guides/how-we-choose',
  '/guides/trust',
]);
export const commercialPages = Object.freeze({ has: (path: string) => pages.has(path) });
export const retailerLinks = Object.freeze([
  Object.freeze({ key: 'approved_retailer', label: 'Visit a retailer' }),
] as const);
export function presentSlots(path: string, characters: number, slots: readonly AdSlot[]) {
  if (!commercialPages.has(path) || !Number.isSafeInteger(characters) || characters < 600)
    return [];
  const limit = characters >= 1600 ? 2 : 1;
  return slots
    .filter((s) => s.width >= 100 && s.width <= 970 && s.height >= 50 && s.height <= 128)
    .slice(0, limit)
    .map((s) => ({ ...s, mode: 'house' as const, label: 'From Tires & Tread' as const }));
}
// The 30% density ceiling is our policy. It includes house/sponsor placements.
export function densityPermits(nonCommercialHeight: number, totalSlotHeight: number) {
  return (
    Number.isFinite(nonCommercialHeight) &&
    nonCommercialHeight > 0 &&
    Number.isFinite(totalSlotHeight) &&
    totalSlotHeight > 0 &&
    totalSlotHeight / (nonCommercialHeight + totalSlotHeight) <= 0.3
  );
}
