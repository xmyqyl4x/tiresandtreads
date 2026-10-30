import { closeSync } from 'node:fs';
import { memoryJournal } from '../lifecycle-journal/model.ts';
import { intent, id } from '../lifecycle-journal/samples.ts';
import {
  readPlan,
  flags,
  checkpointAt,
  fixedRecords,
  pointAt,
  summaryAt,
  must,
  type Event,
  type Plan,
} from './contract.ts';
import { inspectJournal, openJournal, writeChunk } from './storage.ts';

// Private fixture child only. No caller path, SQL, provider, command or execution callback.
if (process.argv.length !== 2 || !process.send) {
  process.stderr.write('Journal process refused\n');
  process.exit(64);
}
let initialized = false,
  awaiting: { command: string; resume: () => void } | undefined;
const deadline = setTimeout(() => process.exit(64), 5000);
process.on('disconnect', () => process.exit(72));
process.on('message', (raw: unknown) => {
  if (!initialized) {
    initialized = true;
    clearTimeout(deadline);
    void execute(raw).catch(async () => {
      process.stderr.write('Journal process refused\n');
      try {
        await send({
          scope: 'disposable-journal-process',
          processId: process.pid,
          runId: process.env.JOURNAL_PROOF_RUN!,
          kind: 'refused',
          ...flags,
        });
      } finally {
        process.exit(64);
      }
    });
  } else {
    if (
      !raw ||
      typeof raw !== 'object' ||
      Object.keys(raw).length !== 1 ||
      !('kind' in raw) ||
      !awaiting ||
      raw.kind !== awaiting.command
    ) {
      process.stderr.write('Journal process refused\n');
      process.exit(64);
    }
    const resume = awaiting.resume;
    awaiting = undefined;
    resume();
  }
});
function send(event: Event) {
  return new Promise<void>((resolve, reject) =>
    process.send!(event, (error) => (error ? reject(Error('Journal process refused')) : resolve())),
  );
}
async function waitFor(event: Event, command: string) {
  const paused = new Promise<void>((resolve) => {
    awaiting = { command, resume: resolve };
  });
  await send(event);
  await paused;
}
async function execute(raw: unknown) {
  const plan: Plan = readPlan(raw, process.env),
    root = process.env.JOURNAL_PROOF_ROOT!;
  const base = { scope: plan.scope, runId: plan.runId, processId: process.pid, ...flags };
  if (plan.mode === 'write') {
    const fd = openJournal(root, plan.runId);
    try {
      for (let index = 0; index < fixedRecords.length; index++) {
        const bytes = Buffer.from(fixedRecords[index]! + '\n'),
          count = index + 1;
        if (count === 5 && plan.point === 'partial-outcome') {
          const split = Math.floor(bytes.length / 2);
          writeChunk(fd, bytes.subarray(0, split));
          await waitFor(
            { ...base, kind: 'paused', point: 'partial-outcome', checkpoint: checkpointAt(4) },
            'continue',
          );
          writeChunk(fd, bytes.subarray(split));
        } else writeChunk(fd, bytes);
        if (count === 5 && plan.point === 'outcome-written')
          await waitFor(
            { ...base, kind: 'paused', point: 'outcome-written', checkpoint: checkpointAt(4) },
            'continue',
          );
        await waitFor(
          { ...base, kind: 'ack', point: pointAt(count), checkpoint: checkpointAt(count) },
          'accepted',
        );
      }
    } finally {
      closeSync(fd);
    }
  }
  const checkpoint = plan.mode === 'read' ? plan.checkpoint : checkpointAt(9);
  const { journal } = inspectJournal(root, plan.runId, checkpoint);
  let receiptRejected = false;
  try {
    journal.append(plan.exportedReceipt, checkpoint);
  } catch {
    receiptRejected = true;
  }
  let replayRefused: true | null = null;
  if (checkpoint.count >= 3) {
    let refused = false;
    const scratch = memoryJournal(
      journal.events().map((e) => fixedRecords[e.sequence - 1]!),
      checkpoint,
    );
    try {
      intent(scratch, id(99));
    } catch {
      refused = true;
    }
    must(refused);
    replayRefused = true;
  }
  must(receiptRejected);
  const sanitizedEnvironment = !Object.keys(process.env).some((key) =>
    /DATABASE|PASSWORD|SECRET|TOKEN|STORAGE|WORKFLOW/.test(key),
  );
  must(sanitizedEnvironment);
  await send({
    ...base,
    kind: 'result',
    checkpoint,
    summary: summaryAt(checkpoint.count),
    receiptRejected: true,
    replayRefused,
    sanitizedEnvironment: true,
  });
  process.exit(0);
}
