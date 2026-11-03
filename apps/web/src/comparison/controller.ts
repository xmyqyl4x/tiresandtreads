import { createComparisonClient, type Selection } from '@tt/contracts/comparison';
import { quoteInputSchema, type QuoteInput } from '@tt/contracts/quote-input';
import { ownerSession } from '../owner-session.ts';
export function comparisonController(
  origin: string,
  report: string,
  version: number,
  send: typeof fetch = fetch,
  key = () => crypto.randomUUID(),
) {
  const bounded: typeof fetch = (u, o) =>
      send(u, { ...o, signal: o?.signal ?? AbortSignal.timeout(15000) }),
    client = createComparisonClient(origin, bounded);
  const attempts = new Map<
    string,
    { body: string; key: string; promise?: Promise<unknown> | undefined }
  >();
  async function command<T>(
    name: string,
    body: unknown,
    work: (csrf: string, key: string) => Promise<T>,
  ): Promise<T> {
    const serialized = JSON.stringify(body),
      old = attempts.get(name);
    if (old && old.body !== serialized)
      throw Error('Retry the unconfirmed request or reload before changing it');
    const attempt: { body: string; key: string; promise?: Promise<unknown> | undefined } = old ?? {
      body: serialized,
      key: key(),
    };
    attempts.set(name, attempt);
    if (attempt.promise) return attempt.promise as Promise<T>;
    attempt.promise = (async () => work((await ownerSession(origin, bounded)).csrf, attempt.key))()
      .then((value) => {
        attempts.delete(name);
        return value;
      })
      .catch((error) => {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'invalid_input' &&
          'retryable' in error &&
          error.retryable === false
        )
          attempts.delete(name);
        throw error;
      })
      .finally(() => {
        attempt.promise = undefined;
      });
    return attempt.promise as Promise<T>;
  }
  return {
    quotes: client.quotes.bind(null, report),
    readQuote: (quote: string) => client.quote(report, quote),
    comparison: (revision: string) => client.comparison(report, version, revision),
    saveQuote: (raw: QuoteInput) => {
      const body = quoteInputSchema.parse(raw);
      return command('quote', body, async (csrf, k) => {
        const r = await client.saveQuote(report, body, csrf, k);
        return client.quote(report, r.resource_id);
      });
    },
    compare: (raw: Selection[], expectedRevision: string | null) => {
      const items = structuredClone(raw);
      return command('compare', { version, expectedRevision, items }, async (csrf, k) => {
        const r = await client.compare(report, { version, expectedRevision, items }, csrf, k);
        return client.comparison(report, version, r.result_revision!);
      });
    },
    share: (latest: boolean, revision: string | null) =>
      command(
        'share',
        { version: latest ? null : version, comparisonRevision: latest ? null : revision },
        (csrf, k) =>
          client.share(
            report,
            { version: latest ? null : version, comparisonRevision: latest ? null : revision },
            csrf,
            k,
          ),
      ),
    revoke: (capability: string) =>
      command('revoke', { capability }, (csrf, k) => client.revoke(report, capability, csrf, k)),
    pdf: (assetId: string) =>
      command('pdf', { assetId, version }, async (csrf, k) => {
        const r = await client.ownerPdf(report, version, assetId, csrf, k);
        return client.download(r.token);
      }),
  };
}
