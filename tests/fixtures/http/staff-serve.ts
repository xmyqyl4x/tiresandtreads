import { staffConsolePreview } from './staff-console.ts';
const f = await staffConsolePreview(undefined, { loseRecoveryReceipt: true });
console.log(
  'LOCAL_STAFF_READY ' +
    JSON.stringify({
      origin: f.web.webOrigin,
      synthetic: true,
      disposable: true,
      actualNotifications: 0,
      operator: f.operator,
      reviewer: f.reviewer,
      limited: f.limited,
      report: f.report.head.id,
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
