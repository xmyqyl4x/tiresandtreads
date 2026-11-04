export {
  money,
  when,
  range,
  reason,
  confidence,
} from '../../../../packages/contracts/src/report-display.ts';

export function showDollarInput(minor: string | undefined) {
  if (!minor || !/^\d{1,19}$/.test(minor)) return '';
  const n = BigInt(minor);
  return (n / 100n).toString() + '.' + (n % 100n).toString().padStart(2, '0');
}
export function parseDollarInput(text: string): string | null | false {
  const s = text.trim();
  if (!s) return null;
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return false;
  const [d, c = ''] = s.split('.');
  return (BigInt(d!) * 100n + BigInt(c.padEnd(2, '0'))).toString();
}

export function decisionLabel(decision: {
  status: 'eligible' | 'blocked' | 'unverified';
  budget?: 'within' | 'above' | 'unknown' | 'not_requested' | null | undefined;
}) {
  if (decision.status === 'blocked') return 'Blocked option';
  if (decision.status === 'unverified') return 'Unverified option';
  if (decision.budget === 'above') return 'Eligible option · above stated budget';
  if (decision.budget === 'unknown') return 'Eligible option · budget unknown';
  if (decision.budget === 'within') return 'Eligible alternative · within stated budget';
  return 'Eligible alternative';
}
