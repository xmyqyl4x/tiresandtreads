import { EventEmitter } from 'node:events';
import { expect, it } from 'vitest';
import { createTransactions, type PgConnection } from '../../packages/db/src/transactions.ts';
import { ok, fail } from '../../packages/domain/src/values/core.ts';
import {
  failure,
  type TransactionContext,
} from '../../packages/application/src/ports/transactions.ts';

class Connection extends EventEmitter implements PgConnection {
  calls: string[] = [];
  released: boolean[] = [];
  handler: ((text: string) => Promise<void>) | undefined;
  async query(text: string) {
    this.calls.push(text);
    await this.handler?.(text);
    return { rows: [{ value: 1 }], rowCount: null, command: text.split(' ')[0]! };
  }
  release(destroy = false) {
    this.released.push(destroy);
  }
}
function harness() {
  const client = new Connection();
  const adapter = createTransactions({ connect: async () => client });
  return { client, ...adapter };
}
const sqlError = (code: string) =>
  Object.assign(new Error('private parameters must never escape'), { code });
it('commits awaited work on one client and invalidates its context', async () => {
  const { client, unitOfWork, query } = harness();
  let saved: TransactionContext | undefined;
  expect(
    await unitOfWork.run(async (tx) => {
      saved = tx;
      expect(await query(tx, 'SELECT $1', ['secret'])).toEqual({
        rows: [{ value: 1 }],
        rowCount: 0,
      });
      return ok(9);
    }),
  ).toEqual(ok(9));
  expect(client.calls.at(-1)).toBe('COMMIT');
  expect(client.released).toEqual([false]);
  await expect(query(saved!, 'SELECT 2')).rejects.toMatchObject({
    failure: { code: 'transaction_context' },
  });
});
it('rolls back typed business failure rather than committing it', async () => {
  const { client, unitOfWork } = harness();
  const rejected = fail(failure('forbidden'));
  expect(await unitOfWork.run(async () => rejected)).toEqual(rejected);
  expect(client.calls.at(-1)).toBe('ROLLBACK');
});
it.each(['23505', '23503', '40001', '40P01', '57014', '55P03', '08006'])(
  'does not commit even if the caller catches SQLSTATE %s',
  async (code) => {
    const { client, unitOfWork, query } = harness();
    client.handler = async (sql) => {
      if (sql === 'BROKEN') throw sqlError(code);
    };
    const result = await unitOfWork.run(async (tx) => {
      await query(tx, 'BROKEN').catch(() => {});
      return ok('must rollback');
    });
    expect(result.ok).toBe(false);
    expect(client.calls).not.toContain('COMMIT');
    expect(JSON.stringify(result)).not.toContain('private');
  },
);
it('does not retry a commit with uncertain acknowledgement', async () => {
  const { client, unitOfWork } = harness();
  client.handler = async (sql) => {
    if (sql === 'COMMIT') throw sqlError('08006');
  };
  expect(await unitOfWork.run(async () => ok(1))).toEqual(fail(failure('commit_unknown')));
  expect(client.calls.filter((sql) => sql === 'COMMIT')).toHaveLength(1);
  expect(client.released).toEqual([true]);
});
it('distinguishes a deferred constraint rejection from an unknown commit', async () => {
  const { client, unitOfWork } = harness();
  client.handler = async (sql) => {
    if (sql === 'COMMIT') throw sqlError('23503');
  };
  expect(await unitOfWork.run(async () => ok(1))).toEqual(fail(failure('integrity')));
  expect(client.calls.at(-1)).toBe('ROLLBACK');
});
it('rolls back a server-rejected serialization at commit without automatic retry', async () => {
  const { client, unitOfWork } = harness();
  client.handler = async (sql) => {
    if (sql === 'COMMIT') throw sqlError('40001');
  };
  expect(await unitOfWork.run(async () => ok(1))).toEqual(fail(failure('conflict', true)));
  expect(client.released).toEqual([false]);
});
it('rejects a context from a different adapter', async () => {
  const first = harness(),
    second = harness();
  await first.unitOfWork.run(async (tx) => {
    await expect(second.query(tx, 'SELECT 1')).rejects.toMatchObject({
      failure: { code: 'transaction_context' },
    });
    return ok(1);
  });
  expect(second.client.calls).toEqual([]);
});
it('bounds pool admission and destroys a late borrowed client', async () => {
  const client = new Connection();
  let deliver!: (value: PgConnection) => void;
  const { unitOfWork } = createTransactions(
    {
      connect: () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
    },
    { admissionMs: 10 },
  );
  expect(await unitOfWork.run(async () => ok(1))).toEqual(fail(failure('timeout')));
  deliver(client);
  await new Promise((resolve) => setImmediate(resolve));
  expect(client.released).toEqual([true]);
  expect(client.calls).toEqual([]);
});
it('contains pool and callback failures without disclosing raw errors', async () => {
  const { unitOfWork } = createTransactions({
    connect: async () => {
      throw sqlError('08006');
    },
  });
  expect(await unitOfWork.run(async () => ok(1))).toEqual(fail(failure('unavailable')));
  const { unitOfWork: other, client } = harness();
  expect(
    await other.run(async () => {
      throw new Error('private');
    }),
  ).toEqual(fail(failure('internal')));
  expect(client.calls).not.toContain('COMMIT');
});
it('destroys clients whose rollback fails', async () => {
  const { client, unitOfWork } = harness();
  client.handler = async (sql) => {
    if (sql === 'ROLLBACK') throw sqlError('08006');
  };
  await unitOfWork.run(async () => fail(failure('forbidden')));
  expect(client.released).toEqual([true]);
});
it('enforces the callback deadline and refuses delayed work on a released context', async () => {
  const client = new Connection();
  const { unitOfWork, query } = createTransactions(
    { connect: async () => client },
    { transactionMs: 10 },
  );
  let tx!: TransactionContext;
  let finish!: () => void;
  const result = await unitOfWork.run(async (context) => {
    tx = context;
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return ok(1);
  });
  expect(result).toEqual(fail(failure('timeout')));
  expect(client.released).toEqual([true]);
  await expect(query(tx, 'SELECT 1')).rejects.toMatchObject({
    failure: { code: 'transaction_context' },
  });
  finish();
  await new Promise((resolve) => setImmediate(resolve));
  expect(client.calls).not.toContain('COMMIT');
});
it('rejects floating and parallel SQL instead of allowing it to commit', async () => {
  const { client, unitOfWork, query } = harness();
  let complete!: () => void;
  client.handler = async (sql) => {
    if (sql === 'WAIT')
      await new Promise<void>((resolve) => {
        complete = resolve;
      });
  };
  await unitOfWork.run(async (tx) => {
    const pending = query(tx, 'WAIT').catch(() => {});
    await expect(query(tx, 'SELECT 2')).rejects.toMatchObject({
      failure: { code: 'transaction_context' },
    });
    complete();
    await pending;
    return ok(1);
  });
  expect(client.calls).not.toContain('COMMIT');
  client.calls = [];
  const result = await unitOfWork.run(async (tx) => {
    void query(tx, 'WAIT').catch(() => {});
    return ok(1);
  });
  expect(result).toEqual(fail(failure('transaction_context')));
  expect(client.released.at(-1)).toBe(true);
  complete();
});
it('rejects invalid limits and handles borrowed connection errors', async () => {
  expect(() =>
    createTransactions({ connect: async () => new Connection() }, { statementMs: 0 }),
  ).toThrow('Invalid transaction limits');
  expect(() =>
    createTransactions({ connect: async () => new Connection() }, { transactionMs: 30001 }),
  ).toThrow();
  const { client, unitOfWork } = harness();
  expect(
    await unitOfWork.run(async () => {
      client.emit('error', new Error('private'));
      return ok(1);
    }),
  ).toEqual(fail(failure('unavailable')));
  expect(client.released).toEqual([true]);
});
