import { createAssessmentClient, type ReferencePage } from '@tt/contracts/assessment';
import type { AssessmentRequest } from '../../../../packages/contracts/src/report-inputs.ts';
import { ownerSession } from '../owner-session.ts';
export function usableReference(page: ReferencePage, now = Date.now()) {
  const sources = [
    ...(page.source?.components.map((c) => c.source) ?? []),
    ...page.items.map((i) => i.source),
  ];
  return (
    page.coverage === 'available' &&
    !!page.source &&
    sources.length > 0 &&
    sources.every(
      (s) =>
        s.rights.display &&
        s.rights.api &&
        ((s.expiresAt.state === 'unknown' && s.expiresAt.reason === 'not_applicable') ||
          (s.expiresAt.state === 'known' &&
            !!s.expiresAt.value &&
            Number.isFinite(Date.parse(s.expiresAt.value)) &&
            Date.parse(s.expiresAt.value) > now)),
    )
  );
}
export function assessmentController(
  origin: string,
  send: typeof fetch = fetch,
  key = () => crypto.randomUUID(),
) {
  const bounded: typeof fetch = (url, options) =>
    send(url, { ...options, signal: options?.signal ?? AbortSignal.timeout(15000) });
  const client = createAssessmentClient(origin, bounded);
  let last: { body: string; key: string } | undefined,
    pending: Promise<Awaited<ReturnType<typeof client.create>>> | undefined;
  return {
    lookup: client.lookup,
    submit(input: AssessmentRequest) {
      const body = JSON.stringify(input);
      if (pending)
        return last?.body === body
          ? pending
          : Promise.reject(Error('Submission already in progress'));
      if (last?.body !== body) last = { body, key: key() };
      const requestKey = last!.key;
      pending = (async () =>
        client.create(input, (await ownerSession(origin, bounded)).csrf, requestKey))().finally(
        () => {
          pending = undefined;
        },
      );
      return pending;
    },
  };
}
