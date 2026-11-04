import './browser-runtime.ts';
import { z } from 'zod';
const text = (n: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(n)
    .refine((value) =>
      [...value].every((char) => char.charCodeAt(0) >= 32 && char !== '<' && char !== '>'),
    );
const path = z
  .string()
  .max(500)
  .regex(/^\/(learn|guides|glossary)\/[a-z0-9]+(-[a-z0-9]+)*$/);
const reference = z.strictObject({
  title: text(200),
  url: z
    .url()
    .max(2048)
    .refine((s) => {
      const u = new URL(s);
      return (
        u.protocol === 'https:' &&
        !u.username &&
        !u.password &&
        !u.port &&
        !u.hash &&
        !u.search &&
        !u.hostname.includes(':') &&
        !/^([0-9.]+|localhost|.*\.localhost)$/.test(u.hostname)
      );
    }),
});
export const editorialDraftSchema = z.strictObject({
  key: text(200),
  kind: z.enum(['article', 'glossary']),
  path,
  title: text(200),
  summary: text(1000),
  paragraphs: z.array(text(2000)).min(1).max(100),
  topics: z
    .array(
      z.enum([
        'size',
        'ratings',
        'winter',
        'wet',
        'types',
        'maintenance',
        'buying',
        'warranty',
        'noise',
        'efficiency',
        'heat',
        'off_road',
        'ev',
        'run_flat',
      ]),
    )
    .min(1)
    .max(14),
  related: z.array(path).max(12),
  references: z.array(reference).min(1).max(8),
  questions: z
    .array(
      z.strictObject({
        key: z.number().int().min(1).max(14),
        question: text(500),
        goodAnswer: text(1000),
        redFlags: z.array(text(500)).min(1).max(5),
        glossaryPath: path,
      }),
    )
    .length(14)
    .optional(),
});
export const editorialCommandSchema = z.strictObject({
  id: z.uuid(),
  expectedRevision: z.number().int().min(0).max(2147483646),
  key: z.string().regex(/^[A-Za-z0-9_-]{16,100}$/),
  action: z.enum(['save', 'submit', 'approve', 'reject', 'publish', 'withdraw', 'rollback']),
  draft: editorialDraftSchema.optional(),
  expiresAt: z.iso.datetime().optional(),
  versionId: z.uuid().optional(),
});
export type EditorialDraftInput = z.infer<typeof editorialDraftSchema>;
export type EditorialCommandInput = z.infer<typeof editorialCommandSchema>;
export interface EditorialView {
  id: string;
  revision: number;
  state: string;
  draft: EditorialDraftInput;
  author: { id: string; name: string };
  review: { actor: { id: string; name: string }; at: string; expiresAt: string } | null;
  modifiedAt: string;
}
export interface EditorialRead {
  document: EditorialView | null;
  versions: readonly { id: string; revision: number; state: string; modifiedAt: string }[];
}
export type EditorialListItem = Pick<EditorialView, 'id' | 'revision' | 'state'> & {
  draft: Pick<EditorialDraftInput, 'key' | 'kind' | 'path' | 'title'>;
};
export interface EditorialIdentity {
  id: string;
  name: string;
  roles: readonly ('author' | 'reviewer' | 'publisher')[];
}
export const redirectEditorCommandSchema = z.strictObject({
  action: z.literal('redirects'),
  reviewerCredential: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  revision: z.number().int().min(1).max(2147483647),
  issuedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  csv: z.string().max(60000),
});
export type RedirectEditorCommand = z.infer<typeof redirectEditorCommandSchema>;
export interface RedirectEditorState {
  current: {
    revision: number;
    issuedAt: string;
    expiresAt: string;
    rules: readonly {
      source: string;
      target: string | null;
      code: 301 | 302 | 410;
      mode?: 'exact' | 'slug';
    }[];
  } | null;
  serverTime: string;
}
export function createEditorialClient(
  origin: string,
  credential: string,
  send: typeof fetch = fetch,
) {
  const u = new URL(origin);
  if (
    u.protocol !== 'http:' ||
    u.hostname !== '127.0.0.1' ||
    !u.port ||
    u.username ||
    u.password ||
    u.pathname !== '/' ||
    u.search ||
    u.hash ||
    !/^[A-Za-z0-9_-]{43}$/.test(credential)
  )
    throw Error('Local editorial connection refused');
  async function call<T>(
    query: string,
    command?: EditorialCommandInput | RedirectEditorCommand,
  ): Promise<T> {
    const response = await send(u.origin + '/local-editorial/api' + query, {
      method: command ? 'POST' : 'GET',
      headers: {
        authorization: 'Bearer ' + credential,
        ...(command ? { 'content-type': 'application/json' } : {}),
      },
      ...(command ? { body: JSON.stringify(command) } : {}),
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    const raw = await response.text();
    if (raw.length > 262144) throw Error('Editorial response exceeded limit');
    const result = JSON.parse(raw) as { data: T; error?: string };
    if (!response.ok) throw Error(result.error ?? 'Editorial request refused');
    return result.data;
  }
  return {
    redirects: () => call<RedirectEditorState>('?redirects=1'),
    publishRedirects: (command: RedirectEditorCommand) => {
      const input = redirectEditorCommandSchema.safeParse(command);
      if (!input.success) return Promise.reject(Error('invalid_input'));
      return call<{ revision: number }>('', input.data);
    },
    identity: () => call<EditorialIdentity>('?identity=1'),
    list: () => call<EditorialListItem[]>(''),
    read: (id: string) => call<EditorialRead>('?id=' + encodeURIComponent(z.uuid().parse(id))),
    execute: (command: EditorialCommandInput) => {
      const input = editorialCommandSchema.safeParse(command);
      if (!input.success) return Promise.reject(Error('invalid_input'));
      return call<{ id: string; revision: number; state: string }>('', input.data);
    },
  };
}
