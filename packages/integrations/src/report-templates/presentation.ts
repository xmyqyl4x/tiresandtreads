import type { DeliveryDocument } from '../../../application/src/ports/delivery-services.ts';
import {
  money,
  reason,
  confidence,
  quotedDifference,
} from '../../../contracts/src/report-display.ts';
import type {
  ReportPresentation,
  TemplateProfile,
  TemplateContext,
  PresentedOption,
} from './types.ts';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function requireValue(value: unknown): asserts value {
  if (!value) throw Error('Report template unavailable');
}
const object = (v: unknown): Record<string, unknown> => {
  requireValue(v && typeof v === 'object' && !Array.isArray(v));
  return v as Record<string, unknown>;
};
function text(v: unknown, max = 500): string {
  requireValue(
    typeof v === 'string' &&
      v.trim().length > 0 &&
      v.length <= max &&
      ![...v].some((c) => {
        const n = c.codePointAt(0)!;
        return (
          (n < 32 && n !== 9 && n !== 10) ||
          n === 127 ||
          (n >= 0x202a && n <= 0x202e) ||
          (n >= 0x2066 && n <= 0x2069)
        );
      }),
  );
  return v.replace(/\s+/g, ' ').trim();
}
function list(v: unknown, max: number): unknown[] {
  requireValue(Array.isArray(v) && v.length <= max);
  return v;
}
function at(v: unknown) {
  const s = text(v, 32);
  requireValue(Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s);
  return s;
}
function optionalText(v: unknown, fallback: string, max = 500) {
  return v === undefined || v === null ? fallback : text(v, max);
}
function freeze<T>(v: T): T {
  if (v && typeof v === 'object') {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
}
function amount(v: unknown) {
  if (v === undefined || v === null) return 'Unavailable';
  const a = object(v);
  requireValue(
    a.currency === 'USD' &&
      typeof a.low === 'string' &&
      /^\d{1,19}$/.test(a.low) &&
      typeof a.high === 'string' &&
      /^\d{1,19}$/.test(a.high),
  );
  requireValue(BigInt(a.low) <= BigInt(a.high));
  return (a.low === a.high ? money(a.low) : money(a.low) + '-' + money(a.high)) + ' USD';
}
function prices(v: unknown) {
  const p = v == null ? {} : object(v),
    q = p.quantity;
  requireValue(q == null || (Number.isSafeInteger(q) && Number(q) >= 1 && Number(q) <= 8));
  requireValue(p.currency === undefined || p.currency === 'USD');
  return {
    quantity: q == null ? 'Quantity unavailable' : String(q) + (q === 1 ? ' tire' : ' tires'),
    installed: amount(p.installed),
    merchandise: amount(p.merchandise),
  };
}
function preferenceScore(value: unknown) {
  requireValue(
    value == null ||
      (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10000),
  );
  return value == null ? 'Unavailable' : (Number(value) / 100).toFixed(2) + ' / 100';
}
function outcome(value: unknown, allowed: readonly string[]) {
  if (value == null) return 'Unavailable';
  requireValue(typeof value === 'string' && allowed.includes(value));
  return value;
}
function difference(value: unknown) {
  if (value == null) return 'Unavailable';
  const d = object(value);
  requireValue(
    d.currency === 'USD' &&
      typeof d.lowMinor === 'string' &&
      /^-?\d{1,19}$/.test(d.lowMinor) &&
      typeof d.highMinor === 'string' &&
      /^-?\d{1,19}$/.test(d.highMinor),
  );
  requireValue(BigInt(d.lowMinor) <= BigInt(d.highMinor));
  return quotedDifference({ lowMinor: d.lowMinor, highMinor: d.highMinor, currency: 'USD' });
}
function privateUrl(
  raw: string,
  origin: string,
  path: string,
  purpose: 'share' | 'unsubscribe' | 'verify',
) {
  const u = new URL(raw);
  requireValue(
    u.origin === origin &&
      u.pathname === path &&
      !u.username &&
      !u.password &&
      !u.search &&
      raw.length <= 1024,
  );
  const p = u.hash.slice(1).split('.');
  requireValue(
    p.length === 4 &&
      p[0] === purpose &&
      /^[A-Za-z0-9_-]{1,80}$/.test(p[1] ?? '') &&
      uuid.test(p[2] ?? '') &&
      /^[a-f0-9]{64}$/.test(p[3] ?? ''),
  );
  return u.href;
}
export function presentReport(
  document: DeliveryDocument,
  rawProfile: TemplateProfile,
  rawContext: TemplateContext,
): ReportPresentation {
  requireValue(Buffer.byteLength(JSON.stringify(document)) <= 524288);
  const d = structuredClone(document),
    profile = structuredClone(rawProfile),
    context = structuredClone(rawContext);
  requireValue(
    d.schemaVersion === 1 &&
      typeof d.fixture === 'boolean' &&
      d.locale === 'en-US' &&
      d.market === 'US',
  );
  requireValue(uuid.test(d.template.id) && /^[a-f0-9]{64}$/.test(d.template.rendererHash));
  text(d.template.version, 100);
  text(d.policyVersion, 100);
  requireValue(
    typeof d.sender === 'string' &&
      d.sender.length <= 254 &&
      !/[\r\n\0]/.test(d.sender) &&
      d.sender.includes('@'),
  );
  const origin = new URL(profile.origin);
  requireValue(
    origin.protocol === 'https:' &&
      origin.origin === profile.origin &&
      !origin.username &&
      !origin.password,
  );
  const senderName = text(profile.senderName, 100),
    postalAddress = list(profile.postalAddress, 4).map((x) => text(x, 150));
  requireValue(postalAddress.length > 0);
  for (const p of Object.values(profile.routes))
    requireValue(/^\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(p));
  const report = object(d.report),
    r = object(report.result),
    asOf = at(r.asOf),
    expiresAt = at(context.expiresAt);
  requireValue(
    expiresAt > asOf &&
      uuid.test(String(report.reportId)) &&
      Number.isSafeInteger(report.version) &&
      Number(report.version) > 0,
  );
  const reference = {
    reportId: String(report.reportId),
    version: Number(report.version),
    comparisonRevision: d.comparison === null ? null : String(object(d.comparison).revision),
  };
  requireValue(
    context.reportId === reference.reportId &&
      context.version === reference.version &&
      context.comparisonRevision === reference.comparisonRevision,
  );
  if (reference.comparisonRevision !== null)
    requireValue(/^[1-9][0-9]{0,18}$/.test(reference.comparisonRevision));
  const links = {
    view: privateUrl(context.viewUrl, origin.origin, profile.routes.report, 'share'),
    preferences: privateUrl(
      context.preferencesUrl,
      origin.origin,
      profile.routes.preferences,
      'unsubscribe',
    ),
    confirmation:
      context.offersConfirmationUrl === null
        ? null
        : privateUrl(
            context.offersConfirmationUrl,
            origin.origin,
            profile.routes.confirmation,
            'verify',
          ),
    privacy: origin.origin + profile.routes.privacy,
    expiresAt,
  };
  const picks = list(r.picks, 5),
    decisions = list(r.decisions, 1000).map(object),
    options = list(report.options ?? [], 1000).map(object),
    products = list(report.products ?? [], 1000).map(object),
    priceRows = list(report.prices ?? [], 1000).map(object);
  requireValue(
    new Set(picks).size === picks.length &&
      picks.every((p) => typeof p === 'string' && uuid.test(p)),
  );
  const presented: PresentedOption[] = picks.map((id, index) => {
    const decision = decisions.filter((x) => x.id === id);
    requireValue(decision.length === 1);
    const dec = decision[0]!,
      o = options.filter((x) => x.id === id);
    requireValue(o.length <= 1);
    const front = o[0]?.front ? object(o[0].front) : {},
      rear = o[0]?.rear ? object(o[0].rear) : {};
    const exact = products.filter((x) => front.id !== undefined && x.id === front.id);
    const product = exact.length
      ? exact
      : products.filter((x) => front.modelId !== undefined && x.modelId === front.modelId);
    requireValue(product.length <= 1);
    const p = product[0];
    const selectedPrices = priceRows.filter((x) => x.planId === id);
    requireValue(selectedPrices.length <= 1);
    const score = dec.scoreBp;
    requireValue(
      score == null || (Number.isInteger(score) && Number(score) >= 0 && Number(score) <= 10000),
    );
    requireValue(['eligible', 'blocked', 'unverified'].includes(String(dec.status)));
    return {
      kind: 'catalog',
      fitment: null,
      climate: null,
      product: null,
      difference: null,
      evidenceLabel: 'evidence confidence',
      id: String(id),
      label: p
        ? [optionalText(p.brand, '', 160), optionalText(p.model, '', 340)]
            .filter(Boolean)
            .join(' ') || 'Option ' + (index + 1)
        : 'Option ' + (index + 1),
      size:
        'Front: ' +
        optionalText(front.sizeCode, 'Unavailable', 40) +
        '; rear: ' +
        optionalText(rear.sizeCode, 'Unavailable', 40),
      status:
        dec.status === 'eligible'
          ? 'Eligible in the recorded comparison'
          : dec.status === 'blocked'
            ? 'Blocked option'
            : 'Unverified option',
      score: preferenceScore(score),
      ...prices(selectedPrices[0]),
      evidence: confidence(typeof dec.confidence === 'number' ? dec.confidence : null),
      reasons: list(dec.reasons ?? [], 100)
        .slice(0, 8)
        .map((x) => {
          requireValue(typeof x === 'string' && /^[A-Z_]{1,80}$/.test(x));
          return reason(x);
        }),
    };
  });
  const comparison: PresentedOption[] =
    d.comparison === null
      ? []
      : list(object(d.comparison).items, 4).map((v, index) => {
          const item = object(v),
            s = object(item.snapshot),
            verdict = s.verdict == null ? {} : object(s.verdict);
          requireValue(item.kind === 'catalog' || item.kind === 'quote');
          requireValue(item.kind !== 'quote' || s.scoreBp == null);
          const fitment = outcome(s.fit ?? verdict.fit, ['eligible', 'blocked', 'unverified']);
          const climate = outcome(s.climate ?? verdict.climate, [
            'suitable',
            'unsuitable',
            'unknown',
          ]);
          requireValue(s.productKnown == null || typeof s.productKnown === 'boolean');
          requireValue(
            verdict.evidenceMissing == null || typeof verdict.evidenceMissing === 'boolean',
          );
          return {
            kind: item.kind,
            fitment,
            climate,
            product:
              s.productKnown === true
                ? 'Product recognized in the evaluated evidence.'
                : s.productKnown === false
                  ? 'Unverified product; no fitment or suitability approval.'
                  : 'Product recognition unavailable.',
            difference: difference(verdict.delta),
            evidenceLabel: 'comparison evidence',
            id: String(index + 1),
            label: (item.kind === 'quote' ? 'Private quote ' : 'Catalog selection ') + (index + 1),
            size: 'See the recorded private comparison for fitment details',
            status:
              fitment === 'blocked'
                ? 'Blocked option - recorded fitment is incompatible'
                : climate === 'unsuitable'
                  ? 'Climate unsuitable in the recorded evidence'
                  : fitment === 'eligible'
                    ? 'Eligible in recorded fitment evidence'
                    : 'Unverified option - no fitment approval',
            score: preferenceScore(s.scoreBp),
            evidence:
              verdict.evidenceMissing === true
                ? 'Required comparison evidence is missing'
                : verdict.evidenceMissing === false
                  ? 'Recorded comparison evidence'
                  : 'Comparison evidence status unavailable',
            ...prices(s.price),
            reasons: [
              verdict.relation === undefined
                ? 'Relationship unavailable'
                : 'Cost relationship: ' + text(verdict.relation, 80).replaceAll('_', ' '),
            ],
          };
        });
  const learning = list(d.learning, 6).map((x) => {
    const l = object(x);
    requireValue(
      typeof l.path === 'string' &&
        /^\/(learn|guides|glossary)\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(l.path) &&
        at(l.expiresAt) > asOf,
    );
    return { title: text(l.title, 180), url: origin.origin + l.path };
  });
  requireValue(new Set(learning.map((x) => x.url)).size === learning.length);
  const versions = object(r.versions),
    provenance = [
      'Engine: ' + optionalText(versions.engine, 'Unavailable', 100),
      'Policy: ' + optionalText(versions.policy, 'Unavailable', 100),
      'Scoring: ' + optionalText(versions.scoring, 'Unavailable', 100),
    ];
  return freeze({
    reference,
    asOf,
    fixture: d.fixture,
    senderName,
    postalAddress,
    locale: 'en-US',
    title: 'Your tire assessment',
    subject:
      (d.fixture ? '[Local preview] ' : '') +
      'Your Tires & Tread assessment - version ' +
      reference.version,
    disclosure:
      'Not a physical inspection or safety clearance. Scores describe recorded preferences, not tire safety. Prices and source evidence are historical. No sponsored offers or affiliate links are included.',
    inputSummary:
      'Vehicle and condition details are unavailable in this frozen copy. Check the private report and a qualified professional before buying.',
    options: presented,
    comparison,
    decisions: decisions
      .filter((x) => !picks.includes(x.id))
      .slice(0, 8)
      .map((x) => {
        requireValue(['eligible', 'blocked', 'unverified'].includes(String(x.status)));
        return (
          'Additional ' +
          String(x.status) +
          ' option: ' +
          list(x.reasons ?? [], 100)
            .slice(0, 3)
            .map((v) => reason(String(v)))
            .join(' ')
        );
      }),
    provenance,
    learning,
    links,
  });
}
