import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import type { SourceReceipt } from '../../../application/src/ports/sources.ts';
export class SourceNetworkError extends Error {}
type Validator = SourceReceipt['validators'][string];
export function createSourceHttp(
  wait: (ms: number, signal: AbortSignal) => Promise<unknown> = (ms, signal) =>
    pause(ms, undefined, { signal }),
) {
  let last = 0;
  return async function download(
    url: string,
    path: string,
    max: number,
    signal: AbortSignal,
    previous?: Validator,
  ) {
    const parsed = new URL(url);
    if (
      !['vpic.nhtsa.dot.gov', 'static.nhtsa.gov'].includes(parsed.hostname) ||
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.port
    )
      throw Error('Source origin');
    for (let attempt = 0; attempt < 3; attempt++) {
      await wait(Math.max(0, 1000 - (Date.now() - last)), signal);
      last = Date.now();
      const headers: Record<string, string> = {
        'Accept-Encoding': 'identity',
        'User-Agent': 'TiresAndTreads-source-adapter/1.0',
      };
      if (previous?.etag) headers['If-None-Match'] = previous.etag;
      else if (previous?.modified) headers['If-Modified-Since'] = previous.modified;
      const response = await fetch(url, {
        headers,
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      }).catch(() => {
        throw new SourceNetworkError('Source unavailable');
      });
      const validators = {
        etag: response.headers.get('etag'),
        modified: response.headers.get('last-modified'),
      };
      if (
        (validators.etag && validators.etag.length > 512) ||
        (validators.modified && validators.modified.length > 128)
      )
        throw Error('Source validators');
      if (response.status === 304) {
        await response.body?.cancel();
        if (!previous) throw Error('Unbased not-modified');
        return {
          modified: false as const,
          validators: {
            etag: validators.etag ?? previous.etag,
            modified: validators.modified ?? previous.modified,
          },
        };
      }
      if (response.status === 429 || response.status === 503) {
        await response.body?.cancel();
        const retry = response.headers.get('retry-after');
        const seconds =
          retry && /^\d+$/.test(retry)
            ? Number(retry)
            : Math.max(0, Math.ceil((Date.parse(retry ?? '') - Date.now()) / 1000));
        if (attempt === 2 || seconds > 30) throw new SourceNetworkError('Source throttled');
        await wait(
          Number.isFinite(seconds) ? Math.max(1000, seconds * 1000) : 1000 * (attempt + 1),
          signal,
        );
        continue;
      }
      if (response.status !== 200 || !response.body) {
        await response.body?.cancel();
        throw new SourceNetworkError('Source unavailable');
      }
      const encoding = response.headers.get('content-encoding');
      if (encoding && encoding !== 'identity') {
        await response.body.cancel();
        throw Error('Source encoding');
      }
      const expected = response.headers.get('content-length');
      if (expected && (!/^\d+$/.test(expected) || Number(expected) > max)) {
        await response.body.cancel();
        throw Error('Source byte bound');
      }
      const file = await open(path, 'wx', 0o600),
        hash = createHash('sha256');
      let bytes = 0;
      try {
        for await (const chunk of response.body) {
          signal.throwIfAborted();
          bytes += chunk.length;
          if (bytes > max) throw Error('Source byte bound');
          hash.update(chunk);
          await file.writeFile(chunk);
        }
      } finally {
        await file.close();
      }
      if (expected && bytes !== Number(expected)) throw Error('Truncated source');
      return { modified: true as const, validators, checksum: hash.digest('hex'), bytes };
    }
    throw new SourceNetworkError('Source unavailable');
  };
}
