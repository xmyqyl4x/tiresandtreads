import { it, expect, vi } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { createEditorialService } from '../../packages/application/src/services/editorial.ts';
import { editorialHttp } from '../../packages/integrations/src/editorial-http.ts';
import { editorialCommandSchema } from '../../packages/contracts/src/editorial-client.ts';
import type { EditorialStore } from '../../packages/application/src/ports/editorial.ts';
import type {
  EditorialActor,
  EditorialDocument,
  EditorialRole,
  EditorialCommand,
} from '../../packages/domain/src/editorial.ts';
const at = '2026-11-03T12:00:00.000Z',
  origin = 'http://127.0.0.1:8380',
  tokens = { author: 'a'.repeat(43), reviewer: 'b'.repeat(43), publisher: 'c'.repeat(43) };
const redirectValue = () => ({
  revision: 1,
  issuedAt: at,
  expiresAt: '2026-11-04T12:00:00.000Z',
  rules: [
    {
      source: '/learn/old',
      target: '/learn/tire-basics',
      code: 301 as const,
      mode: 'exact' as const,
    },
  ],
});
function setup(redirects?: Parameters<typeof createEditorialService>[0]['redirects']) {
  const documents = new Map<string, EditorialDocument>(),
    history = new Map<string, { id: string; document: EditorialDocument }[]>(),
    actors: Record<EditorialRole, EditorialActor> = {
      author: { id: 'author', cmsId: 'cms-author', name: 'Synthetic author', roles: ['author'] },
      reviewer: {
        id: 'reviewer',
        cmsId: 'cms-reviewer',
        name: 'Synthetic reviewer',
        roles: ['reviewer'],
      },
      publisher: {
        id: 'publisher',
        cmsId: 'cms-publisher',
        name: 'Synthetic publisher',
        roles: ['publisher'],
      },
    };
  const store: EditorialStore = {
    list: async () => [...documents.values()],
    atomic: async (id, work) =>
      work({
        read: async () => structuredClone(documents.get(id) ?? null),
        save: async (doc) => {
          documents.set(id, structuredClone(doc));
          history.set(
            id,
            [
              { id: randomUUID(), document: structuredClone(doc) },
              ...(history.get(id) ?? []),
            ].slice(0, 20),
          );
        },
        versions: async () => structuredClone(history.get(id) ?? []),
      }),
  };
  const require = vi.fn(async (credential: string, role: EditorialRole | 'read') => {
    const key = (Object.keys(tokens) as EditorialRole[]).find((k) => tokens[k] === credential);
    if (!key) throw Error('unauthenticated');
    const actor = actors[key];
    if (role !== 'read' && !actor.roles.includes(role)) throw Error('forbidden');
    return actor;
  });
  const now = vi.fn(() => at);
  const enqueue = vi.fn<
      (
        actor: string,
        ref: { id: string; collection: 'articles' | 'glossary-terms'; revision: number },
        action: 'publish' | 'withdraw',
      ) => Promise<boolean>
    >(async () => true),
    service = createEditorialService({
      store,
      authorization: { require },
      deliver: enqueue,
      digest: (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex'),
      now,
      ...(redirects ? { redirects } : {}),
    });
  const id = randomUUID(),
    draft = {
      key: 'section-width',
      kind: 'glossary' as 'article' | 'glossary',
      path: '/glossary/section-width',
      title: 'Section width',
      summary: 'A size component.',
      paragraphs: ['Nominal width is a descriptive size component.'],
      topics: ['size' as const],
      related: [],
      references: [{ title: 'NHTSA tires', url: 'https://www.nhtsa.gov/vehicle-safety/tires' }],
    };
  const command = (action: string, extra: Partial<EditorialCommand> = {}) => ({
    id,
    expectedRevision: documents.get(id)?.revision ?? 0,
    key: randomUUID(),
    action,
    ...extra,
  });
  const save = () => service.execute(tokens.author, command('save', { draft }));
  async function approve() {
    await save();
    await service.execute(tokens.author, command('submit'));
    await service.execute(
      tokens.reviewer,
      command('approve', { expiresAt: '2027-01-01T00:00:00.000Z' }),
    );
  }
  const http = editorialHttp({ origin, service });
  const request = (path = '', options: RequestInit = {}) =>
    new Request(origin + '/local-editorial/api' + path, {
      ...options,
      headers: {
        host: '127.0.0.1:8380',
        origin,
        authorization: 'Bearer ' + tokens.author,
        ...Object.fromEntries(new Headers(options.headers)),
      },
    });
  return {
    service,
    store,
    documents,
    history,
    actors,
    require,
    enqueue,
    now,
    id,
    draft,
    command,
    save,
    approve,
    http,
    request,
  };
}
it('reads current identity, bounded list summaries and exact native-history references without exposing command bodies in lists', async () => {
  const f = setup();
  expect(await f.service.identity(tokens.author)).toEqual({
    id: 'author',
    name: 'Synthetic author',
    roles: ['author'],
  });
  expect(await f.service.list(tokens.author)).toEqual([]);
  expect((await f.service.read(tokens.author, f.id)).document).toBeNull();
  await f.save();
  const listed = await f.service.list(tokens.author);
  expect(listed[0]).toMatchObject({ revision: 1, draft: { title: 'Section width' } });
  expect(JSON.stringify(listed)).not.toContain('digest');
  expect((await f.service.read(tokens.author, f.id)).versions).toHaveLength(1);
});
it('does not expose mutable roles through identity receipts', async () => {
  const f = setup(),
    identity = await f.service.identity(tokens.author);
  identity.roles.push('publisher');
  expect(f.actors.author.roles).toEqual(['author']);
});
it('keeps optional redirects unavailable and authorizes before reading them', async () => {
  const f = setup();
  await expect(f.service.redirects(tokens.publisher)).rejects.toThrow('unavailable');
  await expect(f.service.redirects(tokens.author)).rejects.toThrow('forbidden');
  await expect(
    f.service.publishRedirects(tokens.publisher, tokens.reviewer, redirectValue()),
  ).rejects.toThrow('unavailable');
});
it('reads the current redirect authority and publishes a detached snapshot with independent reauthorization', async () => {
  const value = redirectValue(),
    read = vi.fn(async () => value),
    publish = vi.fn(async () => null),
    f = setup({ read, publish });
  expect(await f.service.redirects(tokens.publisher)).toEqual({ current: value, serverTime: at });
  expect(read).toHaveBeenCalledWith('publisher');
  const pending = f.service.publishRedirects(tokens.publisher, tokens.reviewer, value);
  value.rules[0]!.target = '/learn/changed';
  expect(await pending).toEqual({ revision: 1 });
  expect(publish).toHaveBeenCalledWith('publisher', 'reviewer', redirectValue());
});
it.each(['same', 'publisher', 'reviewer'])(
  'refuses redirect authority changes: %s',
  async (which) => {
    const publish = vi.fn(async () => null),
      f = setup({ read: async () => null, publish });
    if (which === 'same') f.actors.reviewer = { ...f.actors.reviewer, id: f.actors.publisher.id };
    else {
      const normal = f.require.getMockImplementation()!;
      let calls = 0;
      f.require.mockImplementation(async (c, r) => {
        const actor = await normal(c, r);
        calls++;
        return calls === (which === 'publisher' ? 3 : 4) ? { ...actor, id: 'changed' } : actor;
      });
    }
    await expect(
      f.service.publishRedirects(tokens.publisher, tokens.reviewer, redirectValue()),
    ).rejects.toThrow('forbidden');
    expect(publish).not.toHaveBeenCalled();
  },
);
it('refuses receipt replay by a different current actor', async () => {
  const f = setup(),
    command = f.command('save', { draft: f.draft });
  await f.service.execute(tokens.author, command);
  f.actors.author = { ...f.actors.author, id: 'different' };
  await expect(f.service.execute(tokens.author, command)).rejects.toThrow('conflict');
});
it('captures command input before asynchronous authorization and replays the same current receipt', async () => {
  const f = setup(),
    input = f.command('save', { draft: f.draft }),
    pending = f.service.execute(tokens.author, input);
  f.draft.title = 'Changed later';
  const receipt = await pending;
  expect(f.documents.get(f.id)?.draft.title).toBe('Section width');
  expect(
    await f.service.execute(tokens.author, {
      ...input,
      draft: { ...f.draft, title: 'Section width' },
    }),
  ).toEqual(receipt);
  expect(f.history.get(f.id)).toHaveLength(1);
  await expect(f.service.execute(tokens.author, input)).rejects.toThrow('conflict');
});
it('retains committed state through uncertain publication and retries without creating another revision', async () => {
  const f = setup();
  await f.approve();
  const input = f.command('publish');
  f.enqueue.mockRejectedValueOnce(Error('unavailable'));
  await expect(f.service.execute(tokens.publisher, input)).rejects.toThrow('unavailable');
  expect(f.documents.get(f.id)?.state).toBe('published');
  expect(await f.service.execute(tokens.publisher, input)).toMatchObject({
    state: 'published',
    revision: 4,
  });
  expect(f.history.get(f.id)).toHaveLength(4);
  expect(f.enqueue).toHaveBeenCalledTimes(2);
  expect(f.enqueue.mock.calls[0]).toEqual(f.enqueue.mock.calls[1]);
});
it('settles a committed withdrawal before a concurrent author save can replace its revision', async () => {
  const f = setup();
  await f.approve();
  await f.service.execute(tokens.publisher, f.command('publish'));
  let visible = true,
    release!: () => void,
    started!: () => void;
  const waiting = new Promise<void>((r) => {
      started = r;
    }),
    hold = new Promise<void>((r) => {
      release = r;
    });
  let first = true;
  f.enqueue.mockImplementation(
    async (_actor: string, ref: { revision: number }, action: string) => {
      if (action === 'withdraw' && first) {
        first = false;
        started();
        await hold;
      }
      if (action === 'withdraw') {
        if (f.documents.get(f.id)?.revision !== ref.revision && visible) throw Error('not_found');
        visible = false;
      }
      return true;
    },
  );
  const withdrawal = f.service.execute(tokens.publisher, f.command('withdraw'));
  await waiting;
  const save = f.service.execute(tokens.author, f.command('save', { draft: f.draft }));
  await save;
  release();
  await withdrawal;
  expect(visible).toBe(false);
  expect(f.documents.get(f.id)?.revision).toBe(6);
  expect(f.documents.get(f.id)?.state).toBe('draft');
});
it('preserves an undelivered publication command when its delivery cannot be confirmed', async () => {
  const f = setup();
  await f.approve();
  f.enqueue.mockResolvedValue(false);
  await expect(f.service.execute(tokens.publisher, f.command('publish'))).rejects.toThrow(
    'unavailable',
  );
  const receipt = f.documents.get(f.id)!.command;
  await expect(
    f.service.execute(tokens.author, f.command('save', { draft: f.draft })),
  ).rejects.toThrow('unavailable');
  expect(f.documents.get(f.id)!.command).toEqual(receipt);
  expect(f.documents.get(f.id)!.revision).toBe(4);
});
it('restores only this document history as a higher unapproved draft', async () => {
  const f = setup();
  await f.approve();
  const version = f.history.get(f.id)!.find((v) => v.document.revision === 1)!;
  await expect(
    f.service.execute(tokens.publisher, f.command('rollback', { versionId: randomUUID() })),
  ).rejects.toThrow('not_found');
  f.history
    .get(f.id)!
    .unshift({ id: 'foreign', document: { ...version.document, id: randomUUID() } });
  await expect(
    f.service.execute(tokens.publisher, f.command('rollback', { versionId: 'foreign' })),
  ).rejects.toThrow('not_found');
  expect(
    await f.service.execute(tokens.publisher, f.command('rollback', { versionId: version.id })),
  ).toMatchObject({ revision: 4, state: 'draft' });
  expect(f.documents.get(f.id)?.review).toBeNull();
});
it('refuses changed verified identity before committing a draft', async () => {
  const f = setup();
  f.require
    .mockResolvedValueOnce(f.actors.author)
    .mockResolvedValueOnce({ ...f.actors.author, id: 'changed' });
  await expect(f.save()).rejects.toThrow('forbidden');
  expect(f.documents.size).toBe(0);
});
it('rechecks publishing identity after the native commit and does not dispatch with a changed subject', async () => {
  const f = setup();
  await f.approve();
  f.require
    .mockResolvedValueOnce(f.actors.publisher)
    .mockResolvedValueOnce(f.actors.publisher)
    .mockResolvedValueOnce({ ...f.actors.publisher, id: 'changed' });
  const input = f.command('publish');
  await expect(f.service.execute(tokens.publisher, input)).rejects.toThrow('forbidden');
  expect(f.enqueue).not.toHaveBeenCalled();
  expect(await f.service.execute(tokens.publisher, input)).toMatchObject({ revision: 4 });
});
it('withdraws through the same publication boundary as a higher nonpublic revision', async () => {
  const f = setup();
  await f.approve();
  await f.service.execute(tokens.publisher, f.command('publish'));
  expect(await f.service.execute(tokens.publisher, f.command('withdraw'))).toMatchObject({
    state: 'withdrawn',
    revision: 5,
  });
  expect(f.enqueue.mock.calls.at(-1)).toMatchObject([
    'publisher',
    { id: f.id, collection: 'glossary-terms', revision: 5 },
    'withdraw',
  ]);
});
it('publishes article identities with the articles collection', async () => {
  const f = setup();
  f.draft.kind = 'article';
  f.draft.path = '/learn/section-width';
  await f.approve();
  await f.service.execute(tokens.publisher, f.command('publish'));
  expect(f.enqueue.mock.calls[0]).toMatchObject([
    'publisher',
    { collection: 'articles' },
    'publish',
  ]);
});
it('strict wire parsing rejects forged actor claims and extra command fields', () => {
  const f = setup();
  expect(
    editorialCommandSchema.safeParse({
      ...f.command('save', { draft: f.draft }),
      actorId: 'publisher',
    }).success,
  ).toBe(false);
  expect(
    editorialCommandSchema.safeParse({
      ...f.command('save', { draft: f.draft }),
      draft: { ...f.draft, reviewer: 'forged' },
    }).success,
  ).toBe(false);
});
it.each(['save', 'rollback', 'withdraw'] as const)(
  'recovers an expired undelivered publication through %s',
  async (action) => {
    const f = setup();
    await f.approve();
    f.enqueue.mockRejectedValueOnce(Error('unavailable'));
    await expect(f.service.execute(tokens.publisher, f.command('publish'))).rejects.toThrow(
      'unavailable',
    );
    f.now.mockReturnValue('2027-01-02T12:00:00.000Z');
    f.enqueue.mockClear();
    const version = f.history.get(f.id)!.find((v) => v.document.revision === 1)!;
    const input = f.command(
      action,
      action === 'save'
        ? { draft: f.draft }
        : action === 'rollback'
          ? { versionId: version.id }
          : {},
    );
    expect(
      await f.service.execute(action === 'save' ? tokens.author : tokens.publisher, input),
    ).toMatchObject({ revision: 5, state: action === 'withdraw' ? 'withdrawn' : 'draft' });
    expect(f.enqueue).toHaveBeenCalledTimes(action === 'withdraw' ? 1 : 0);
  },
);
it.each(['save', 'rollback'] as const)(
  'withdraws an older live projection while its newer draft comes from %s',
  async (action) => {
    const f = setup();
    await f.approve();
    await f.service.execute(tokens.publisher, f.command('publish'));
    const version = f.history.get(f.id)!.find((v) => v.document.revision === 1)!;
    await f.service.execute(
      action === 'save' ? tokens.author : tokens.publisher,
      f.command(action, action === 'save' ? { draft: f.draft } : { versionId: version.id }),
    );
    expect(f.documents.get(f.id)?.state).toBe('draft');
    expect(await f.service.execute(tokens.publisher, f.command('withdraw'))).toMatchObject({
      revision: 6,
      state: 'withdrawn',
    });
    expect(f.enqueue.mock.calls.at(-1)).toMatchObject(['publisher', { revision: 6 }, 'withdraw']);
  },
);
it.each([
  ['forged host', { headers: { host: 'evil.invalid' } }, 403],
  [
    'cross-origin write',
    {
      method: 'POST',
      headers: { origin: 'http://evil.invalid', 'content-type': 'application/json' },
      body: '{}',
    },
    403,
  ],
  [
    'missing write origin',
    { method: 'POST', headers: { origin: '', 'content-type': 'application/json' }, body: '{}' },
    403,
  ],
  ['unsupported verb', { method: 'DELETE' }, 405],
  ['malformed bearer', { headers: { authorization: 'Bearer invalid' } }, 401],
  ['invalid credential', { headers: { authorization: 'Bearer ' + 'z'.repeat(43) } }, 401],
  ['bad JSON', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }, 400],
  [
    'oversized JSON',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(65537) },
    400,
  ],
  [
    'wrong content type',
    { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' },
    400,
  ],
] as const)('refuses %s at the local editorial HTTP boundary', async (_name, options, status) => {
  const f = setup();
  expect((await f.http(f.request('', options))).status).toBe(status);
});
it.each(['?id=x&id=y', '?unknown=1', '?identity=other', '?identity=1&id=x'])(
  'refuses ambiguous or unsupported query %s',
  async (query) => {
    const f = setup();
    expect((await f.http(f.request(query))).status).toBe(400);
  },
);
it('serves authenticated read/list/identity and preserves unknown effect failures as retryable responses', async () => {
  const f = setup();
  await f.save();
  for (const query of ['', '?identity=1', '?id=' + f.id])
    expect((await f.http(f.request(query))).status).toBe(200);
  f.require.mockRejectedValueOnce(Error('database unavailable'));
  expect((await f.http(f.request())).status).toBe(503);
  const bad = f.command('save', { draft: { ...f.draft, title: '<script>' } });
  expect(
    (
      await f.http(
        f.request('', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(bad),
        }),
      )
    ).status,
  ).toBe(400);
});
