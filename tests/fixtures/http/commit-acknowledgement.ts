import type { PgPool } from '../../../packages/db/src/transactions.ts';
export type CommitOutcome = 'committed' | 'rolled-back';
// One caller-armed fault in the existing disposable private-role pool only.
// The committed branch receives a real PostgreSQL COMMIT before suppressing its
// acknowledgement; the other branch executes ROLLBACK instead of sending COMMIT.
// This simulates driver uncertainty, not a real network partition or durability.
export function commitAcknowledgementFixture() {
  const observed = { injected: 0, committed: 0, rolledBack: 0, destroyed: 0 };
  let armed:
    { operation: 'request' | 'cancel'; target: string; outcome: CommitOutcome } | undefined;
  return {
    observed,
    arm(operation: 'request' | 'cancel', target: string, outcome: CommitOutcome) {
      if (armed || observed.injected || !/^[a-f0-9-]{36}$/.test(target))
        throw Error('Invalid one-shot synthetic fault');
      armed = { operation, target, outcome };
    },
    decorate: (pool: PgPool): PgPool => ({
      async connect() {
        const client = await pool.connect();
        let target: typeof armed;
        let injected = false;
        return {
          async query(text, values) {
            if (
              armed &&
              ((armed.operation === 'cancel' &&
                text.startsWith("UPDATE email.email_sends SET dispatch_state='cancelled'") &&
                values?.[0] === armed.target) ||
                (armed.operation === 'request' &&
                  text.startsWith('INSERT INTO email.email_sends(') &&
                  values?.[1] === 'report' &&
                  values?.[4] === armed.target))
            )
              target = armed;
            if (text === 'COMMIT' && target && target === armed) {
              armed = undefined;
              const result = await client.query(
                target.outcome === 'committed' ? 'COMMIT' : 'ROLLBACK',
              );
              if (result.command !== (target.outcome === 'committed' ? 'COMMIT' : 'ROLLBACK'))
                throw Error('Unexpected synthetic transaction result');
              observed.injected++;
              if (target.outcome === 'committed') observed.committed++;
              else observed.rolledBack++;
              injected = true;
              throw Object.assign(Error('Synthetic commit acknowledgement lost'), {
                code: '08006',
              });
            }
            return client.query(text, values);
          },
          release(destroy) {
            if (destroy && injected) observed.destroyed++;
            client.release(destroy);
          },
          on: (event, listener) => client.on(event, listener),
          removeListener: (event, listener) => client.removeListener(event, listener),
        };
      },
    }),
  };
}
