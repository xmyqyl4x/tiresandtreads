import { commercialPreview } from './commercial.ts';
const f = await commercialPreview();
console.log(
  'LOCAL_COMMERCIAL_READY ' +
    JSON.stringify({
      origin: f.web.webOrigin,
      synthetic: true,
      disposable: true,
      externalActivation: false,
      actualNotifications: 0,
    }),
);
let timer: ReturnType<typeof setTimeout> | undefined;
try {
  await new Promise<void>((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
    timer = setTimeout(resolve, 1800000);
  });
} finally {
  clearTimeout(timer);
  await f.cleanup();
}
process.exit(0);
