import { spawn } from 'node:child_process';
export function startDurableChild(configFile: string) {
  const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'tests/fixtures/phase2/durable-host-child.ts', configFile],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    ),
    events: Array<Record<string, unknown>> = [];
  let bytes = 0,
    buffer = '',
    stderrBytes = 0,
    exited = false;
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const notify of [...listeners]) notify();
  };
  child.stdout.on('data', (chunk) => {
    bytes += chunk.length;
    if (bytes > 32768) {
      child.kill('SIGKILL');
      return;
    }
    buffer += String(chunk);
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.startsWith('P2_LOCAL_RUNTIME_CONTROL ')) {
        try {
          const value: unknown = JSON.parse(line.slice(25));
          if (!value || typeof value !== 'object' || Array.isArray(value))
            throw Error('Invalid child record');
          events.push(value as Record<string, unknown>);
        } catch {
          events.push({ state: 'failed' });
          child.kill('SIGKILL');
        }
        changed();
      }
    }
  });
  child.stderr.on('data', (chunk) => {
    stderrBytes += chunk.length;
    if (stderrBytes > 8192) child.kill('SIGKILL');
  });
  child.once('error', () => {
    events.push({ state: 'failed' });
    changed();
  });
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    child.once('close', (code, signal) => {
      exited = true;
      resolve({ code, signal });
      changed();
    }),
  );
  async function wait(state: string, ms = 45000) {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        listeners.delete(check);
      };
      const check = () => {
        const index = events.findIndex((e) => e.state === state);
        if (index >= 0) {
          cleanup();
          resolve(events.splice(index, 1)[0]!);
        } else if (events.some((e) => e.state === 'failed') || exited) {
          cleanup();
          reject(Error('Owned local worker failed before ' + state));
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(Error('Owned local worker deadline'));
      }, ms);
      listeners.add(check);
      check();
    });
  }
  return {
    child,
    exit,
    wait,
    events,
    command(kind: 'tick' | 'stop') {
      child.stdin.write(kind + '\n');
    },
    async cleanup() {
      if (exited) return;
      child.stdin.write('stop\n');
      const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
      try {
        await exit;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
