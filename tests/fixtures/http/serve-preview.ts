import { startWebPreview } from './web-preview.ts';
const mode = process.env.LOCAL_PREVIEW_MODE ?? 'dev';
if (!['dev', 'stage'].includes(mode)) throw Error('Local preview mode refused');
const origin = mode === 'dev' ? 'http://127.0.0.1:8380' : 'http://127.0.0.1:8480';
const preview = await startWebPreview(origin, mode as 'dev' | 'stage');
console.log(
  'LOCAL_WEB_PREVIEW_READY ' +
    JSON.stringify({
      origin,
      mode,
      disposable: true,
      S3Accepted: false,
      S4Accepted: false,
      publicActivation: false,
    }),
);
try {
  await new Promise<void>((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });
} finally {
  await preview.cleanup();
}
