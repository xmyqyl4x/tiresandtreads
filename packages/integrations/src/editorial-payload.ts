import type { Config, Payload, PayloadRequest } from 'payload';
import { sql } from '@payloadcms/db-postgres';
import type {
  EditorialStore,
  EditorialTransaction,
} from '../../application/src/ports/editorial.ts';
import { validateEditorialDraft, type EditorialDocument } from '../../domain/src/editorial.ts';

// A private object-identity capability for the server-only Local API, never a JSON/header claim.
// The caller supplies a migrated, narrowly scoped authoring connection; no provisioning occurs here.
export function editorialPayloadAccess(base: Config) {
  const seal = Object.freeze({}),
    names = ['articles', 'glossary-terms', 'editorial-reviews'];
  const config: Config = {
    ...base,
    admin: { ...base.admin, disable: true },
    graphQL: { disable: true },
    collections: (base.collections ?? []).map((c) =>
      names.includes(c.slug)
        ? {
            ...c,
            // This headless workbench uses its own transaction/revision protocol. It must
            // not delete another interface's Payload admin edit locks while saving.
            lockDocuments: false,
            access: {
              ...c.access,
              read: ({ req }) => req.context.editorialAccess === seal,
              create: ({ req }) => req.context.editorialAccess === seal,
              update: ({ req }) => req.context.editorialAccess === seal,
              readVersions: ({ req }) => req.context.editorialAccess === seal,
              delete: () => false,
            },
          }
        : c,
    ),
  };
  const req = (transactionID?: string | number): Partial<PayloadRequest> => ({
    context: { editorialAccess: seal },
    ...(transactionID === undefined ? {} : { transactionID }),
  });
  function document(raw: Record<string, unknown>, kind: 'article' | 'glossary'): EditorialDocument {
    const body = (kind === 'article' ? raw.body : raw.definition) as
        Record<string, unknown> | undefined,
      meta = body?.editorial as Omit<EditorialDocument, 'id' | 'draft' | 'revision'> | undefined;
    if (!body || !meta || typeof raw.id !== 'string' || !Number.isSafeInteger(raw.revision))
      throw Error('invalid_editorial_record');
    const draft = validateEditorialDraft({
      key: raw.contentKey,
      kind,
      path: body.path,
      title: raw.title,
      summary: body.summary,
      paragraphs: body.paragraphs,
      topics: body.topics,
      related: body.related,
      references: body.references,
      ...(body.questions === undefined ? {} : { questions: body.questions }),
    });
    return structuredClone({ ...meta, id: raw.id, revision: raw.revision as number, draft });
  }
  function store(payload: Payload): EditorialStore {
    const sessions = payload.db.sessions;
    if (payload.db.name !== 'postgres' || !sessions || !payload.db.allowIDOnCreate)
      throw Error('PostgreSQL stable-ID editorial adapter required');
    function isExecutor(
      value: unknown,
    ): value is { execute(statement: ReturnType<typeof sql.raw>): Promise<unknown> } {
      return (
        typeof value === 'object' &&
        value !== null &&
        'execute' in value &&
        typeof value.execute === 'function'
      );
    }
    async function find(id: string, request: Partial<PayloadRequest>) {
      for (const collection of ['articles', 'glossary-terms'] as const) {
        const found = await payload.find({
          collection,
          where: { id: { equals: id } },
          limit: 1,
          pagination: false,
          depth: 0,
          overrideAccess: false,
          req: request,
        });
        if (found.docs[0]) return { collection, raw: found.docs[0] };
      }
      return null;
    }
    return {
      async list() {
        const groups = await Promise.all(
          (['articles', 'glossary-terms'] as const).map(async (collection) => {
            const rows = await payload.find({
              collection,
              limit: 100,
              pagination: false,
              depth: 0,
              sort: 'contentKey',
              overrideAccess: false,
              req: req(),
            });
            return rows.docs
              .filter(
                (r) =>
                  (
                    (collection === 'articles' ? r.body : r.definition) as
                      Record<string, unknown> | undefined
                  )?.editorial,
              )
              .map((r) => document(r, collection === 'articles' ? 'article' : 'glossary'));
          }),
        );
        return groups.flat().sort((a, b) => a.draft.key.localeCompare(b.draft.key));
      },
      async atomic<T>(id: string, work: (tx: EditorialTransaction) => Promise<T>) {
        if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id))
          throw Error('invalid_input');
        const transactionID = await payload.db.beginTransaction();
        if (transactionID === null) throw Error('editorial_transaction_required');
        try {
          const session = sessions[String(transactionID)];
          if (!session || !isExecutor(session.db)) throw Error('editorial_transaction_required');
          await session.db.execute(sql.raw("SET LOCAL lock_timeout='2000ms'"));
          await session.db.execute(sql.raw("SET LOCAL statement_timeout='5000ms'"));
          await session.db.execute(
            sql.join(
              [
                sql.raw('SELECT pg_advisory_xact_lock(hashtextextended('),
                sql.param('tt-editorial:' + id),
                sql.raw(',0))'),
              ],
              sql.raw(''),
            ),
          );
          const request = req(transactionID);
          const tx: EditorialTransaction = {
            async read() {
              const row = await find(id, request);
              return row
                ? document(row.raw, row.collection === 'articles' ? 'article' : 'glossary')
                : null;
            },
            async save(value) {
              if (value.id !== id) throw Error('invalid_input');
              const old = await find(id, request),
                collection = value.draft.kind === 'article' ? 'articles' : 'glossary-terms',
                { draft, id: ignoredId, revision, ...meta } = value;
              void ignoredId;
              const body = {
                path: draft.path,
                canonical: draft.path,
                summary: draft.summary,
                paragraphs: draft.paragraphs,
                topics: draft.topics,
                related: draft.related,
                references: draft.references,
                author: value.author.name,
                reviewer: value.review?.actor.name ?? 'Review pending',
                ...(draft.questions === undefined ? {} : { questions: draft.questions }),
                editorial: meta,
              };
              const data = {
                contentKey: draft.key,
                locale: 'en-US',
                market: 'US',
                schemaVersion: 1,
                revision,
                title: draft.title,
                reviewStatus:
                  value.state === 'published'
                    ? 'approved'
                    : value.state === 'withdrawn'
                      ? 'draft'
                      : value.state,
                sourceUrl: draft.references[0]!.url,
                reviewer: value.review?.actor.cmsId ?? null,
                reviewedAt: value.review?.at ?? null,
                expiresAt: value.review?.expiresAt ?? null,
                _status: value.state === 'published' ? 'published' : 'draft',
                [collection === 'articles' ? 'body' : 'definition']: body,
              };
              if (old)
                await payload.update({
                  collection,
                  id,
                  data,
                  draft: false,
                  depth: 0,
                  overrideAccess: false,
                  req: request,
                });
              else
                await payload.create({
                  collection,
                  data: { id, ...data },
                  draft: false,
                  depth: 0,
                  overrideAccess: false,
                  req: request,
                });
              const audit =
                value.review?.actor ??
                (value.command.action === 'reject' ? value.command.actor : null);
              if (audit)
                await payload.create({
                  collection: 'editorial-reviews',
                  data: {
                    collectionSlug: collection,
                    documentId: id,
                    contentRevision: revision,
                    reviewer: audit.cmsId,
                    result: value.command.action === 'reject' ? 'rejected' : 'approved',
                    reasonCode: 'local_editorial_review',
                    reviewedAt: value.review?.at ?? value.modifiedAt,
                  },
                  overrideAccess: false,
                  req: request,
                });
            },
            async versions() {
              const row = await find(id, request);
              if (!row) return [];
              const history = await payload.findVersions({
                collection: row.collection,
                where: { parent: { equals: id } },
                limit: 20,
                depth: 0,
                sort: '-createdAt',
                overrideAccess: false,
                req: request,
              });
              return history.docs.map((v) => ({
                id: String(v.id),
                document: document(
                  { ...v.version, id },
                  row.collection === 'articles' ? 'article' : 'glossary',
                ),
              }));
            },
          };
          const result = await work(tx);
          await payload.db.commitTransaction(transactionID);
          return result;
        } catch (e) {
          await payload.db.rollbackTransaction(transactionID);
          throw e;
        }
      },
    };
  }
  return { config, store };
}
