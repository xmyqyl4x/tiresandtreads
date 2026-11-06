import { inflateSync, deflateSync } from 'node:zlib';
import type { PartnerFiles } from '../../application/src/ports/partner-services.ts';
function crc(bytes: Uint8Array) {
  let n = 0xffffffff;
  for (const x of bytes) {
    n ^= x;
    for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
  }
  return (n ^ 0xffffffff) >>> 0;
}
function chunk(kind: string, data: Buffer) {
  const type = Buffer.from(kind),
    out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length);
  type.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc(Buffer.concat([type, data])), 8 + data.length);
  return out;
}
function png(bytes: Uint8Array) {
  const b = Buffer.from(bytes);
  if (!b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    throw Error('Invalid logo');
  let i = 8,
    ihdr: Buffer | null = null,
    ended = false,
    seenData = false;
  const compressed: Buffer[] = [];
  while (i < b.length) {
    if (i + 12 > b.length) throw Error('Invalid logo');
    const length = b.readUInt32BE(i),
      kind = b.subarray(i + 4, i + 8).toString('ascii');
    if (
      length > 8388608 ||
      i + length + 12 > b.length ||
      crc(b.subarray(i + 4, i + 8 + length)) !== b.readUInt32BE(i + 8 + length)
    )
      throw Error('Invalid logo');
    const data = b.subarray(i + 8, i + 8 + length);
    if (!ihdr && kind !== 'IHDR') throw Error('Invalid logo');
    if (kind === 'IHDR') {
      if (
        ihdr ||
        length !== 13 ||
        data[8] !== 8 ||
        ![2, 6].includes(data[9]!) ||
        data[10] !== 0 ||
        data[11] !== 0 ||
        data[12] !== 0
      )
        throw Error('Unsupported logo');
      ihdr = Buffer.from(data);
    } else if (kind === 'IDAT') {
      seenData = true;
      compressed.push(data);
    } else if (kind === 'IEND') {
      if (length !== 0 || !seenData || i + 12 !== b.length) throw Error('Invalid logo');
      ended = true;
    } else if (/^[A-Z]/.test(kind) || ['acTL', 'fcTL', 'fdAT'].includes(kind))
      throw Error('Unsupported logo');
    if (ended) break;
    i += length + 12;
  }
  if (!ihdr || !ended) throw Error('Invalid logo');
  const width = ihdr.readUInt32BE(0),
    height = ihdr.readUInt32BE(4),
    channels = ihdr[9] === 6 ? 4 : 3;
  if (!width || !height || width > 4096 || height > 4096 || width * height > 4194304)
    throw Error('Logo dimensions exceeded');
  const stride = 1 + width * channels,
    expected = stride * height,
    raw = inflateSync(Buffer.concat(compressed), { maxOutputLength: expected });
  if (raw.length !== expected) throw Error('Invalid logo');
  for (let y = 0; y < height; y++) if (raw[y * stride]! > 4) throw Error('Invalid logo filter');
  return Buffer.concat([
    b.subarray(0, 8),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
export function createPartnerFiles(): PartnerFiles {
  return {
    async inspect(purpose, mime, bytes) {
      if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > 16777216)
        throw Error('Invalid partner file');
      const copy = new Uint8Array(bytes);
      if (purpose === 'logo') {
        if (mime !== 'image/png' || copy.length > 8388608) throw Error('Unsupported logo');
        return png(copy);
      }
      if (purpose === 'coupon_pool') {
        if (mime !== 'text/csv') throw Error('Unsupported coupon file');
        new TextDecoder('utf-8', { fatal: true }).decode(copy);
        return copy;
      }
      if (mime !== 'application/json' || copy.length > 65536) throw Error('Unsupported evidence');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(copy),
        parsed: unknown = JSON.parse(text);
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed) ||
        /[<>]/.test(text) ||
        text.includes('\0') ||
        Object.keys(parsed).length > 32
      )
        throw Error('Invalid structured evidence');
      return new TextEncoder().encode(JSON.stringify(parsed));
    },
  };
}
