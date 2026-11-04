// Fixed development ingress projection. Peer authority is admitted only for the reviewed console action.
export function previewForwardHeaders(incoming, authority, path, method) {
  const headers = { host: authority };
  for (const name of [
    'accept',
    'accept-encoding',
    'content-type',
    'cookie',
    'authorization',
    'origin',
    'x-csrf-token',
    'idempotency-key',
    'sec-gpc',
    'x-share-token',
  ])
    if (typeof incoming[name] === 'string') headers[name] = incoming[name];
  const reviewer = incoming['x-reviewer-authorization'];
  if (
    method === 'POST' &&
    path === '/local-staff-api/api/v1/staff-console/publish' &&
    typeof reviewer === 'string' &&
    /^Bearer [A-Za-z0-9_-]{43}$/.test(reviewer)
  )
    headers['x-reviewer-authorization'] = reviewer;
  return headers;
}
