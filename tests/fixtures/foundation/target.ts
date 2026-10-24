export function disposableTargets(env: Readonly<Record<string, string | undefined>>) {
  const refusal = () => new Error('Refusing a non-disposable foundation target');
  if (
    env.APP_ENV !== 'test-local' ||
    !/^tt-test-[a-f0-9]{8,32}$/.test(env.ISOLATED_TEST_PROJECT ?? '')
  )
    throw refusal();
  const target = (value: string | undefined, database: string) => {
    let url: URL;
    try {
      url = new URL(value ?? '');
    } catch {
      throw refusal();
    }
    if (
      url.protocol !== 'postgresql:' ||
      url.hostname !== 'postgres' ||
      url.port !== '5432' ||
      url.username !== 'local_harness' ||
      !url.password ||
      url.pathname !== `/${database}` ||
      url.search ||
      url.hash
    )
      throw refusal();
    return url.toString();
  };
  return {
    app: target(env.TEST_DATABASE_URL, 'tt_app'),
    cms: target(env.TEST_CMS_DATABASE_URL, 'tt_cms'),
  };
}
