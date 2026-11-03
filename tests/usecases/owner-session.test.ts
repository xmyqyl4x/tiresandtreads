import { it, expect } from 'vitest';
import { ownerSession } from '../../apps/web/src/owner-session.ts';
const id = '10000000-0000-4000-8000-000000000001';
it('coalesces concurrent identity initialization even when callers wrap different transports', async () => {
  let release!: () => void;
  const waiting = new Promise<void>((r) => {
    release = r;
  });
  let gets = 0,
    posts = 0;
  const send: typeof fetch = async (_url, init) => {
    if (init?.method === 'POST') {
      posts++;
      return Response.json({ data: { csrf: 'a'.repeat(64) }, requestId: id });
    }
    gets++;
    await waiting;
    return Response.json(
      {
        code: 'unauthorized',
        messageKey: 'session.required',
        fieldErrors: {},
        retryable: false,
        requestId: id,
      },
      { status: 401 },
    );
  };
  const a = ownerSession('http://127.0.0.1:8380', send),
    b = ownerSession('http://127.0.0.1:8380', (...args) => send(...args));
  release();
  expect(await a).toEqual(await b);
  expect(gets).toBe(1);
  expect(posts).toBe(1);
});
it('releases a rejected initialization and never retains a CSRF token after completion', async () => {
  let calls = 0;
  const send: typeof fetch = async () => {
    calls++;
    if (calls === 1) throw Error('offline');
    return Response.json({ data: { csrf: 'b'.repeat(64) }, requestId: id });
  };
  await expect(ownerSession('http://127.0.0.1:8480', send)).rejects.toThrow('offline');
  await ownerSession('http://127.0.0.1:8480', send);
  await ownerSession('http://127.0.0.1:8480', send);
  expect(calls).toBe(3);
});
