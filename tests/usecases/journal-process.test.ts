import { expect, it } from 'vitest';
import { createSession, processDiagnostics } from '../fixtures/journal-process/parent.ts';
import { points, checkpointAt, type Point } from '../fixtures/journal-process/contract.ts';
import { existsSync, readFileSync, writeFileSync, unlinkSync, lstatSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const counts: Record<Point, number> = {
  'before-intent': 2,
  'intent-ack': 3,
  'dispatch-ack': 4,
  'partial-outcome': 4,
  'outcome-written': 4,
  'outcome-ack': 5,
  'receipt-ack': 9,
};

it.each(points)(
  'kills the real child at %s and reconstructs only the parent-acknowledged prefix in a fresh process',
  async (point) => {
    const session = createSession();
    try {
      const first = session.launch(session.plan('write', point));
      const stopped = await first.next();
      expect(stopped.kind === 'ack' || stopped.kind === 'paused').toBe(true);
      expect(session.checkpoint()).toEqual(checkpointAt(counts[point]));
      expect((await first.interrupt()).signal).toBe('SIGKILL');
      expect(first.diagnostics()).toMatchObject({
        processExited: true,
        stdoutClosed: true,
        stderrClosed: true,
        stdoutBytes: 0,
        stderrBytes: 0,
      });
      const bytes = session.bytes();
      const readPlan = session.plan('read', 'none');
      if (counts[point] === 3 || counts[point] === 4)
        expect(JSON.parse(readPlan.exportedReceipt).operations[0].attempts[0].effect).toBe(
          'unknown',
        );
      const second = session.launch(readPlan);
      expect(second.pid).not.toBe(first.pid);
      const result = await second.next();
      const tail = point === 'partial-outcome' || point === 'outcome-written';
      expect(result.kind).toBe(tail ? 'refused' : 'result');
      expect((await second.exit()).code).toBe(tail ? 64 : 0);
      if (result.kind === 'result') {
        expect(result.receiptRejected).toBe(true);
        expect(result.sanitizedEnvironment).toBe(true);
        expect(result.replayRefused).toBe(counts[point] >= 3 ? true : null);
        expect(result.summary.appEffect).toBe(
          counts[point] < 3 ? 'not_dispatched' : counts[point] < 5 ? 'unknown' : 'observed_success',
        );
        if (counts[point] === 3 || counts[point] === 4)
          expect(result.summary.disposition).toBe('quarantined');
      }
      expect(session.bytes()).toEqual(bytes);
      expect(session.checkpoint()).toEqual(checkpointAt(counts[point]));
      expect(second.diagnostics()).toMatchObject({
        processExited: true,
        stdoutClosed: true,
        stderrClosed: true,
        stdoutBytes: 0,
      });
      expect(result).toMatchObject({
        runtimeAdmission: false,
        hostedAccepted: false,
        productActivation: false,
        authenticated: false,
        independentDurability: false,
        targetFencing: false,
        sqlDispatches: 0,
        providerDispatches: 0,
        actualRecipientNotifications: 0,
      });
    } finally {
      await session.cleanup();
    }
    expect(existsSync(session.root)).toBe(false);
  },
  20000,
);

it('completes fixed synthetic handoff normally and validates unchanged bytes in a fresh child', async () => {
  const session = createSession();
  try {
    const first = session.launch(session.plan('write', 'none'));
    const result = await first.next();
    expect(result.kind).toBe('result');
    expect((await first.exit()).code).toBe(0);
    if (result.kind === 'result')
      expect(result.summary.disposition).toBe('technical_evidence_only');
    expect(session.checkpoint()).toEqual(checkpointAt(9));
    const before = session.bytes();
    const second = session.launch(session.plan('read', 'none'));
    expect(second.pid).not.toBe(first.pid);
    expect((await second.next()).kind).toBe('result');
    expect((await second.exit()).code).toBe(0);
    expect(session.bytes()).toEqual(before);
  } finally {
    await session.cleanup();
  }
}, 20000);

it('can continue the paused partial record cooperatively without treating the partial bytes as acknowledged', async () => {
  const session = createSession();
  try {
    const child = session.launch(session.plan('write', 'partial-outcome'));
    expect((await child.next()).kind).toBe('paused');
    expect(session.checkpoint()).toEqual(checkpointAt(4));
    await child.resume();
    expect((await child.next()).kind).toBe('result');
    expect((await child.exit()).code).toBe(0);
    expect(session.checkpoint()).toEqual(checkpointAt(9));
  } finally {
    await session.cleanup();
  }
}, 20000);

it('closes on actual IPC disconnect, preserves intent uncertainty and refuses a fresh write over existing bytes', async () => {
  const session = createSession();
  try {
    const child = session.launch(session.plan('write', 'intent-ack'));
    await child.next();
    await child.disconnect();
    expect((await child.exit()).code).toBe(72);
    const before = session.bytes();
    const reader = session.launch(session.plan('read', 'none'));
    const result = await reader.next();
    expect(result.kind).toBe('result');
    if (result.kind === 'result') expect(result.summary.appEffect).toBe('unknown');
    await reader.exit();
    const writer = session.launch(session.plan('write', 'none'));
    expect((await writer.next()).kind).toBe('refused');
    expect((await writer.exit()).code).toBe(64);
    expect(session.bytes()).toEqual(before);
    expect(session.checkpoint()).toEqual(checkpointAt(3));
    expect(child.diagnostics()).toMatchObject({
      processExited: true,
      stdoutClosed: true,
      stderrClosed: true,
    });
  } finally {
    await session.cleanup();
  }
}, 20000);

it.each([
  'missing',
  'truncated',
  'reordered',
  'changed',
  'duplicate',
  'oversized',
  'fifo',
] as const)(
  'refuses %s journal bytes in a fresh child without changing or adopting them',
  async (fault) => {
    const session = createSession();
    try {
      const writer = session.launch(session.plan('write', 'none'));
      await writer.next();
      await writer.exit();
      const path = join(session.root, 'journal.ndjson'),
        original = readFileSync(path),
        lines = original.toString('utf8').trimEnd().split('\n');
      if (fault === 'missing') unlinkSync(path);
      else if (fault === 'fifo') {
        unlinkSync(path);
        expect(spawnSync('mkfifo', [path], { timeout: 5000 }).status).toBe(0);
      } else
        writeFileSync(
          path,
          fault === 'truncated'
            ? original.subarray(0, -12)
            : fault === 'reordered'
              ? [...lines].reverse().join('\n') + '\n'
              : fault === 'changed'
                ? original.toString('utf8').replace('foundation', 'quarantined')
                : fault === 'duplicate'
                  ? original.toString('utf8') + lines[0] + '\n'
                  : Buffer.alloc(65537, 120),
        );
      const before =
        fault === 'fifo' ? lstatSync(path).isFIFO() : existsSync(path) ? readFileSync(path) : null;
      const reader = session.launch(session.plan('read', 'none'));
      expect((await reader.next()).kind).toBe('refused');
      expect((await reader.exit()).code).toBe(64);
      expect(
        fault === 'fifo' ? lstatSync(path).isFIFO() : existsSync(path) ? readFileSync(path) : null,
      ).toEqual(before);
      expect(session.checkpoint()).toEqual(checkpointAt(9));
    } finally {
      await session.cleanup();
    }
  },
  20000,
);

it('rejects cross-session plans and a concurrent second child before spawn', async () => {
  const first = createSession(),
    second = createSession();
  try {
    expect(() => second.launch(first.plan('write', 'intent-ack'))).toThrow(
      /^Journal process refused$/,
    );
    const child = first.launch(first.plan('write', 'intent-ack'));
    await child.next();
    expect(() => first.launch(first.plan('read', 'none'))).toThrow(/^Journal process refused$/);
    await child.interrupt();
  } finally {
    await first.cleanup();
    await second.cleanup();
  }
}, 20000);

it('reports actual process/stream cleanup and evidence-only boundaries', async () => {
  const session = createSession();
  const child = session.launch(session.plan('write', 'intent-ack'));
  await child.next();
  await session.cleanup();
  expect(existsSync(session.root)).toBe(false);
  expect(child.diagnostics()).toMatchObject({
    processExited: true,
    stdoutClosed: true,
    stderrClosed: true,
  });
  const observed = processDiagnostics();
  expect(observed.started).toBeGreaterThan(0);
  expect(observed).toEqual({
    started: observed.started,
    exited: observed.started,
    stdoutClosed: observed.started,
    stderrClosed: observed.started,
  });
  console.log(
    'JOURNAL_PROCESS_EVIDENCE ' +
      JSON.stringify({
        scope: 'disposable-journal-process',
        actualChildProcesses: true,
        observed,
        forcedKillPoints: points.length,
        parentHeldSimulatedCheckpoint: true,
        temporaryJournalMaxBytes: 65536,
        sqlDispatches: 0,
        providerDispatches: 0,
        actualRecipientNotifications: 0,
        productionPolicyChanged: false,
        independentDurability: false,
        authenticated: false,
        targetFencing: false,
        runtimeAdmission: false,
        hostedAccepted: false,
        productActivation: false,
        casesClosed: 0,
        gatesClosed: 0,
      }),
  );
}, 20000);
