import { stat } from 'node:fs/promises';
import { crc32 } from 'node:zlib';
import { openPromise } from 'yauzl';
export async function* recallArchive(
  path: string,
  part: 'PRE' | 'POST',
  signal: AbortSignal,
): AsyncGenerator<string> {
  const info = await stat(path);
  if (!info.isFile() || info.size > 67108864) throw Error('Archive bound');
  const zip = await openPromise(path, {
    lazyEntries: true,
    strictFileNames: true,
    validateEntrySizes: true,
  });
  try {
    if (zip.entryCount !== 1) throw Error('Archive entries');
    for await (const entry of zip.eachEntry()) {
      if (
        entry.fileName !== `FLAT_RCL_${part}_2010.txt` ||
        ![0, 8].includes(entry.compressionMethod) ||
        (entry.generalPurposeBitFlag & 1) !== 0 ||
        entry.uncompressedSize > 536870912 ||
        entry.uncompressedSize > entry.compressedSize * 100 ||
        ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000
      )
        throw Error('Archive contract');
      const stream = await zip.openReadStreamPromise(entry);
      let bytes = 0,
        crc = 0,
        pending = Buffer.alloc(0);
      const abort = () => stream.destroy(Error('Source deadline'));
      signal.addEventListener('abort', abort, { once: true });
      try {
        for await (const chunk of stream) {
          signal.throwIfAborted();
          const b = Buffer.from(chunk);
          bytes += b.length;
          if (bytes > entry.uncompressedSize) throw Error('Archive size');
          crc = crc32(b, crc);
          pending = Buffer.concat([pending, b]);
          let end: number;
          while ((end = pending.indexOf(10)) >= 0) {
            if (end > 32768) throw Error('Recall line bound');
            const line = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
              pending.subarray(0, end),
            );
            if (line.charCodeAt(0) === 0xfeff) throw Error('Recall encoding');
            yield line.replace(/\r$/, '');
            pending = pending.subarray(end + 1);
          }
          if (pending.length > 32768) throw Error('Recall line bound');
        }
        if (pending.length || bytes !== entry.uncompressedSize || crc !== entry.crc32)
          throw Error('Archive integrity');
      } finally {
        signal.removeEventListener('abort', abort);
        stream.destroy();
      }
    }
  } finally {
    zip.close();
  }
}
