import { localObserver } from './local-observer.ts';
import { providerSelection } from './fixture-provider.ts';
try {
  const target = process.env.LOCAL_ENV,
    actor = process.argv[2],
    samples = Number(process.argv[3] ?? 1);
  if (
    !['dev', 'stage'].includes(target ?? '') ||
    process.env.APP_ENV !== target + '-local' ||
    process.env.PROVIDER_MODE !== 'fixtures' ||
    !actor ||
    !Number.isInteger(samples) ||
    samples < 1 ||
    samples > 12
  )
    throw Error();
  const observer = localObserver(
    `postgresql://tt_operations_runtime:${process.env.DB_PASSWORD_TT_OPERATIONS_RUNTIME}@postgres:5432/tt_app`,
    actor,
    'http://service-host:8123',
    providerSelection(process.env.LOCAL_PROVIDER_MODE).endpoint,
    process.env.APP_ENV!,
  );
  try {
    for (let n = 0; n < samples; n++) {
      const sample = await observer.sample();
      if (n === 0 || sample.events.length) console.log(JSON.stringify(sample));
      process.exitCode = sample.healthy ? 0 : 2;
      if (n + 1 < samples) await new Promise((r) => setTimeout(r, 5000));
    }
  } finally {
    await observer.close();
  }
} catch {
  console.error('Local observer unavailable; no acceptance claimed');
  process.exitCode = 1;
}
