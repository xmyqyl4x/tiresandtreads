import { it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixtureServer } from '../setup.ts';
import { createSourceHttp } from '../../packages/integrations/src/sources/http.ts';

it('refuses an unsolicited 304 when a saved receipt supplies no request validator', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tt-source-conditional-')),
    path = join(dir, 'unmodified'),
    url = 'https://static.nhtsa.gov/conditional.zip',
    requests: Request[] = [];
  fixtureServer.use(
    http.get(url, ({ request }) => {
      requests.push(request);
      return new HttpResponse(null, { status: 304, headers: { etag: '"new"' } });
    }),
  );
  try {
    for (const previous of [
      { etag: null, modified: null },
      { etag: '', modified: '' },
    ]) {
      await expect(
        createSourceHttp(vi.fn(async () => {}))(url, path, 32, AbortSignal.timeout(1000), previous),
      ).rejects.toThrow('Unbased not-modified');
    }
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.headers.has('if-none-match')).toBe(false);
      expect(request.headers.has('if-modified-since')).toBe(false);
    }
    await expect(access(path)).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it.each([
  ['if-none-match', '"known"', { etag: '"known"', modified: null }],
  [
    'if-modified-since',
    'Sun, 15 Nov 2026 00:00:00 GMT',
    { etag: null, modified: 'Sun, 15 Nov 2026 00:00:00 GMT' },
  ],
] as const)(
  'accepts a 304 only after sending the stored %s validator',
  async (header, value, previous) => {
    const dir = await mkdtemp(join(tmpdir(), 'tt-source-conditional-')),
      path = join(dir, 'unmodified'),
      url = 'https://static.nhtsa.gov/conditional.zip';
    let requests = 0;
    fixtureServer.use(
      http.get(url, ({ request }) => {
        requests++;
        expect(request.headers.get(header)).toBe(value);
        return new HttpResponse(null, { status: 304 });
      }),
    );
    try {
      await expect(
        createSourceHttp(vi.fn(async () => {}))(url, path, 32, AbortSignal.timeout(1000), previous),
      ).resolves.toEqual({ modified: false, validators: previous });
      expect(requests).toBe(1);
      await expect(access(path)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
