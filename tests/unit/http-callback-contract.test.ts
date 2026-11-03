import { it, expect } from 'vitest';
import { localApiDocument } from '../../scripts/contracts/local-api.mjs';
type Operation = {
  parameters: { name: string; required: boolean }[];
  security?: unknown;
  requestBody?: { content: Record<string, unknown> };
  responses: Record<string, { content?: unknown; headers?: unknown }>;
};
it('documents the actual 64 operations with signed raw callbacks and the RFC8058 media type', () => {
  const doc = localApiDocument();
  expect(Object.values(doc.paths).flatMap(Object.values)).toHaveLength(64);
  const mail = doc.paths['/api/v1/webhooks/resend']!.post as Operation;
  expect(mail.parameters).toEqual(
    expect.arrayContaining(
      ['svix-id', 'svix-timestamp', 'svix-signature'].map((name) =>
        expect.objectContaining({ name, required: true }),
      ),
    ),
  );
  expect(mail.parameters.some((x) => x.name === 'Origin')).toBe(false);
  expect(mail.responses).toHaveProperty('202');
  const unsubscribe = doc.paths['/email/unsubscribe/{token}']!.post as Operation;
  expect(unsubscribe.requestBody!.content).toHaveProperty('application/x-www-form-urlencoded');
  expect(unsubscribe.security).toBeUndefined();
});
it('distinguishes path proofs, empty consent refusals and redirects from generic success envelopes', () => {
  const doc = localApiDocument(),
    preferences = doc.paths['/preferences/{token}']!.get as Operation;
  expect(preferences.parameters).toContainEqual(
    expect.objectContaining({ name: 'token', required: true }),
  );
  expect(preferences.security).toBeUndefined();
  const collect = doc.paths['/api/v1/collect']!.post as Operation;
  expect(collect.responses['204']).not.toHaveProperty('content');
  expect(collect.responses).toHaveProperty('202');
  const redirect = doc.paths['/go/{linkId}']!.get as Operation;
  expect(redirect.responses['302']).toHaveProperty('headers');
  expect(redirect.responses['302']).not.toHaveProperty('content');
});
