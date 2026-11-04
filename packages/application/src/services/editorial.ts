import {
  transitionEditorial,
  editorialRole,
  type EditorialCommand,
} from '../../../domain/src/editorial.ts';
import type { EditorialStore, EditorialAuthorization } from '../ports/editorial.ts';
import { redirectSnapshot } from './content.ts';
import type { RedirectSnapshot } from '../ports/content-services.ts';
export function createEditorialService(d: {
  readonly store: EditorialStore;
  readonly authorization: EditorialAuthorization;
  readonly digest: (input: unknown) => string;
  readonly now: () => string;
  readonly redirects?: {
    readonly read: (actor: string) => Promise<RedirectSnapshot | null>;
    readonly publish: (
      actor: string,
      reviewer: string,
      value: RedirectSnapshot,
    ) => Promise<unknown>;
  };
  // True means the immutable CMS work receipt confirms its application projection was applied.
  // Merely queuing work is insufficient: the current CMS revision must remain available until then.
  readonly deliver: (
    actor: string,
    document: { id: string; collection: 'articles' | 'glossary-terms'; revision: number },
    action: 'publish' | 'withdraw',
  ) => Promise<boolean>;
}) {
  const receipt = (x: { id: string; revision: number; state: string }) => ({
    id: x.id,
    revision: x.revision,
    state: x.state,
  });
  return {
    async redirects(credential: string) {
      const actor = await d.authorization.require(credential, 'publisher');
      if (!d.redirects) throw Error('unavailable');
      return { current: await d.redirects.read(actor.id), serverTime: d.now() };
    },
    async publishRedirects(
      credential: string,
      reviewerCredential: string,
      input: RedirectSnapshot,
    ) {
      const value = redirectSnapshot(structuredClone(input)),
        actor = await d.authorization.require(credential, 'publisher'),
        reviewer = await d.authorization.require(reviewerCredential, 'reviewer');
      if (actor.id === reviewer.id) throw Error('forbidden');
      if (!d.redirects) throw Error('unavailable');
      const fresh = await d.authorization.require(credential, 'publisher'),
        freshReviewer = await d.authorization.require(reviewerCredential, 'reviewer');
      if (fresh.id !== actor.id || freshReviewer.id !== reviewer.id) throw Error('forbidden');
      await d.redirects.publish(actor.id, reviewer.id, value);
      return { revision: value.revision };
    },
    async identity(credential: string) {
      const actor = await d.authorization.require(credential, 'read');
      return { id: actor.id, name: actor.name, roles: [...actor.roles] };
    },
    async list(credential: string) {
      await d.authorization.require(credential, 'read');
      return (await d.store.list()).map((x) => ({
        id: x.id,
        revision: x.revision,
        state: x.state,
        draft: { key: x.draft.key, kind: x.draft.kind, path: x.draft.path, title: x.draft.title },
      }));
    },
    async read(credential: string, id: string) {
      await d.authorization.require(credential, 'read');
      return d.store.atomic(id, async (tx) => ({
        document: await tx.read(),
        versions: (await tx.versions()).map((v) => ({
          id: v.id,
          revision: v.document.revision,
          state: v.document.state,
          modifiedAt: v.document.modifiedAt,
        })),
      }));
    },
    async execute(credential: string, input: EditorialCommand) {
      const command = structuredClone(input),
        role = editorialRole(command.action),
        actor = await d.authorization.require(credential, role),
        digest = d.digest(command);
      const document = await d.store.atomic(command.id, async (tx) => {
        const current = await tx.read();
        if (current?.command.key === command.key) {
          if (current.command.digest !== digest || current.command.actor.id !== actor.id)
            throw Error('conflict');
          return current;
        }
        // This lock covers every headless mutation. Drain the previous publication/withdrawal
        // before replacing its only current-source revision or unchanged-retry command receipt.
        if (
          current &&
          (current.command.action === 'publish' || current.command.action === 'withdraw')
        ) {
          const delivered = await d.deliver(
            current.command.actor.id,
            {
              id: current.id,
              collection: current.draft.kind === 'glossary' ? 'glossary-terms' : 'articles',
              revision: current.revision,
            },
            current.command.action,
          );
          if (delivered !== true) throw Error('unavailable');
        }
        let applied = command;
        if (command.action === 'rollback') {
          const version = (await tx.versions()).find(
            (v) => v.id === command.versionId && v.document.id === command.id,
          );
          if (!version) throw Error('not_found');
          applied = { ...command, draft: version.document.draft };
        }
        const fresh = await d.authorization.require(credential, role);
        if (fresh.id !== actor.id) throw Error('forbidden');
        const next = transitionEditorial(current, fresh, applied, digest, d.now());
        await tx.save(next);
        return next;
      });
      if (command.action === 'publish' || command.action === 'withdraw') {
        const fresh = await d.authorization.require(credential, role);
        if (fresh.id !== actor.id) throw Error('forbidden');
        const delivered = await d.deliver(
          fresh.id,
          {
            id: document.id,
            collection: document.draft.kind === 'glossary' ? 'glossary-terms' : 'articles',
            revision: document.revision,
          },
          command.action,
        );
        if (delivered !== true) throw Error('unavailable');
      }
      return receipt(document);
    },
  };
}
