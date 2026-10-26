import type {
  ContentServiceRepository,
  RedirectSnapshot,
} from '../../application/src/ports/content-services.ts';
import type { PublicObjectReader } from '../../application/src/ports/publication.ts';
import { redirectSnapshot } from '../../application/src/services/content.ts';
import { resolveRedirect } from '../../domain/src/public-policy.ts';
import { contentIdentity } from './content-identity.ts';
import { boundedIO } from './bounded-io.ts';
export function createPublicRoutingReader(o: {
  readonly current: () => ReturnType<ContentServiceRepository['currentRedirects']>;
  readonly objects: PublicObjectReader;
  readonly now?: () => number;
}) {
  const now = o.now ?? Date.now;
  let cached: RedirectSnapshot | null = null,
    until = 0,
    highest = 0,
    checksum = '',
    epoch = 0;
  let pending: Promise<RedirectSnapshot | null> | null = null;
  async function refresh() {
    const generation = epoch;
    try {
      const head = await boundedIO(() => o.current());
      if (!head) throw Error('Missing redirects');
      const value = redirectSnapshot(head.value);
      if (
        value.revision < highest ||
        (value.revision === highest && head.checksum !== checksum) ||
        contentIdentity.checksum(value) !== head.checksum ||
        Date.parse(value.issuedAt) > now() ||
        Date.parse(value.expiresAt) <= now()
      )
        throw Error('Invalid redirects');
      highest = value.revision;
      checksum = head.checksum;
      const bytes = await boundedIO((signal) =>
        o.objects.get(`public-redirects/${value.revision}.json`, { maxBytes: 65536, signal }),
      );
      if (
        bytes.byteLength > 65536 ||
        contentIdentity.checksum(
          redirectSnapshot(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))),
        ) !== checksum ||
        generation !== epoch ||
        Date.parse(value.expiresAt) <= now()
      )
        throw Error('Invalid redirects');
      cached = Object.freeze({
        ...value,
        rules: Object.freeze(value.rules.map((rule) => Object.freeze({ ...rule }))),
      });
      until = Math.min(now() + 30000, Date.parse(value.expiresAt));
      return cached;
    } catch {
      cached = null;
      until = 0;
      return null;
    }
  }
  return {
    async read() {
      if (cached && now() < until) return cached;
      pending ??= refresh().finally(() => {
        pending = null;
      });
      return pending;
    },
    invalidate() {
      epoch++;
      cached = null;
      until = 0;
    },
    async redirect(path: string) {
      const value = await this.read();
      return value ? resolveRedirect(value.rules, path) : null;
    },
  };
}
