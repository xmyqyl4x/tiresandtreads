import { redirectRules, type RedirectRule } from '../../domain/src/public-policy.ts';
// Bounded RFC 4180-style interchange; paths are narrower than arbitrary CSV strings.
export function parseRedirectCsv(input: string): readonly RedirectRule[] {
  if (typeof input !== 'string' || Buffer.byteLength(input) > 65536)
    throw Error('Invalid redirect CSV');
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false,
    closed = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += c;
      continue;
    }
    if (c === '"') {
      if (field || closed) throw Error('Invalid CSV quote');
      quoted = true;
      continue;
    }
    if (c === ',' || c === '\n' || c === '\r') {
      row.push(field);
      field = '';
      closed = false;
      if (c !== ',') {
        if (c === '\r' && input[i + 1] === '\n') i++;
        rows.push(row);
        row = [];
        if (rows.length > 201) throw Error('Too many redirects');
      }
      continue;
    }
    if (closed) throw Error('Invalid CSV trailing text');
    field += c;
  }
  if (quoted) throw Error('Unclosed CSV field');
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const header = rows.shift();
  if (header?.join(',') !== 'source,target,code,mode') throw Error('Invalid redirect header');
  return redirectRules(
    rows.map((r) => {
      if (r.length !== 4) throw Error('Invalid redirect row');
      return {
        source: r[0]!,
        target: r[1] || null,
        code: Number(r[2]) as RedirectRule['code'],
        mode: r[3] as NonNullable<RedirectRule['mode']>,
      };
    }),
  );
}
