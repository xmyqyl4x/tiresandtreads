import { startEditorialPreview } from './web.ts';
const publish = process.env.LOCAL_EDITORIAL_SCENARIO === 'synthetic-approved';
if (!['drafts', 'synthetic-approved'].includes(process.env.LOCAL_EDITORIAL_SCENARIO ?? ''))
  throw Error('Choose an explicit local editorial scenario');
const f = await startEditorialPreview('http://127.0.0.1:8380', publish);
console.log(
  'LOCAL_EDITORIAL_READY ' +
    JSON.stringify({
      origin: f.web.webOrigin,
      scenario: process.env.LOCAL_EDITORIAL_SCENARIO,
      synthetic: true,
      disposable: true,
      actualEditorialAcceptance: false,
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
