import type { createCommercialServices } from '../services/commercial.ts';
import {
  commercialPages,
  presentSlots,
  retailerLinks,
} from '../../../domain/src/commercial-presentation.ts';

type Commercial = Pick<
  ReturnType<typeof createCommercialServices>,
  'placements' | 'resolveAffiliate' | 'adsTxt'
>;
const empty = () => ({ network: 'held' as const, slots: [], affiliates: [], refreshSeconds: null });
export function createPublicCommerceQuery(
  commercial: Commercial,
  content: (path: string) => Promise<number | null>,
) {
  return {
    async inventory(path: string) {
      if (!commercialPages.has(path)) return empty();
      try {
        const characters = await content(path);
        if (characters === null || !Number.isSafeInteger(characters) || characters < 600)
          return empty();
        const r = await commercial.placements(path, 'US', {
          consent: false,
          cmpAvailable: false,
          gpc: true,
          under13: false,
          internal: true,
          blocked: true,
          filled: false,
        });
        if (!r.ok) return empty();
        const slots = presentSlots(path, characters, r.value);
        const valid = await Promise.all(
          slots.map(async (s) => ((await content(s.housePath)) === null ? null : s)),
        );
        const affiliates = await Promise.all(
          retailerLinks.map(async (link) => {
            const a = await commercial.resolveAffiliate(link.key, 'US');
            return a.ok && a.value
              ? {
                  key: link.key,
                  label: link.label,
                  href: '/go/' + link.key,
                  disclosure: a.value.disclosure,
                  checkedAt: a.value.checkedAt,
                }
              : null;
          }),
        );
        return {
          network: 'held' as const,
          slots: valid
            .filter((s) => s !== null)
            .map(({ key, width, height, housePath, houseLabel, mode, label }) => ({
              key,
              width,
              height,
              housePath,
              houseLabel,
              mode,
              label,
            })),
          affiliates: affiliates.filter((a) => a !== null),
          refreshSeconds: null,
        };
      } catch {
        return empty();
      }
    },
    async affiliate(key: string) {
      if (!retailerLinks.some((l) => l.key === key)) return null;
      const r = await commercial.resolveAffiliate(key, 'US');
      return r.ok ? r.value : null;
    },
    adsTxt: () => commercial.adsTxt(),
  };
}
