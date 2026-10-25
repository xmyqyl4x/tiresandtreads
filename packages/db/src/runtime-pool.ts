import pg from 'pg';
import type { PgConnection, PgPool } from './transactions.ts';

export function createRuntimePool(connectionString: string, max = 2, queueLimit = 8) {
  if (
    !Number.isInteger(max) ||
    max < 1 ||
    max > 10 ||
    !Number.isInteger(queueLimit) ||
    queueLimit < 1 ||
    queueLimit > 100
  )
    throw Error('Invalid pool bounds');
  const pool = new pg.Pool({
    connectionString,
    max,
    connectionTimeoutMillis: 500,
    idleTimeoutMillis: 1000,
    statement_timeout: 2000,
    lock_timeout: 500,
    idle_in_transaction_session_timeout: 3000,
    application_name: 'tt-runtime',
  });
  let closing = false,
    requests = 0;
  const active = new Set<(destroy?: boolean) => void>();
  // Idle socket errors are safe metrics only; pg emits them outside a checked-out transaction.
  pool.on('error', () => {});
  const adapter: PgPool = {
    async connect() {
      if (closing || active.size + requests >= max + queueLimit)
        throw Error('Database unavailable');
      requests++;
      try {
        const client = await pool.connect();
        if (closing) {
          client.release(true);
          throw Error('Database unavailable');
        }
        let released = false;
        function release(destroy = false) {
          if (released) return;
          released = true;
          active.delete(release);
          client.release(destroy);
        }
        active.add(release);
        return {
          query: (text, values) => client.query(text, values),
          on: (event, listener) => client.on(event, listener),
          removeListener: (event, listener) => client.removeListener(event, listener),
          release,
        } satisfies PgConnection;
      } catch {
        throw Error('Database unavailable');
      } finally {
        requests--;
      }
    },
  };
  let draining: Promise<void> | undefined;
  return {
    pool: adapter,
    drain(ms = 5000) {
      if (!Number.isInteger(ms) || ms < 1 || ms > 10000) throw Error('Invalid drain deadline');
      closing = true;
      return (draining ??= (async () => {
        const timer = setTimeout(() => {
          for (const release of active) release(true);
        }, ms);
        try {
          await pool.end();
        } finally {
          clearTimeout(timer);
        }
      })());
    },
  };
}
