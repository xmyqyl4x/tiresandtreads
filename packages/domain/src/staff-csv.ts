import type { CsvColumn } from './entities/csv-review.ts';
const codes = [
  'record',
  'duplicate',
  'shape',
  'encoding',
  'bytes',
  'rows',
  'cells',
  'cell_size',
  'control',
  'header',
  'required',
  'formula',
  'integer',
  'decimal',
  'boolean',
  'date',
  'https_url',
  'empty',
] as const;
export type CsvError = Readonly<{ row: number; column: string; code: (typeof codes)[number] }>;
export interface CsvParseResult {
  readonly structurallyValid: boolean;
  readonly rows: readonly Readonly<Record<string, string | boolean | null>>[];
  readonly errors: readonly CsvError[];
  readonly invalidRows: readonly number[];
}
export function validateCsvDefinition(
  definition: Readonly<{ columns: readonly CsvColumn[]; maxBytes: number; maxRows: number }>,
): void {
  const { columns, maxBytes, maxRows } = definition;
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > 16777216 ||
    !Number.isSafeInteger(maxRows) ||
    maxRows < 1 ||
    maxRows > 100000 ||
    !Array.isArray(columns) ||
    columns.length < 1 ||
    columns.length > 100 ||
    new Set(columns.map((c) => c.name)).size !== columns.length ||
    columns.some(
      (c) =>
        !c ||
        !/^[a-z][a-z0-9_]{0,63}$/.test(c.name) ||
        !['text', 'integer', 'decimal', 'boolean', 'date', 'https_url'].includes(c.type) ||
        typeof c.required !== 'boolean' ||
        (c.unit !== undefined &&
          !['none', 'mm', 'inch', 'minor_currency', 'percent'].includes(c.unit)),
    )
  )
    throw Error('Invalid reviewed CSV definition');
}
export function parseStaffCsv(
  bytes: Uint8Array,
  definition: Readonly<{ columns: readonly CsvColumn[]; maxBytes: number; maxRows: number }>,
): CsvParseResult {
  const errors: CsvError[] = [],
    rows: Readonly<Record<string, string | boolean | null>>[] = [],
    invalid = new Set<number>();
  const error = (row: number, column: string, code: CsvError['code']) => {
    if (errors.length < 1000) errors.push(Object.freeze({ row, column, code }));
    if (row > 0) invalid.add(row);
  };
  const result = (structurallyValid: boolean): CsvParseResult =>
    Object.freeze({
      structurallyValid,
      rows: Object.freeze(rows),
      errors: Object.freeze(errors),
      invalidRows: Object.freeze([...invalid]),
    });
  validateCsvDefinition(definition);
  const { columns, maxBytes, maxRows } = definition;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > maxBytes) {
    error(0, 'file', 'bytes');
    return result(false);
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    error(0, 'file', 'encoding');
    return result(false);
  }
  let row: string[] = [],
    cell = '',
    quoted = false,
    closed = false,
    header = false,
    total = 0,
    cellCount = 0,
    structural = true;
  function fail(code: CsvError['code']) {
    error(header ? total + 1 : 0, header ? 'file' : 'header', code);
    structural = false;
  }
  function field() {
    if (++cellCount > 500000) {
      fail('cells');
      return;
    }
    row.push(cell);
    cell = '';
    closed = false;
  }
  function line() {
    if (!header) {
      header = true;
      if (row.length !== columns.length || row.some((s, i) => s !== columns[i]!.name)) {
        fail('header');
      }
      row = [];
      return;
    }
    if (++total > maxRows) {
      fail('rows');
      return;
    }
    if (row.length !== columns.length) {
      fail('shape');
      return;
    }
    const parsed: Record<string, string | boolean | null> = {};
    for (const [i, c] of columns.entries()) {
      const value = row[i]!;
      let v: string | boolean | null = value;
      if (value === '') {
        v = null;
        if (c.required) error(total, c.name, 'required');
      } else {
        const numeric =
          c.type === 'integer'
            ? /^-?(0|[1-9]\d{0,18})$/.test(value)
            : c.type === 'decimal'
              ? /^-?(0|[1-9]\d{0,17})(?:\.\d{1,9})?$/.test(value)
              : false;
        if (/^[\s\ufeff]*[=+@-]/u.test(value) && !numeric) error(total, c.name, 'formula');
        if (c.type === 'integer') {
          if (
            !numeric ||
            BigInt(value) < -9223372036854775808n ||
            BigInt(value) > 9223372036854775807n
          )
            error(total, c.name, 'integer');
        }
        if (c.type === 'decimal' && !numeric) error(total, c.name, 'decimal');
        if (c.type === 'boolean') {
          if (value === 'true') v = true;
          else if (value === 'false') v = false;
          else error(total, c.name, 'boolean');
        }
        if (c.type === 'date') {
          const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
          const year = Number(parts?.[1]),
            month = Number(parts?.[2]),
            day = Number(parts?.[3]);
          const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
          const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
          if (!parts || year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]!)
            error(total, c.name, 'date');
        }
        if (c.type === 'https_url') {
          try {
            const u = new URL(value);
            if (u.protocol !== 'https:' || u.username || u.password || value.trim() !== value)
              throw Error();
          } catch {
            error(total, c.name, 'https_url');
          }
        }
        if (c.required && c.type === 'text' && !value.trim()) error(total, c.name, 'required');
      }
      parsed[c.name] = v;
    }
    rows.push(Object.freeze(parsed));
    row = [];
  }
  for (let i = 0; i < text.length && structural; i++) {
    const ch = text[i]!;
    const code = ch.charCodeAt(0);
    if (code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127) {
      fail('control');
      break;
    }
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += ch;
    } else if (ch === '"') {
      if (cell.length || closed) {
        fail('shape');
        break;
      }
      quoted = true;
    } else if (ch === ',') field();
    else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      field();
      if (structural) line();
    } else if (closed) {
      fail('shape');
      break;
    } else cell += ch;
    if (cell.length > 4096) {
      fail('cell_size');
      break;
    }
  }
  if (quoted) fail('shape');
  if (structural && (cell.length || row.length || closed)) {
    field();
    if (structural) line();
  }
  if (structural && (!header || total === 0)) {
    error(0, 'file', 'empty');
    structural = false;
  }
  return result(structural);
}
// Only row numbers, reviewed column identifiers and closed error codes leave this exporter.
// Source cell values, file paths, provider URLs and spreadsheet expressions are never echoed.
export function exportCsvErrors(errors: readonly CsvError[]): string {
  if (
    !Array.isArray(errors) ||
    errors.length > 1000 ||
    errors.some(
      (e) =>
        !e ||
        !Number.isSafeInteger(e.row) ||
        e.row < 0 ||
        e.row > 100001 ||
        !/^[a-z][a-z0-9_]{0,63}$/.test(e.column) ||
        !codes.includes(e.code),
    )
  )
    throw Error('Invalid CSV diagnostics');
  return (
    'row,column,code\r\n' + errors.map((e) => [e.row, e.column, e.code].join(',') + '\r\n').join('')
  );
}
