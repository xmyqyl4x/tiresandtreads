export function privateTransport(
  base: string,
  bearer: string,
  signal: AbortSignal,
  send: typeof fetch = fetch,
  surface: 'partner' | 'staff' | 'owner' | 'operations' = 'partner',
): typeof fetch {
  return (input, options) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (
      url.origin !== base ||
      !(surface === 'partner'
        ? url.pathname.startsWith('/api/v1/partners/')
        : surface === 'operations'
          ? url.pathname.startsWith('/api/v1/staff/assistance/')
          : surface === 'owner'
            ? url.pathname.startsWith('/api/v1/')
            : url.pathname.startsWith('/api/v1/staff/csv/') ||
              url.pathname.startsWith('/api/v1/staff/review/') ||
              url.pathname.startsWith('/api/v1/partners/organizations/'))
    )
      throw Error('Private transport refused');
    const headers = new Headers(options?.headers);
    headers.set('authorization', 'Bearer ' + bearer);
    return send(
      base +
        (surface === 'partner'
          ? '/local-p2-api'
          : surface === 'staff'
            ? '/local-p2-staff-api'
            : surface === 'operations'
              ? '/local-p2-operations-api'
              : '/local-p2-owner-api') +
        url.pathname +
        url.search,
      {
        ...options,
        headers,
        signal,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
      },
    );
  };
}
