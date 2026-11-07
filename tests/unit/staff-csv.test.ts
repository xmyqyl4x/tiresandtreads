import { expect, it } from 'vitest';
import {
  parseStaffCsv,
  validateCsvDefinition,
  exportCsvErrors,
} from '../../packages/domain/src/staff-csv.ts';
import type { CsvColumn } from '../../packages/domain/src/entities/csv-review.ts';
const columns: readonly CsvColumn[] = [
  { name: 'name', type: 'text', required: true },
  { name: 'count', type: 'integer', required: true },
  { name: 'enabled', type: 'boolean', required: false },
];
const parse = (s: string, c = columns, limits = { maxBytes: 16384, maxRows: 20 }) =>
  parseStaffCsv(new TextEncoder().encode(s), { columns: c, ...limits });
it('parses UTF8/BOM, quoted commas/quotes/newlines and CRLF with exact headers', () => {
  const p = parse('\ufeffname,count,enabled\r\n"A, ""quoted""\nname",42,true\r\n');
  expect(p.structurallyValid).toBe(true);
  expect(p.errors).toEqual([]);
  expect(p.rows).toEqual([{ name: 'A, "quoted"\nname', count: '42', enabled: true }]);
});
it.each([
  'name,name,enabled\nx,1,true',
  'count,name,enabled\n1,x,true',
  'name,count,enabled,extra\nx,1,true,x',
  'name,count\nx,1',
  'name,count,enabled\nx,1,true,extra',
  'name,count,enabled\n"unfinished,1,true',
  'name,count,enabled\nwrong"quote,1,true',
  'name,count,enabled\n"done"suffix,1,true',
])('refuses malformed headers/rows/quoting %#', (s) => {
  expect(parse(s).structurallyValid).toBe(false);
});
it.each(['=SUM(1)', '+cmd', '-1+cmd', '@SUM(1)', '  =cmd', '\t@cmd'])(
  'rejects spreadsheet formula text %#',
  (v) => {
    const p = parse('name,count,enabled\n"' + v + '",1,true');
    expect(p.errors.some((e) => e.code === 'formula')).toBe(true);
    expect(p.invalidRows).toEqual([1]);
    expect(exportCsvErrors(p.errors)).not.toContain(v);
  },
);
it('preserves exact signed64 integers and permits ordinary negative numeric values', () => {
  const p = parse('name,count,enabled\nx,-9223372036854775808,false');
  expect(p.errors).toEqual([]);
  expect(p.rows[0]!.count).toBe('-9223372036854775808');
  expect(p.rows[0]!.enabled).toBe(false);
});
it.each(['9223372036854775808', '-9223372036854775809', '1e4', '1.0', '01', 'NaN', '1+1'])(
  'rejects invalid integer cells %s',
  (v) => expect(parse('name,count,enabled\nx,' + v + ',true').errors).not.toHaveLength(0),
);
it.each(['TRUE', '1', 'yes', 'False'])('requires explicit canonical boolean %s', (v) =>
  expect(parse('name,count,enabled\nx,1,' + v).errors).not.toHaveLength(0),
);
it('keeps optional blanks null and reports missing required cells', () => {
  expect(parse('name,count,enabled\nx,1,').rows[0]!.enabled).toBeNull();
  expect(parse('name,count,enabled\n,1,').errors).toContainEqual({
    row: 1,
    column: 'name',
    code: 'required',
  });
});
it.each(['2024-02-29', '2026-11-07'])('accepts a real date %s', (date) =>
  expect(parse('date\n' + date, [{ name: 'date', type: 'date', required: true }]).errors).toEqual(
    [],
  ),
);
it.each(['2025-02-29', '2026-04-31', '2026-13-01', 'today'])('rejects invalid dates %s', (date) =>
  expect(
    parse('date\n' + date, [{ name: 'date', type: 'date', required: true }]).errors,
  ).not.toHaveLength(0),
);
it.each(['https://example.invalid/a', 'https://example.invalid/a?q=x'])(
  'accepts a stored HTTPS reference without fetching %s',
  (url) =>
    expect(
      parse('url\n' + url, [{ name: 'url', type: 'https_url', required: true }]).errors,
    ).toEqual([]),
);
it.each(['http://example.invalid', 'javascript:alert(1)', 'https://user:secret@example.invalid'])(
  'refuses unsafe reference syntax %s',
  (url) =>
    expect(
      parse('url\n' + url, [{ name: 'url', type: 'https_url', required: true }]).errors,
    ).not.toHaveLength(0),
);
it.each(['0', '-1.25', '123.00'])('keeps canonical decimal text %s', (v) =>
  expect(
    parse('value\n' + v, [{ name: 'value', type: 'decimal', required: true }]).rows[0]!.value,
  ).toBe(v),
);
it.each(['1e3', '1,000', 'NaN', '+1', '-cmd'])('rejects noncanonical decimal %s', (v) =>
  expect(
    parse('value\n"' + v + '"', [{ name: 'value', type: 'decimal', required: true }]).errors,
  ).not.toHaveLength(0),
);
it('refuses invalid UTF8, NULs, empty data, excessive cells/bytes/rows and oversize cell text', () => {
  expect(
    parseStaffCsv(new Uint8Array([255]), { columns, maxBytes: 100, maxRows: 1 }).structurallyValid,
  ).toBe(false);
  for (const s of [
    '',
    'name,count,enabled',
    'name,count,enabled\nx\0,1,true',
    'name,count,enabled\n' + 'x'.repeat(4097) + ',1,true',
  ])
    expect(parse(s).structurallyValid).toBe(false);
  expect(
    parse('name,count,enabled\nx,1,true', columns, { maxBytes: 5, maxRows: 20 }).structurallyValid,
  ).toBe(false);
  expect(
    parse('name,count,enabled\nx,1,true\ny,2,false', columns, { maxBytes: 100, maxRows: 1 })
      .structurallyValid,
  ).toBe(false);
});
it('bounds error output and never echoes original CSV cells', () => {
  const p = parse('name,count,enabled\n' + Array.from({ length: 20 }, () => ',bad,yes').join('\n'));
  expect(p.errors.length).toBeLessThanOrEqual(1000);
  const out = exportCsvErrors(p.errors);
  expect(out.startsWith('row,column,code\r\n')).toBe(true);
  expect(out).not.toMatch(/bad|yes/);
  expect(() => exportCsvErrors([{ row: 1, column: '=cmd', code: 'required' }])).toThrow();
});

it('caps total cells before an oversized row matrix is retained', () => {
  const cols = Array.from({ length: 100 }, (_, i) => ({
    name: 'c' + i,
    type: 'text' as const,
    required: true,
  }));
  const input =
    cols.map((c) => c.name).join(',') +
    '\n' +
    Array.from({ length: 5000 }, () => Array(100).fill('x').join(',')).join('\n');
  const r = parse(input, cols, { maxBytes: 16777216, maxRows: 100000 });
  expect(r.structurallyValid).toBe(false);
  expect(r.errors.some((e) => e.code === 'cells')).toBe(true);
  expect(r.rows.length).toBeLessThan(5000);
});
it('caps 2000 invalid-row diagnostics at 1000 without dropping invalid-row identity', () => {
  const r = parse('name,count,enabled\n' + Array(2000).fill(',bad,yes').join('\n'), columns, {
    maxBytes: 16777216,
    maxRows: 100000,
  });
  expect(r.structurallyValid).toBe(true);
  expect(r.errors).toHaveLength(1000);
  expect(r.invalidRows).toHaveLength(2000);
  expect(exportCsvErrors(r.errors).split('\r\n')).toHaveLength(1002);
});
it.each([
  { columns: [], maxBytes: 1, maxRows: 1 },
  { columns, maxBytes: 16777217, maxRows: 1 },
  { columns, maxBytes: 10, maxRows: 100001 },
  { columns: [columns[0], columns[0]], maxBytes: 10, maxRows: 1 },
])('refuses invalid reviewed bounds/definitions %#', (v) =>
  expect(() => validateCsvDefinition(v as Parameters<typeof validateCsvDefinition>[0])).toThrow(),
);
