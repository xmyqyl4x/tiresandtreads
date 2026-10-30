import { TextDecoder } from 'node:util';

export function refused(): never {
  throw Error('Synthetic multi-target model refused');
}
function wellFormed(text: string) {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) refused();
    } else if (code >= 0xdc00 && code <= 0xdfff) refused();
  }
}

// Bounded JSON reader so duplicate decoded keys cannot disappear in JSON.parse.
// Only individual string tokens use JSON.parse, after bounded lexical scanning.
export function readJson(raw: unknown, limit: number): unknown {
  try {
    let text: string;
    if (typeof raw === 'string' && raw.length <= limit) text = raw;
    else if (raw instanceof Uint8Array && raw.byteLength <= limit)
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
    else return refused();
    if (Buffer.byteLength(text, 'utf8') > limit) refused();
    wellFormed(text);
    let position = 0,
      nodes = 0;
    const whitespace = () => {
      while (/[ \t\r\n]/.test(text[position] ?? '') && position < text.length) position++;
    };
    const string = (): string => {
      if (text[position] !== '"') return refused();
      const start = position++;
      while (position < text.length) {
        const char = text[position++];
        if (char === '\\') position++;
        else if (char === '"') {
          const value: unknown = JSON.parse(text.slice(start, position));
          if (typeof value !== 'string' || value.length > 512) return refused();
          wellFormed(value);
          return value;
        }
      }
      return refused();
    };
    function value(depth: number): unknown {
      if (++nodes > 128 || depth > 6) return refused();
      whitespace();
      const char = text[position];
      if (char === '"') return string();
      if (char === '{') {
        position++;
        const object: Record<string, unknown> = Object.create(null);
        const seen = new Set<string>();
        whitespace();
        if (text[position] === '}') {
          position++;
          return object;
        }
        while (position < text.length) {
          whitespace();
          const key = string();
          if (seen.has(key)) return refused();
          seen.add(key);
          whitespace();
          if (text[position++] !== ':') return refused();
          object[key] = value(depth + 1);
          whitespace();
          const end = text[position++];
          if (end === '}') return object;
          if (end !== ',') return refused();
        }
        return refused();
      }
      if (char === '[') {
        position++;
        const values: unknown[] = [];
        whitespace();
        if (text[position] === ']') {
          position++;
          return values;
        }
        while (position < text.length) {
          values.push(value(depth + 1));
          whitespace();
          const end = text[position++];
          if (end === ']') return values;
          if (end !== ',') return refused();
        }
        return refused();
      }
      for (const [literal, result] of [
        ['true', true],
        ['false', false],
        ['null', null],
      ] as const)
        if (text.startsWith(literal, position)) {
          position += literal.length;
          return result;
        }
      const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(
        text.slice(position),
      );
      if (!match) return refused();
      position += match[0].length;
      const number = Number(match[0]);
      if (!Number.isSafeInteger(number) || Object.is(number, -0)) return refused();
      return number;
    }
    const parsed = value(0);
    whitespace();
    if (position !== text.length) return refused();
    return parsed;
  } catch {
    return refused();
  }
}
