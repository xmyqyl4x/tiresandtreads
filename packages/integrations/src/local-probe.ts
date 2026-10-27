// Read-only fixed local dependency checks; never include URLs or upstream bodies in the result.
export async function localHttpReady(url: string) {
  const u = new URL(url);
  if (
    u.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', 'test', 'service-host', 'moto', 'moto-durable'].includes(
      u.hostname,
    ) ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    !['/health/ready', '/moto-api/'].includes(u.pathname)
  )
    throw Error('Invalid local probe');
  try {
    const response = await fetch(u, { signal: AbortSignal.timeout(3000), redirect: 'error' });
    await response.body?.cancel();
    return response.status === 200;
  } catch {
    return false;
  }
}
