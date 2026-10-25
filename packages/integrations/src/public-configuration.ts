import type {
  ConfigurationSnapshot,
  PublicObjectReader,
} from '../../application/src/ports/publication.ts';
import { publicConfiguration, configurationChecksum } from '../../config/src/publication.ts';

async function bounded<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(controller.signal),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(Error('Public configuration timeout'));
        }, 2000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// SQL is authoritative on every refresh, including after a process restart. Cache age is at most
// 30 seconds across replicas. A failed refresh clears the cache instead of extending permission.
export function createPublicConfigurationReader(options: {
  readonly current: () => Promise<ConfigurationSnapshot | null>;
  readonly objects?: PublicObjectReader;
  readonly now?: () => number;
}) {
  const now = options.now ?? Date.now;
  let cached: ConfigurationSnapshot | null = null,
    refreshAt = 0,
    highest = 0,
    highestChecksum = '',
    epoch = 0;
  let pending: Promise<ConfigurationSnapshot | null> | null = null;
  async function refresh(): Promise<ConfigurationSnapshot | null> {
    const startedEpoch = epoch;
    try {
      const head = await bounded(() => options.current());
      if (!head) {
        cached = null;
        return null;
      }
      const value = publicConfiguration(head.value);
      if (
        value.revision < highest ||
        (value.revision === highest && head.checksum !== highestChecksum) ||
        configurationChecksum(value) !== head.checksum
      )
        throw Error('Invalid publication head');
      highest = value.revision;
      highestChecksum = head.checksum;
      if (Date.parse(value.issuedAt) > now() || Date.parse(value.expiresAt) <= now())
        throw Error('Expired public configuration');
      if (options.objects) {
        const bytes = await bounded((signal) =>
          options.objects!.get(`public-config/${value.revision}.json`, {
            maxBytes: 4096,
            signal,
          }),
        );
        if (bytes.byteLength > 4096) throw Error('Oversized public configuration');
        const object = publicConfiguration(
          JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
        );
        if (configurationChecksum(object) !== head.checksum)
          throw Error('Invalid public configuration checksum');
      }
      if (epoch !== startedEpoch || Date.parse(value.expiresAt) <= now())
        throw Error('Invalidated public configuration');
      cached = Object.freeze({ value: Object.freeze(value), checksum: head.checksum });
      refreshAt = Math.min(now() + 30000, Date.parse(value.expiresAt));
      return cached;
    } catch {
      cached = null;
      refreshAt = 0;
      return null;
    }
  }
  return {
    async read(): Promise<ConfigurationSnapshot | null> {
      if (cached && now() < refreshAt) return cached;
      pending ??= refresh().finally(() => {
        pending = null;
      });
      return pending;
    },
    invalidate() {
      epoch++;
      cached = null;
      refreshAt = 0;
    },
  };
}
