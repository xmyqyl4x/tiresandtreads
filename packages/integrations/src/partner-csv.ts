import { couponCode } from '../../domain/src/partner-policy.ts';
export interface CouponCsvRow {
  readonly row: number;
  readonly code: string | null;
  readonly reason: string | null;
}
// Fixed one-column RFC4180 profile. No formula execution, external references or arbitrary mappings.
export function* couponCsv(bytes: Uint8Array): Generator<CouponCsvRow> {
  if (!(bytes instanceof Uint8Array) || bytes.length < 5 || bytes.length > 16777216)
    throw Error('Invalid bounded CSV');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  if (text.includes('\0')) throw Error('Invalid bounded CSV');
  let position = 0,
    line = 0,
    header = false;
  while (position < text.length) {
    let value = '',
      quoted = false,
      closed = false,
      columns = 1,
      invalid = false;
    if (text[position] === '"') {
      quoted = true;
      position++;
    }
    while (position < text.length) {
      const c = text[position++]!;
      if (quoted && !closed) {
        if (c === '"') {
          if (text[position] === '"') {
            value += '"';
            position++;
          } else closed = true;
        } else {
          value += c;
        }
      } else {
        if (c === '\n') break;
        if (c === '\r') {
          if (text[position] === '\n') position++;
          else invalid = true;
          break;
        }
        if (c === ',') {
          columns++;
          invalid = true;
        } else if (quoted && closed) {
          invalid = true;
        } else if (c === '"') {
          invalid = true;
        } else value += c;
      }
      if (value.length > 512) throw Error('CSV field too large');
    }
    if (quoted && !closed) invalid = true;
    if (!header) {
      if (invalid || columns !== 1 || value.trim().toLowerCase() !== 'code')
        throw Error('Expected code column');
      header = true;
      continue;
    }
    line++;
    if (line > 100000) throw Error('CSV row limit exceeded');
    const parsed = couponCode(value);
    yield Object.freeze({
      row: line,
      code: !invalid && parsed.ok ? parsed.value : null,
      reason: invalid ? 'malformed_csv' : parsed.ok ? null : 'invalid_code',
    });
  }
  if (!header || line === 0) throw Error('CSV contains no codes');
}
