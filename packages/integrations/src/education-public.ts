import type { createContentRuntime } from './content-runtime.ts';
import { publicPath } from '../../domain/src/public-policy.ts';
import { ok, fail } from '../../domain/src/values/core.ts';
import { failure } from '../../application/src/ports/transactions.ts';
// One public read boundary for web/API consumers; no authoring model or staff identity escapes.
type ContentRuntime = Awaited<ReturnType<typeof createContentRuntime>>;
export async function readEducation(
  runtime: {
    services: Pick<ContentRuntime['services'], 'readPage'>;
    routing: Pick<ContentRuntime['routing'], 'redirect'>;
  },
  query: URLSearchParams,
) {
  try {
    if (
      [...query].some(([key]) => !['path', 'locale', 'market'].includes(key)) ||
      new Set(query.keys()).size !== [...query].length
    )
      return fail(failure('invalid_input'));
    let path: string;
    try {
      path = publicPath(query.get('path') ?? '/');
    } catch {
      return fail(failure('invalid_input'));
    }
    const locale = query.get('locale') ?? 'en-US',
      market = query.get('market') ?? 'US';
    if (locale !== 'en-US' || market !== 'US') return fail(failure('invalid_input'));
    const redirect = await runtime.routing.redirect(path);
    if (redirect) return ok({ redirect });
    return runtime.services.readPage(path, locale, market);
  } catch {
    return fail(failure('unavailable'));
  }
}
