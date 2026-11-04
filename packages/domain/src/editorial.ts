import {
  plain,
  publicPath,
  contentTopics,
  type Topic,
  type ChecklistItem,
  checklist,
} from './public-policy.ts';
import { instant } from './values/core.ts';
import { instantMilliseconds } from './values/time.ts';

export type EditorialRole = 'author' | 'reviewer' | 'publisher';
export interface EditorialActor {
  readonly id: string;
  readonly cmsId: string;
  readonly name: string;
  readonly roles: readonly EditorialRole[];
}
export interface EditorialReference {
  readonly title: string;
  readonly url: string;
}
export interface EditorialDraft {
  readonly key: string;
  readonly kind: 'article' | 'glossary';
  readonly path: string;
  readonly title: string;
  readonly summary: string;
  readonly paragraphs: readonly string[];
  readonly topics: readonly Topic[];
  readonly related: readonly string[];
  readonly references: readonly EditorialReference[];
  readonly questions?: readonly ChecklistItem[];
}
export type EditorialState =
  'draft' | 'review' | 'approved' | 'rejected' | 'published' | 'withdrawn';
export interface EditorialDocument {
  readonly id: string;
  readonly revision: number;
  readonly state: EditorialState;
  readonly draft: EditorialDraft;
  readonly author: EditorialActor;
  readonly review: {
    readonly actor: EditorialActor;
    readonly at: string;
    readonly expiresAt: string;
  } | null;
  readonly modifiedAt: string;
  readonly command: {
    readonly key: string;
    readonly digest: string;
    readonly action: string;
    readonly actor: EditorialActor;
  };
}
export interface EditorialCommand {
  readonly id: string;
  readonly expectedRevision: number;
  readonly key: string;
  readonly action: string;
  readonly draft?: unknown;
  readonly expiresAt?: string | undefined;
  readonly versionId?: string | undefined;
}
function demand(value: unknown, code = 'invalid_input'): asserts value {
  if (!value) throw Error(code);
}
function milliseconds(value: string) {
  const result = instant(value);
  demand(result.ok);
  return instantMilliseconds(result.value);
}
export function referenceUrl(value: string) {
  const u = new URL(value);
  demand(
    value.length <= 2048 &&
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      !u.port &&
      !u.hash &&
      !u.search &&
      !u.hostname.includes(':') &&
      !/^([0-9.]+|localhost|.*\.localhost)$/.test(u.hostname),
  );
  return u.href;
}
export function validateEditorialDraft(input: unknown): EditorialDraft {
  demand(input && typeof input === 'object' && !Array.isArray(input));
  const d = input as EditorialDraft;
  demand(
    Object.keys(d)
      .filter((k) => k !== 'questions')
      .sort()
      .join(',') === 'key,kind,paragraphs,path,references,related,summary,title,topics',
  );
  plain(d.key, 200);
  plain(d.title, 200);
  plain(d.summary, 1000);
  publicPath(d.path);
  demand(d.kind === 'article' || (d.kind === 'glossary' && d.path.startsWith('/glossary/')));
  demand(Array.isArray(d.paragraphs) && d.paragraphs.length > 0 && d.paragraphs.length <= 100);
  d.paragraphs.forEach((p) => plain(p, 2000));
  demand(
    Array.isArray(d.topics) &&
      d.topics.length > 0 &&
      d.topics.length <= 14 &&
      new Set(d.topics).size === d.topics.length &&
      d.topics.every((t) => contentTopics.includes(t)),
  );
  demand(
    Array.isArray(d.related) &&
      d.related.length <= 12 &&
      new Set(d.related).size === d.related.length,
  );
  d.related.forEach(publicPath);
  demand(Array.isArray(d.references) && d.references.length > 0 && d.references.length <= 8);
  d.references.forEach((r) => {
    demand(Object.keys(r).sort().join(',') === 'title,url');
    plain(r.title, 200);
    referenceUrl(r.url);
  });
  if (d.questions !== undefined) {
    demand(d.path === '/guides/before-you-buy');
    checklist(d.questions);
  }
  demand(new TextEncoder().encode(JSON.stringify(d)).byteLength <= 60000);
  return structuredClone(d);
}
export function editorialRole(action: string): EditorialRole {
  if (['save', 'submit'].includes(action)) return 'author';
  if (['approve', 'reject'].includes(action)) return 'reviewer';
  demand(['publish', 'withdraw', 'rollback'].includes(action));
  return 'publisher';
}
export function transitionEditorial(
  current: EditorialDocument | null,
  actor: EditorialActor,
  command: EditorialCommand,
  digest: string,
  at: string,
): EditorialDocument {
  demand(actor.roles.includes(editorialRole(command.action)), 'forbidden');
  demand(
    instant(at).ok &&
      /^[a-f0-9]{64}$/.test(digest) &&
      command.id.length > 0 &&
      command.id.length <= 100 &&
      /^[A-Za-z0-9_-]{4,100}$/.test(command.key),
  );
  demand(
    Number.isSafeInteger(command.expectedRevision) &&
      command.expectedRevision >= 0 &&
      command.expectedRevision < 2147483647,
  );
  demand(
    (current?.revision ?? 0) === command.expectedRevision &&
      (!current || current.id === command.id),
    'conflict',
  );
  demand(current || command.action === 'save', 'not_found');
  demand(!current || at >= current.modifiedAt, 'conflict');
  const next: { -readonly [K in keyof EditorialDocument]: EditorialDocument[K] } = current
    ? structuredClone(current)
    : {
        id: command.id,
        revision: 0,
        state: 'draft',
        draft: validateEditorialDraft(command.draft),
        author: structuredClone(actor),
        review: null,
        modifiedAt: at,
        command: { key: '', digest, action: '', actor: structuredClone(actor) },
      };
  if (command.action === 'save' || command.action === 'rollback') {
    next.draft = validateEditorialDraft(command.draft);
    next.author = structuredClone(actor);
    next.review = null;
    next.state = 'draft';
  } else {
    demand(current, 'not_found');
    if (command.action === 'submit') {
      demand(['draft', 'rejected'].includes(current.state), 'conflict');
      demand(actor.id === current.author.id, 'forbidden');
      next.state = 'review';
      next.review = null;
    } else if (command.action === 'approve' || command.action === 'reject') {
      demand(current.state === 'review', 'conflict');
      demand(actor.id !== current.author.id, 'forbidden');
      if (command.action === 'approve') {
        demand(
          command.expiresAt &&
            instant(command.expiresAt).ok &&
            command.expiresAt > at &&
            milliseconds(command.expiresAt) - milliseconds(at) <= 366 * 86400000,
        );
        next.review = { actor: structuredClone(actor), at, expiresAt: command.expiresAt };
        next.state = 'approved';
      } else {
        next.review = null;
        next.state = 'rejected';
      }
    } else if (command.action === 'publish') {
      demand(current.state === 'approved', 'conflict');
      demand(
        current.review && current.review.expiresAt > at && actor.id !== current.author.id,
        'forbidden',
      );
      next.state = 'published';
    } else {
      demand(current.state === 'published', 'conflict');
      next.review = null;
      next.state = 'withdrawn';
    }
  }
  demand(
    next.revision === 0 ||
      (next.draft.key === current!.draft.key &&
        next.draft.kind === current!.draft.kind &&
        next.draft.path === current!.draft.path),
    'conflict',
  );
  next.revision++;
  next.modifiedAt = at;
  next.command = {
    key: command.key,
    digest,
    action: command.action,
    actor: structuredClone(actor),
  };
  return structuredClone(next);
}
