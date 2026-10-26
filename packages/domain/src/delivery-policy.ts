import { instant } from './values/core.ts';
import { instantMilliseconds } from './values/time.ts';
function requireValue(value: unknown): asserts value {
  if (!value) throw Error('Invalid delivery policy');
}
export function retryDecision(first: string, now: string, attempts: number) {
  const a = instant(first),
    b = instant(now);
  requireValue(a.ok && b.ok && Number.isSafeInteger(attempts) && attempts >= 0);
  const elapsed = instantMilliseconds(b.value) - instantMilliseconds(a.value);
  requireValue(elapsed >= 0);
  return elapsed >= 23 * 3600000 || attempts >= 5 ? ('manual_review' as const) : ('retry' as const);
}
export interface FixedMail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly pdf: string;
  readonly fixture: boolean;
  readonly commercial: false;
}
export function validateMail(value: FixedMail): FixedMail {
  requireValue(Object.keys(value).sort().join(',') === 'commercial,fixture,html,pdf,subject,text');
  requireValue(
    typeof value.subject === 'string' &&
      value.subject.trim().length > 0 &&
      value.subject.length <= 200 &&
      ![...value.subject].some((c) => c.charCodeAt(0) < 32),
  );
  requireValue(
    typeof value.html === 'string' &&
      value.html.length > 0 &&
      new TextEncoder().encode(value.html).length < 100000,
  );
  requireValue(
    typeof value.text === 'string' &&
      value.text.length > 0 &&
      new TextEncoder().encode(value.text).length <= 65536,
  );
  requireValue(
    typeof value.pdf === 'string' &&
      value.pdf.startsWith('JVBERi0') &&
      value.pdf.length <= 6 * 1024 * 1024 &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(value.pdf) &&
      value.pdf.length % 4 === 0,
  );
  requireValue(typeof value.fixture === 'boolean' && value.commercial === false);
  return value;
}
