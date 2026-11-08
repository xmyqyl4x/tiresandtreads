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

// Only reviewed binary uploads receive larger bodies; ordinary routes retain64KB.
export function previewBodyLimit(path, method) {
  const partner =
    /^\/local-p2-api\/api\/v1\/partners\/organizations\/[0-9a-f-]{36}\/assets(?:\?[^#]*)?$/i.test(
      path,
    );
  const csv = /^\/local-p2-staff-api\/api\/v1\/staff\/csv\/uploads(?:\?[^#]*)?$/.test(path);
  return method === 'POST' && (partner || csv) ? 16777216 : 65536;
}
