import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { launchExecutor } from '../fixtures/lifecycle-restart/parent.ts';
import { interruptionPoints, type ExecutorPlan } from '../fixtures/lifecycle-restart/protocol.ts';
import { lifecycleFixture } from '../fixtures/lifecycle-validation/database.ts';
import { lifecyclePhases, lifecycleSourceDigest } from '../fixtures/lifecycle-validation/reader.ts';

describe.each(lifecyclePhases)('interrupted executor and cold restart: %s', (phase) => {
  let f: Awaited<ReturnType<typeof lifecycleFixture>>;
  beforeAll(async () => {
    f = await lifecycleFixture(phase);
  }, 60000);
  afterAll(async () => {
    await f?.cleanup();
  });
  const plan = (
    point: (typeof interruptionPoints)[number] | 'none',
    previousReceipt: unknown = null,
  ): ExecutorPlan => ({
    version: 1,
    project: process.env.ISOLATED_TEST_PROJECT!,
    kind: point === 'none' ? 'restart' : 'interrupt',
    point,
    inputs: { app: f.input('app'), cms: f.input('cms') },
    baseline: f.baseline,
    identity: {
      operationId: randomBytes(16).toString('hex'),
      releaseDigest: lifecycleSourceDigest(),
      credentialGeneration: randomBytes(16).toString('hex'),
    },
    previousReceipt,
  });
  async function locks() {
    return (
      await f.root.query(
        "SELECT count(*)::int AS n FROM pg_locks WHERE locktype='advisory' AND classid=7724046 AND objid=1 AND granted AND database=(SELECT oid FROM pg_database WHERE datname='tt_app_lifecycle_probe')",
      )
    ).rows[0].n as number;
  }
  async function cleanSessions() {
    for (let n = 0; n < 100; n++) {
      if ((await f.activeInspections()) === 0 && (await locks()) === 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw Error('Owned disposable executor sessions did not close');
  }

  it.each(interruptionPoints)(
    'kills the actual executor at %s, releases its sessions/lock, rejects old evidence and re-reads both DBs after restart',
    async (point) => {
      const before = await f.snapshot(),
        originalPlan = plan(point),
        executor = launchExecutor(originalPlan);
      try {
        const checkpoint = await executor.next();
        expect(checkpoint.kind).toBe('checkpoint');
        if (checkpoint.kind !== 'checkpoint') throw Error('Expected controlled interruption');
        expect(checkpoint.point).toBe(point);
        expect(checkpoint.reads).toEqual(
          point === 'app-read'
            ? { app: 2, cms: 1 }
            : point === 'cms-read'
              ? { app: 2, cms: 2 }
              : { app: 1, cms: 1 },
        );
        expect(checkpoint.receipt).toMatchObject({
          phase,
          project: process.env.ISOLATED_TEST_PROJECT,
          hostedAccepted: false,
          productActivation: false,
          runtimeAdmission: false,
        });
        expect(await locks()).toBe(point === 'receipt' ? 0 : 1);
        const exited = await executor.interrupt();
        expect(exited.signal).toBe('SIGKILL');
        await cleanSessions();
        expect(await f.snapshot()).toEqual(before);
        const restart = launchExecutor({
          ...originalPlan,
          kind: 'restart',
          point: 'none',
          previousReceipt: checkpoint.receipt,
        });
        try {
          expect(restart.pid).not.toBe(executor.pid);
          const result = await restart.next();
          expect(result).toMatchObject({
            kind: 'result',
            importedReceiptRejected: true,
            importReads: { app: 0, cms: 0 },
            validationStatus: 'validated',
            handoffStatus: 'observed',
            reads: { app: 2, cms: 2 },
            runtimeAdmission: false,
            hostedAccepted: false,
            productActivation: false,
          });
          expect((await restart.exit()).code).toBe(0);
          expect(restart.diagnostics()).toMatchObject({
            processExited: true,
            stdoutClosed: true,
            stderrClosed: true,
            stdoutBytes: 0,
            stderrBytes: 0,
            secretFree: true,
          });
        } finally {
          await restart.close();
        }
        await cleanSessions();
        expect(await f.snapshot()).toEqual(before);
        if (phase === 'quarantined-recovery') await f.assertRuntimeDenied();
        expect(executor.diagnostics()).toMatchObject({
          stdoutBytes: 0,
          stderrBytes: 0,
          secretFree: true,
        });
      } finally {
        await executor.close();
      }
    },
    30000,
  );

  it('can resume a real paused executor through the same read-only path without faking a crash or success', async () => {
    const before = await f.snapshot(),
      executor = launchExecutor(plan('validation-locked'));
    try {
      expect((await executor.next()).kind).toBe('checkpoint');
      await executor.resume();
      expect(await executor.next()).toMatchObject({
        kind: 'result',
        validationStatus: 'validated',
        handoffStatus: 'observed',
        reads: { app: 3, cms: 3 },
        runtimeAdmission: false,
      });
      expect((await executor.exit()).code).toBe(0);
      await cleanSessions();
      expect(await f.snapshot()).toEqual(before);
    } finally {
      await executor.close();
    }
  }, 30000);

  it('refuses actual post-crash CMS drift, preserves it, and needs a new process and fresh validation after repair', async () => {
    const originalPlan = plan('receipt'),
      executor = launchExecutor(originalPlan);
    try {
      const checkpoint = await executor.next();
      if (checkpoint.kind !== 'checkpoint') throw Error('Missing original evidence');
      await executor.interrupt();
      await cleanSessions();
      await f.withOwner('cms', (c) => c.query('GRANT CREATE ON SCHEMA public TO PUBLIC'));
      const restartPlan = {
        ...originalPlan,
        kind: 'restart' as const,
        point: 'none' as const,
        previousReceipt: checkpoint.receipt,
      };
      try {
        const defective = await f.snapshot(),
          restart = launchExecutor(restartPlan);
        try {
          expect(await restart.next()).toMatchObject({
            kind: 'result',
            importedReceiptRejected: true,
            validationStatus: 'refused',
            handoffStatus: 'absent',
            reads: { app: 1, cms: 1 },
            runtimeAdmission: false,
          });
          expect((await restart.exit()).code).toBe(0);
          expect(await f.snapshot()).toEqual(defective);
        } finally {
          await restart.close();
        }
      } finally {
        await f.withOwner('cms', (c) => c.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC'));
      }
      const repaired = launchExecutor(restartPlan);
      try {
        expect(await repaired.next()).toMatchObject({
          kind: 'result',
          importedReceiptRejected: true,
          validationStatus: 'validated',
          handoffStatus: 'observed',
          reads: { app: 2, cms: 2 },
          runtimeAdmission: false,
        });
        expect((await repaired.exit()).code).toBe(0);
      } finally {
        await repaired.close();
      }
      await cleanSessions();
    } finally {
      await executor.close();
    }
  }, 30000);

  it('closes an orphaned child when its actual IPC channel disconnects and leaves no admission or durable mutation', async () => {
    const before = await f.snapshot(),
      executor = launchExecutor(plan('validation-locked'));
    try {
      expect((await executor.next()).kind).toBe('checkpoint');
      await executor.disconnect();
      expect((await executor.exit()).code).toBe(72);
      expect(executor.diagnostics()).toMatchObject({
        processExited: true,
        stdoutClosed: true,
        stderrClosed: true,
        stdoutBytes: 0,
        stderrBytes: 0,
        secretFree: true,
      });
      await cleanSessions();
      expect(await f.snapshot()).toEqual(before);
    } finally {
      await executor.close();
    }
  }, 30000);
});
