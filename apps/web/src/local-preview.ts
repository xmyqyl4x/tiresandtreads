export type PreviewEnvironment = Readonly<Record<string, string | undefined>>;
export function localPreview(env: PreviewEnvironment) {
  if (
    env.LOCAL_WEB_PREVIEW !== 'enabled' ||
    !['dev-local', 'stage-local', 'test-local'].includes(env.APP_ENV ?? '') ||
    env.PROVIDER_MODE !== 'fixtures'
  )
    return null;
  try {
    const web = new URL(env.LOCAL_WEB_ORIGIN ?? ''),
      api = new URL(env.LOCAL_API_ORIGIN ?? '');
    for (const u of [web, api])
      if (
        u.protocol !== 'http:' ||
        u.hostname !== '127.0.0.1' ||
        !u.port ||
        Number(u.port) < 1024 ||
        u.username ||
        u.password ||
        u.pathname !== '/' ||
        u.search ||
        u.hash
      )
        return null;
    return { web: web.origin, api: api.origin };
  } catch {
    return null;
  }
}
