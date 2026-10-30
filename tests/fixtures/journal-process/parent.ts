import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  checkpointAt,
  exportedAt,
  readPlan,
  readEvent,
  must,
  type Event,
  type Point,
  type Plan,
} from './contract.ts';
import { temporaryJournal, inspectJournal } from './storage.ts';

const observed = { started: 0, exited: 0, stdoutClosed: 0, stderrClosed: 0 };
export const processDiagnostics = () => Object.freeze({ ...observed });

export function createSession() {
  must(
    process.env.APP_ENV === 'test-local' &&
      process.env.PROVIDER_MODE === 'fixtures' &&
      /^tt-test-[a-f0-9]{16}$/.test(process.env.ISOLATED_TEST_PROJECT ?? ''),
  );
  const workspace = temporaryJournal(),
    children: { close: () => Promise<void> }[] = [];
  let current = checkpointAt(0),
    exported = exportedAt(0),
    active = false,
    cleaned = false;
  const env = {
    PATH: process.env.PATH ?? '',
    NODE_ENV: 'test' as const,
    APP_ENV: 'test-local',
    PROVIDER_MODE: 'fixtures',
    ISOLATED_TEST_PROJECT: process.env.ISOLATED_TEST_PROJECT!,
    JOURNAL_PROOF_ROOT: workspace.root,
    JOURNAL_PROOF_RUN: workspace.runId,
  };
  function launch(raw: unknown) {
    must(!active && !cleaned);
    const plan = readPlan(raw, env);
    if (plan.mode === 'read')
      must(
        plan.checkpoint.count === current.count &&
          plan.checkpoint.head === current.head &&
          plan.exportedReceipt === exported,
      );
    const child = fork(fileURLToPath(new URL('./child.ts', import.meta.url)), [], {
      cwd: workspace.root,
      env,
      execArgv: ['--import', import.meta.resolve('tsx')],
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      serialization: 'json',
    });
    observed.started++;
    active = true;
    let ended = false,
      failed = false,
      held: 'accepted' | 'continue' | undefined;
    let out = '',
      err = '';
    const closed = { stdout: false, stderr: false };
    const streams = [child.stdout!, child.stderr!].map(
      (stream, index) =>
        new Promise<void>((resolve) =>
          stream.once('close', () => {
            closed[index === 0 ? 'stdout' : 'stderr'] = true;
            observed[index === 0 ? 'stdoutClosed' : 'stderrClosed']++;
            resolve();
          }),
        ),
    );
    const queue: Event[] = [];
    let pending:
      | { resolve: (event: Event) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
      | undefined;
    const fail = () => {
      failed = true;
      if (pending) {
        clearTimeout(pending.timer);
        pending.reject(Error('Journal process refused'));
        pending = undefined;
      }
      if (!ended) child.kill('SIGKILL');
    };
    child.on('error', fail);
    child.stdout!.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
      if (Buffer.byteLength(out) > 8192) fail();
    });
    child.stderr!.on('data', (chunk: Buffer) => {
      err += chunk.toString('utf8');
      if (Buffer.byteLength(err) > 8192) fail();
    });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
      child.once('exit', (code, signal) => {
        ended = true;
        observed.exited++;
        if (pending) {
          clearTimeout(pending.timer);
          pending.reject(Error('Journal process refused'));
          pending = undefined;
        }
        resolve({ code, signal });
      }),
    );
    const completed = Promise.all([exited, Promise.all(streams)]).then(([value]) => {
      active = false;
      return value;
    });
    const command = (kind: string) =>
      new Promise<void>((resolve, reject) =>
        child.send({ kind }, (error) =>
          error ? reject(Error('Journal process refused')) : resolve(),
        ),
      );
    child.on('message', (rawEvent) => {
      try {
        const event = readEvent(rawEvent, plan, child.pid!);
        if (event.kind === 'ack') {
          must(event.checkpoint.count === current.count + 1);
          const observed = inspectJournal(workspace.root, workspace.runId, event.checkpoint);
          current = Object.freeze({ ...event.checkpoint });
          exported = JSON.stringify(observed.journal.receipt());
          if (event.point !== plan.point || event.point === 'none') {
            void command('accepted').catch(fail);
            return;
          }
          held = 'accepted';
        } else if (event.kind === 'paused') held = 'continue';
        else if (event.kind === 'result') inspectJournal(workspace.root, workspace.runId, current);
        if (pending) {
          clearTimeout(pending.timer);
          const next = pending;
          pending = undefined;
          next.resolve(event);
        } else {
          must(queue.length < 2);
          queue.push(event);
        }
      } catch {
        fail();
      }
    });
    child.send(plan, (error) => {
      if (error) fail();
    });
    async function exit() {
      let timer: NodeJS.Timeout | undefined;
      try {
        return await Promise.race([
          completed,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              fail();
              reject(Error('Journal process exit timed out'));
            }, 5000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    }
    const control = Object.freeze({
      pid: child.pid!,
      next(): Promise<Event> {
        if (queue.length) return Promise.resolve(queue.shift()!);
        if (ended || failed || pending) return Promise.reject(Error('Journal process refused'));
        return new Promise((resolve, reject) => {
          const timer = setTimeout(fail, 10000);
          pending = { resolve, reject, timer };
        });
      },
      exit,
      async interrupt() {
        if (!ended) child.kill('SIGKILL');
        return exit();
      },
      async resume() {
        must(held && !ended && !failed);
        const kind = held;
        held = undefined;
        await command(kind);
      },
      async disconnect() {
        if (child.connected) child.disconnect();
      },
      async close() {
        if (!ended) child.kill('SIGKILL');
        await exit();
      },
      diagnostics: () => ({
        processExited: ended,
        stdoutClosed: closed.stdout,
        stderrClosed: closed.stderr,
        stdoutBytes: Buffer.byteLength(out),
        stderrBytes: Buffer.byteLength(err),
      }),
    });
    children.push(control);
    return control;
  }
  return Object.freeze({
    root: workspace.root,
    runId: workspace.runId,
    checkpoint: () => Object.freeze({ ...current }),
    bytes: workspace.bytes,
    plan(mode: Plan['mode'], point: Point | 'none'): Plan {
      return readPlan(
        {
          version: 1,
          scope: 'disposable-journal-process',
          project: env.ISOLATED_TEST_PROJECT,
          runId: workspace.runId,
          mode,
          point,
          checkpoint: mode === 'write' ? checkpointAt(0) : current,
          exportedReceipt: mode === 'write' ? exportedAt(0) : exported,
        },
        env,
      );
    },
    launch,
    async cleanup() {
      if (cleaned) return;
      for (const child of children) await child.close();
      workspace.cleanup();
      cleaned = true;
    },
  });
}
