import './browser-runtime.ts';
import { z } from 'zod';
import { editorialDraftSchema } from './editorial-client.ts';
const path = z
  .string()
  .max(500)
  .regex(/^(\/|\/(learn|guides|glossary)\/[a-z0-9]+(-[a-z0-9]+)*)$/);
const https = z.url().refine((s) => {
  const u = new URL(s);
  return u.protocol === 'https:' && !u.username && !u.password && !u.port && !u.search && !u.hash;
});
export const educationPageSchema = z
  .strictObject({
    content: z.strictObject({
      kind: z.enum(['article', 'glossary']),
      contentKey: z.string().min(1).max(200),
      path,
      canonical: path,
      locale: z.literal('en-US'),
      market: z.literal('US'),
      title: z.string().min(1).max(200),
      summary: z.string().min(1).max(1000),
      paragraphs: z.array(z.string().min(1).max(2000)).min(1).max(100),
      topics: editorialDraftSchema.shape.topics,
      related: z.array(path).max(12),
      author: z.string().min(1).max(100),
      reviewer: z.string().min(1).max(100),
      reviewedAt: z.iso.datetime(),
      modifiedAt: z.iso.datetime(),
      expiresAt: z.iso.datetime(),
      references: editorialDraftSchema.shape.references.optional(),
      questions: editorialDraftSchema.shape.questions,
    }),
    metadata: z.object({ canonical: https }),
    hreflang: z
      .array(
        z.strictObject({
          locale: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/),
          url: https,
        }),
      )
      .max(20),
    navigation: z
      .strictObject({
        items: z
          .array(
            z.strictObject({
              path,
              kind: z.enum(['article', 'glossary']),
              title: z.string().min(1).max(200),
              summary: z.string().min(1).max(1000),
              topics: editorialDraftSchema.shape.topics,
            }),
          )
          .max(100),
        hasMore: z.boolean(),
      })
      .optional(),
  })
  .refine((v) => {
    const u = new URL(v.metadata.canonical);
    return (
      u.pathname === v.content.canonical &&
      v.hreflang.every(
        (h) =>
          new URL(h.url).origin === u.origin && path.safeParse(new URL(h.url).pathname).success,
      )
    );
  });
export type EducationPage = z.infer<typeof educationPageSchema>;
export const educationRedirectSchema = z
  .strictObject({
    redirect: z.strictObject({
      code: z.union([z.literal(301), z.literal(302), z.literal(410)]),
      target: path.nullable(),
    }),
  })
  .refine((x) =>
    x.redirect.code === 410 ? x.redirect.target === null : x.redirect.target !== null,
  );
export const decodedMarkingSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('unsupported'), fitmentVerified: z.literal(false) }),
  z.strictObject({
    status: z.literal('decoded'),
    type: z.enum(['P', 'LT']).nullable(),
    widthMm: z.number().int().min(100).max(999),
    aspectPercent: z.number().int().min(1).max(99),
    construction: z.literal('radial'),
    rimInches: z.number().int().min(10).max(39),
    loadIndex: z.number().int().min(10).max(999).nullable(),
    speedCode: z
      .string()
      .regex(/^[A-Z]$/)
      .nullable(),
    loadCapacity: z.null(),
    speedLimit: z.null(),
    fitmentVerified: z.literal(false),
  }),
]);
export interface EducationTool {
  input: string;
  result: z.infer<typeof decodedMarkingSchema>;
}
export const checklistAnswersSchema = z
  .array(
    z.strictObject({
      key: z.number().int().min(1).max(14),
      answer: z.enum(['good', 'concern', 'unknown']),
    }),
  )
  .length(14)
  .refine((a) => new Set(a.map((v) => v.key)).size === 14);
export const checklistScoreSchema = z
  .strictObject({
    good: z.number().int().min(0).max(14),
    concerns: z.number().int().min(0).max(14),
    unknown: z.number().int().min(0).max(14),
    summary: z.enum(['discuss_concerns', 'incomplete', 'answers_recorded']),
    safetyVerified: z.literal(false),
  })
  .refine(
    (s) =>
      s.good + s.concerns + s.unknown === 14 &&
      s.summary ===
        (s.concerns ? 'discuss_concerns' : s.unknown ? 'incomplete' : 'answers_recorded'),
  );
export interface ChecklistTool {
  answers: z.infer<typeof checklistAnswersSchema>;
  result: z.infer<typeof checklistScoreSchema>;
}
export const checklistStorageSchema = z.strictObject({
  version: z.literal(1),
  revision: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  answers: checklistAnswersSchema,
});
export function jsonForHtml(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
const xml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
export function sitemapXml(items: readonly { loc: string; lastmod: string }[]) {
  if (items.length > 1000) throw Error('Sitemap bound exceeded');
  const origin = items.length ? new URL(items[0]!.loc).origin : null;
  return (
    '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    items
      .map((p) => {
        https.parse(p.loc);
        const u = new URL(p.loc);
        if (u.origin !== origin || !path.safeParse(u.pathname).success)
          throw Error('Private or cross-site sitemap URL refused');
        z.iso.datetime().parse(p.lastmod);
        return '<url><loc>' + xml(p.loc) + '</loc><lastmod>' + xml(p.lastmod) + '</lastmod></url>';
      })
      .join('') +
    '</urlset>'
  );
}
