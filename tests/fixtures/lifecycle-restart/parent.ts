import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readExecutorPlan, readExecutorEvent, type ExecutorEvent } from './protocol.ts';

export function launchExecutor(raw: unknown) {
  const plan = readExecutorPlan(raw, process.env);
  const child = fork(fileURLToPath(new URL('./executor.ts', import.meta.url)), [], {
    execArgv: ['--import', 'tsx'],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    serialization: 'json',
  });
  let ended = false,
    failed = false;
  let exitValue: { code: number | null; signal: NodeJS.Signals | null };
  let out = '',
    err = '';
  const streamClosed = { stdout: false, stderr: false };
  const streamsClosed = [child.stdout!, child.stderr!].map(
    (stream, i) =>
      new Promise<void>((resolve) =>
        stream.once('close', () => {
          streamClosed[i === 0 ? 'stdout' : 'stderr'] = true;
          resolve();
        }),
      ),
  );
  const events: ExecutorEvent[] = [];
  let pending:
    | { resolve: (e: ExecutorEvent) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
    | undefined;
  const fail = () => {
    failed = true;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(Error('Disposable executor failed'));
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
  const exited = new Promise<typeof exitValue>((resolve) => {
    child.on('exit', (code, signal) => {
      ended = true;
      exitValue = { code, signal };
      if (pending) {
        clearTimeout(pending.timer);
        pending.reject(Error('Disposable executor closed'));
        pending = undefined;
      }
      resolve(exitValue);
    });
  });
  // Observe the actual process and both owned streams directly. In the pinned
  // runtime the aggregate ChildProcess close event did not arrive after manual
  // IPC disconnect, although exit and both stream close events were observed.
  const completed = Promise.all([exited, Promise.all(streamsClosed)] as const).then(
    ([value]) => value,
  );
  child.on('message', (rawEvent) => {
    try {
      const event = readExecutorEvent(rawEvent, plan);
      if (event.processId !== child.pid) throw Error();
      if (pending) {
        clearTimeout(pending.timer);
        pending.resolve(event);
        pending = undefined;
      } else {
        if (events.length >= 2) throw Error();
        events.push(event);
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
            reject(Error('Disposable executor exit timed out'));
          }, 5000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  return Object.freeze({
    pid: child.pid!,
    next(): Promise<ExecutorEvent> {
      if (events.length) return Promise.resolve(events.shift()!);
      if (ended || failed || pending)
        return Promise.reject(Error('Disposable executor unavailable'));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          fail();
        }, 10000);
        pending = { resolve, reject, timer };
      });
    },
    exit,
    async interrupt() {
      if (!ended) child.kill('SIGKILL');
      return exit();
    },
    async resume() {
      await new Promise<void>((resolve, reject) =>
        child.send({ kind: 'continue' }, (error) =>
          error ? reject(Error('Disposable executor unavailable')) : resolve(),
        ),
      );
    },
    async disconnect() {
      if (child.connected) child.disconnect();
    },
    async close() {
      if (!ended) child.kill('SIGKILL');
      await exit();
    },
    diagnostics() {
      const serialized = out + err;
      const inputs = Object.values(plan.inputs) as { url: string; ca: string }[];
      return {
        processExited: ended,
        stdoutClosed: streamClosed.stdout,
        stderrClosed: streamClosed.stderr,
        stdoutBytes: Buffer.byteLength(out),
        stderrBytes: Buffer.byteLength(err),
        secretFree: !inputs.some(
          (i) =>
            serialized.includes(i.url) ||
            serialized.includes(new URL(i.url).password) ||
            serialized.includes(i.ca),
        ),
      };
    },
  });
}
