import type { createContentServices } from '../../application/src/services/content.ts';
import { id } from '../../domain/src/values/core.ts';
// Internal SQL-only publication broker. Its affirmative result is bound to the exact durable work
// receipt, not an enqueue acknowledgement or an assumption about the current public page.
export function createEditorialDelivery(
  content: Pick<
    ReturnType<typeof createContentServices>,
    'publicationDelivered' | 'enqueue' | 'dispatch'
  >,
) {
  return async (
    actor: string,
    document: { id: string; collection: 'articles' | 'glossary-terms'; revision: number },
    action: 'publish' | 'withdraw',
  ) => {
    const publisher = id('staff', actor),
      doc = id('cms_document', document.id);
    if (!publisher.ok || !doc.ok) throw Error('invalid_input');
    const ref = { ...document, id: doc.value };
    const confirmed = async () => {
      const result = await content.publicationDelivered(ref, publisher.value, action);
      if (!result.ok) throw Error(result.error.code);
      return result.value;
    };
    if (await confirmed()) return true;
    const queued = await content.enqueue(publisher.value, ref, action);
    if (!queued.ok) throw Error(queued.error.code);
    const result = await content.dispatch(queued.value.id);
    if (!result.ok) throw Error(result.error.code);
    return confirmed();
  };
}
