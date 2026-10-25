import { deflateRawSync, crc32 } from 'node:zlib';
export function zipFixture(
  name: string,
  text: string,
  options: { crc?: number; external?: number; count?: number } = {},
) {
  const raw = Buffer.from(text),
    data = deflateRawSync(raw),
    filename = Buffer.from(name),
    crc = options.crc ?? crc32(raw);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(filename.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(filename.length, 28);
  central.writeUInt32LE((options.external ?? 0) >>> 0, 38);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(options.count ?? 1, 8);
  end.writeUInt16LE(options.count ?? 1, 10);
  end.writeUInt32LE(central.length + filename.length, 12);
  end.writeUInt32LE(local.length + filename.length + data.length, 16);
  return Buffer.concat([local, filename, data, central, filename, end]);
}
export function recallLine(input: Partial<Record<number, string>> = {}) {
  const row = [
    '1',
    '26T001000',
    'Synthetic',
    'Synthetic Tire',
    '9999',
    'TEST26',
    'TIRES',
    'Synthetic Company',
    '20240101',
    '20240630',
    'T',
    '100',
    '',
    'MFR',
    'Synthetic Company',
    '20261001',
    '20261001',
    '573',
    '139',
    'Synthetic defect',
    'Synthetic consequence',
    'Replace the tire',
    '',
    '1',
    '',
    '',
    '',
    'Yes',
    '',
  ];
  for (const [key, value] of Object.entries(input))
    if (value !== undefined) row[Number(key)] = value;
  return row.join('\t') + '\n';
}
