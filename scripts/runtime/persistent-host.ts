import { readProviderState, verifyProviderState } from './local-host-state.ts';
try {
  const target = process.env.APP_ENV?.replace(/-local$/, '') ?? '';
  const state = await readProviderState(process.env.SERVICE_HOST_PROVIDER_FILE ?? '', target);
  await verifyProviderState(state, process.env.STORAGE_ENDPOINT ?? '');
  process.env.KMS_KEY_ID = state.keyId;
  await import('./service-host.ts');
} catch {
  console.error('Persistent local host unavailable; verify retained fixture provider state');
  process.exitCode = 1;
}
