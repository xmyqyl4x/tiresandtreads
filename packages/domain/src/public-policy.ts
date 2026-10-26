import { instant } from './values/core.ts';
import { instantMilliseconds } from './values/time.ts';
export const contentTopics = [
  'size',
  'ratings',
  'winter',
  'wet',
  'types',
  'maintenance',
  'buying',
  'warranty',
  'noise',
  'efficiency',
  'heat',
  'off_road',
  'ev',
  'run_flat',
] as const;
export type Topic = (typeof contentTopics)[number];
function requireValue(x: unknown): asserts x {
  if (!x) throw Error('Invalid public policy');
}
function milliseconds(value: string) {
  const r = instant(value);
  requireValue(r.ok);
  return instantMilliseconds(r.value);
}
export function publicPath(value: unknown): string {
  requireValue(
    typeof value === 'string' &&
      value.length <= 500 &&
      (value === '/' ||
        /^\/(learn|guides|glossary)\/[a-z0-9]+(-[a-z0-9]+)*$/.test(value) ||
        /^\/tires\/(models|sizes)\/[a-z0-9]+(-[a-z0-9]+)*$/.test(value)),
  );
  return value;
}
export function plain(value: unknown, max: number): string {
  requireValue(
    typeof value === 'string' &&
      value.trim().length > 0 &&
      value.length <= max &&
      !/[<>]/.test(value) &&
      ![...value].some((c) => c.charCodeAt(0) < 32),
  );
  return value.trim();
}
export interface PublicPage {
  readonly questions?: readonly ChecklistItem[];
  readonly kind: 'article' | 'glossary';
  readonly contentKey: string;
  readonly path: string;
  readonly canonical: string;
  readonly locale: string;
  readonly market: string;
  readonly title: string;
  readonly summary: string;
  readonly paragraphs: readonly string[];
  readonly topics: readonly Topic[];
  readonly related: readonly string[];
  readonly author: string;
  readonly reviewer: string;
  readonly reviewedAt: string;
  readonly modifiedAt: string;
  readonly expiresAt: string;
}
export function validatePage(input: PublicPage): PublicPage {
  requireValue(
    Object.keys(input)
      .filter((k) => k !== 'questions')
      .sort()
      .join(',') ===
      'author,canonical,contentKey,expiresAt,kind,locale,market,modifiedAt,paragraphs,path,related,reviewedAt,reviewer,summary,title,topics',
  );
  if (input.questions !== undefined) {
    requireValue(input.path === '/guides/before-you-buy');
    checklist(input.questions);
  }
  requireValue(input.kind === 'article' || input.kind === 'glossary');
  publicPath(input.path);
  publicPath(input.canonical);
  requireValue(input.kind !== 'glossary' || input.path.startsWith('/glossary/'));
  requireValue(
    /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(input.locale) &&
      /^[A-Z][A-Z0-9_-]{1,15}$/.test(input.market),
  );
  plain(input.contentKey, 200);
  plain(input.title, 200);
  plain(input.summary, 1000);
  plain(input.author, 100);
  plain(input.reviewer, 100);
  requireValue(
    Array.isArray(input.paragraphs) &&
      input.paragraphs.length > 0 &&
      input.paragraphs.length <= 100,
  );
  input.paragraphs.forEach((p) => plain(p, 2000));
  requireValue(
    Array.isArray(input.topics) &&
      input.topics.length > 0 &&
      input.topics.length <= 14 &&
      new Set(input.topics).size === input.topics.length &&
      input.topics.every((p) => contentTopics.includes(p)),
  );
  requireValue(
    Array.isArray(input.related) &&
      input.related.length <= 12 &&
      new Set(input.related).size === input.related.length,
  );
  input.related.forEach(publicPath);
  for (const d of [input.reviewedAt, input.modifiedAt, input.expiresAt])
    requireValue(instant(d).ok);
  requireValue(input.reviewedAt <= input.modifiedAt && input.modifiedAt < input.expiresAt);
  return input;
}
export function siteOrigin(value: string): string {
  const u = new URL(value);
  requireValue(
    u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      !u.port &&
      u.pathname === '/' &&
      !u.search &&
      !u.hash &&
      !/^([0-9.]+|localhost|.*\.localhost)$/.test(u.hostname),
  );
  return u.origin;
}
export function metadata(page: PublicPage, origin: string, production: boolean, asOf: string) {
  validatePage(page);
  const base = siteOrigin(origin),
    index =
      production &&
      page.modifiedAt <= asOf &&
      page.expiresAt > asOf &&
      page.canonical === page.path;
  const url = base + page.path;
  return {
    title: page.title,
    description: page.summary,
    canonical: base + page.canonical,
    robots: index ? 'index,follow' : 'noindex,nofollow',
    lastmod: page.modifiedAt,
    supportingData: [
      {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: 'Tires & Tread',
        url: base,
      },
      { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Tires & Tread', url: base },
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Tires & Tread', item: base + '/' },
          ...(page.path === '/'
            ? []
            : [{ '@type': 'ListItem', position: 2, name: page.title, item: url }]),
        ],
      },
    ],
    structuredData:
      page.kind === 'glossary'
        ? {
            '@context': 'https://schema.org',
            '@type': 'DefinedTerm',
            name: page.title,
            description: page.summary,
            url,
          }
        : {
            '@context': 'https://schema.org',
            '@type': 'Article',
            headline: page.title,
            description: page.summary,
            url,
            author: { '@type': 'Person', name: page.author },
            reviewedBy: { '@type': 'Person', name: page.reviewer },
            dateModified: page.modifiedAt,
            lastReviewed: page.reviewedAt,
          },
  };
}
export function titleTemplate(
  template: string,
  values: { title: string; siteName: string; marketName: string },
) {
  requireValue(template.length <= 300 && !/\{(?!title\}|siteName\}|marketName\})/.test(template));
  return plain(
    template.replace(/\{(title|siteName|marketName)\}/g, (_, key: keyof typeof values) =>
      plain(values[key], 200),
    ),
    200,
  );
}
export interface RedirectRule {
  readonly source: string;
  readonly target: string | null;
  readonly code: 301 | 302 | 410;
  readonly mode?: 'exact' | 'slug';
}
export function redirectRules(input: readonly RedirectRule[]): readonly RedirectRule[] {
  requireValue(Array.isArray(input) && input.length <= 200);
  const rules = input.map((r) => {
    requireValue(
      Object.keys(r).every((k) => ['source', 'target', 'code', 'mode'].includes(k)) &&
        [301, 302, 410].includes(r.code) &&
        (r.mode === undefined || r.mode === 'exact' || r.mode === 'slug'),
    );
    if (r.mode === 'slug') {
      requireValue(/^\/(learn|guides|glossary)\/\$1$/.test(r.source));
      requireValue(
        r.code === 410
          ? r.target === null
          : typeof r.target === 'string' && /^\/(learn|guides|glossary)\/\$1$/.test(r.target),
      );
    } else {
      publicPath(r.source);
      if (r.code === 410) requireValue(r.target === null);
      else publicPath(r.target);
    }
    return { source: r.source, target: r.target, code: r.code, mode: r.mode ?? 'exact' } as const;
  });
  requireValue(new Set(rules.map((r) => r.source)).size === rules.length);
  const matches = (rule: (typeof rules)[number], path: string) =>
    rule.mode === 'slug' ? path.startsWith(rule.source.slice(0, -2)) : rule.source === path;
  for (let i = 0; i < rules.length; i++)
    for (let j = 0; j < i; j++)
      requireValue(
        !matches(rules[i]!, rules[j]!.source.replace('$1', 'probe')) &&
          !matches(rules[j]!, rules[i]!.source.replace('$1', 'probe')),
      );
  // Reject every chain, including loops and exact/pattern intersections. Runtime performs one hop.
  for (const r of rules)
    if (r.target !== null)
      requireValue(!rules.some((other) => matches(other, r.target!.replace('$1', 'probe'))));
  return rules;
}
export function resolveRedirect(rules: readonly RedirectRule[], path: string) {
  publicPath(path);
  const matches = rules.filter((r) =>
    r.mode === 'slug' ? path.startsWith(r.source.slice(0, -2)) : path === r.source,
  );
  requireValue(matches.length <= 1);
  const r = matches[0];
  if (!r) return null;
  return {
    code: r.code,
    target: r.target === null ? null : r.target.replace('$1', path.split('/').at(-1)!),
  };
}
export function decodeSize(value: unknown) {
  const unsupported = { status: 'unsupported', fitmentVerified: false } as const;
  if (typeof value !== 'string' || value.length > 80) return unsupported;
  const m =
    /^(P|LT)?([1-9][0-9]{2})\/([1-9][0-9]?)R([1-3][0-9])(?: ([1-9][0-9]{1,2})([A-Z]))?$/.exec(
      value.trim().toUpperCase(),
    );
  if (!m) return unsupported;
  return {
    status: 'decoded' as const,
    type: m[1] ?? null,
    widthMm: Number(m[2]),
    aspectPercent: Number(m[3]),
    construction: 'radial' as const,
    rimInches: Number(m[4]),
    loadIndex: m[5] ? Number(m[5]) : null,
    speedCode: m[6] ?? null,
    loadCapacity: null,
    speedLimit: null,
    fitmentVerified: false,
  };
}
export function scorecard(
  answers: readonly { readonly key: number; readonly answer: 'good' | 'concern' | 'unknown' }[],
) {
  requireValue(
    Array.isArray(answers) &&
      answers.length === 14 &&
      new Set(answers.map((x) => x.key)).size === 14 &&
      answers.every(
        (x) =>
          Number.isInteger(x.key) &&
          x.key >= 1 &&
          x.key <= 14 &&
          ['good', 'concern', 'unknown'].includes(x.answer),
      ),
  );
  const good = answers.filter((x) => x.answer === 'good').length,
    concerns = answers.filter((x) => x.answer === 'concern').length,
    unknown = 14 - good - concerns;
  return {
    good,
    concerns,
    unknown,
    summary: concerns ? 'discuss_concerns' : unknown ? 'incomplete' : 'answers_recorded',
    safetyVerified: false,
  } as const;
}
export interface ChecklistItem {
  readonly key: number;
  readonly question: string;
  readonly goodAnswer: string;
  readonly redFlags: readonly string[];
  readonly glossaryPath: string;
}
export function checklist(items: readonly ChecklistItem[]) {
  requireValue(
    Array.isArray(items) && items.length === 14 && new Set(items.map((x) => x.key)).size === 14,
  );
  for (const item of items) {
    requireValue(Number.isInteger(item.key) && item.key >= 1 && item.key <= 14);
    plain(item.question, 500);
    plain(item.goodAnswer, 1000);
    requireValue(
      Array.isArray(item.redFlags) && item.redFlags.length > 0 && item.redFlags.length <= 5,
    );
    item.redFlags.forEach((x: unknown) => plain(x, 500));
    publicPath(item.glossaryPath);
    requireValue(item.glossaryPath.startsWith('/glossary/'));
  }
  return {
    schemaVersion: 1,
    items: [...items].sort((a, b) => a.key - b.key),
    safetyVerified: false,
  } as const;
}
export interface LearningPage extends PublicPage {
  readonly checklist: boolean;
}
export function learningLinks(
  pages: readonly LearningPage[],
  weights: Readonly<Partial<Record<Topic, number>>>,
  locale: string,
  market: string,
  asOf: string,
  history: { readonly permitted: boolean; readonly clicked: readonly string[] },
) {
  requireValue(
    pages.length <= 200 &&
      Object.entries(weights).every(
        ([k, v]) =>
          contentTopics.includes(k as Topic) && Number.isFinite(v) && v! >= 0 && v! <= 100,
      ),
  );
  const seen = new Set<string>(),
    counts = new Map<Topic, number>();
  const candidates = pages.filter((p) => {
    const { checklist, ...published } = p;
    requireValue(typeof checklist === 'boolean');
    validatePage(published);
    return (
      p.locale === locale &&
      p.market === market &&
      p.modifiedAt <= asOf &&
      p.expiresAt > asOf &&
      p.reviewedAt <= asOf
    );
  });
  const checklist = candidates
    .filter((p) => p.checklist)
    .sort((a, b) => a.path.localeCompare(b.path))[0];
  const score = (p: LearningPage) =>
    p.topics.reduce((n, t) => n + (weights[t] ?? 0), 0) *
    (milliseconds(asOf) - milliseconds(p.reviewedAt) <= 365 * 86400000 ? 1 : 0.7) *
    (history.permitted && history.clicked.includes(p.contentKey) ? 0.3 : 1);
  const ranked = candidates
      .filter((p) => !p.checklist && score(p) > 0)
      .sort((a, b) => score(b) - score(a) || a.path.localeCompare(b.path)),
    result: LearningPage[] = [];
  if (checklist) {
    seen.add(checklist.path);
    checklist.topics.forEach((t) => counts.set(t, 1));
  }
  for (const p of ranked) {
    if (result.length >= (checklist ? 5 : 6)) break;
    if (seen.has(p.path) || p.topics.some((t) => (counts.get(t) ?? 0) >= 2)) continue;
    result.push(p);
    seen.add(p.path);
    p.topics.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1));
  }
  if (checklist) result.push(checklist);
  return result.map((p) => ({ path: p.path, title: p.title, contentKey: p.contentKey }));
}
