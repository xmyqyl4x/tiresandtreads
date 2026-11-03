import { createLocalPublicApi } from '../../packages/integrations/src/http/local-runtime.ts';
try {
  const api = await createLocalPublicApi(process.env);
  console.log(JSON.stringify({ origin: api.origin, ...api.metadata }));
  const stop = () => {
    void api.shutdown().then(
      () => {
        process.exitCode = 0;
      },
      () => {
        process.exitCode = 1;
      },
    );
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} catch {
  console.error('Local API configuration or dependencies unavailable');
  process.exitCode = 1;
}
