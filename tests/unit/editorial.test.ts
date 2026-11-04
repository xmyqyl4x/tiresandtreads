import { it, expect } from 'vitest';
import {
  transitionEditorial,
  validateEditorialDraft,
} from '../../packages/domain/src/editorial.ts';
import type { EditorialActor, EditorialDocument } from '../../packages/domain/src/editorial.ts';

const at = '2026-11-03T12:00:00.000Z';
const author: EditorialActor = {
  id: 'author',
  cmsId: 'cms-author',
  name: 'Local author',
  roles: ['author'],
};
const reviewer: EditorialActor = {
  id: 'reviewer',
  cmsId: 'cms-reviewer',
  name: 'Local reviewer',
  roles: ['reviewer'],
};
const publisher: EditorialActor = {
  id: 'publisher',
  cmsId: 'cms-publisher',
  name: 'Local publisher',
  roles: ['publisher'],
};
const draft = () => ({
  key: 'test-width',
  kind: 'glossary' as const,
  path: '/glossary/width',
  title: 'Section width',
  summary: 'Understand a width marking.',
  paragraphs: ['A descriptive size component.'],
  topics: ['size' as const],
  related: [],
  references: [{ title: 'NHTSA tire guidance', url: 'https://www.nhtsa.gov/vehicle-safety/tires' }],
});
function step(
  doc: EditorialDocument | null,
  actor: EditorialActor,
  action: string,
  extra: Record<string, unknown> = {},
) {
  return transitionEditorial(
    doc,
    actor,
    {
      id: 'doc',
      expectedRevision: doc?.revision ?? 0,
      key: 'command-' + (doc?.revision ?? 0),
      action,
      ...extra,
    },
    'a'.repeat(64),
    at,
  );
}
const saved = () => step(null, author, 'save', { draft: draft() });
it('creates a versioned draft with no invented review identity', () => {
  const doc = saved();
  expect(doc).toMatchObject({ revision: 1, state: 'draft', author, review: null });
  expect(doc.draft).toEqual(draft());
});
it('requires exact expected revision before a change', () => {
  expect(() => step(saved(), author, 'save', { draft: draft(), expectedRevision: 0 })).toThrow(
    /conflict/,
  );
});
it('separates author, reviewer and publisher capabilities', () => {
  expect(() => step(saved(), publisher, 'save', { draft: draft() })).toThrow(/forbidden/);
  expect(() => step(saved(), reviewer, 'publish')).toThrow(/forbidden/);
  expect(() => step(saved(), author, 'approve', { expiresAt: '2027-01-01T00:00:00.000Z' })).toThrow(
    /forbidden/,
  );
});
it('requires submission and a different reviewer before publication', () => {
  expect(() =>
    step(saved(), reviewer, 'approve', { expiresAt: '2027-01-01T00:00:00.000Z' }),
  ).toThrow(/conflict/);
  const submitted = step(saved(), author, 'submit');
  expect(() =>
    step(submitted, { ...author, roles: ['reviewer'] }, 'approve', {
      expiresAt: '2027-01-01T00:00:00.000Z',
    }),
  ).toThrow(/forbidden/);
  const approved = step(submitted, reviewer, 'approve', { expiresAt: '2027-01-01T00:00:00.000Z' });
  expect(step(approved, publisher, 'publish')).toMatchObject({
    revision: 4,
    state: 'published',
    review: { actor: reviewer, at },
  });
});
it('editing invalidates approval and never changes an old object', () => {
  const approved = step(step(saved(), author, 'submit'), reviewer, 'approve', {
    expiresAt: '2027-01-01T00:00:00.000Z',
  });
  const edited = step(approved, author, 'save', {
    draft: { ...draft(), title: 'New draft title' },
  });
  expect(edited).toMatchObject({ state: 'draft', review: null, revision: 4 });
  expect(approved).toMatchObject({ state: 'approved', revision: 3 });
});
it('refuses expired or malformed review expiry and expired publication', () => {
  const submitted = step(saved(), author, 'submit');
  for (const expiresAt of [at, 'invalid', '2200-01-01T00:00:00.000Z'])
    expect(() => step(submitted, reviewer, 'approve', { expiresAt })).toThrow();
  const approved = step(submitted, reviewer, 'approve', { expiresAt: '2027-01-01T00:00:00.000Z' });
  expect(() =>
    transitionEditorial(
      approved,
      publisher,
      { id: 'doc', expectedRevision: 3, key: 'expired', action: 'publish' },
      'a'.repeat(64),
      '2027-02-01T00:00:00.000Z',
    ),
  ).toThrow(/forbidden/);
});
it('withdraws as a higher draft revision and rollback needs fresh review', () => {
  const live = step(
    step(step(saved(), author, 'submit'), reviewer, 'approve', {
      expiresAt: '2027-01-01T00:00:00.000Z',
    }),
    publisher,
    'publish',
  );
  expect(step(live, publisher, 'withdraw')).toMatchObject({
    state: 'withdrawn',
    revision: 5,
    review: null,
  });
  expect(step(live, publisher, 'rollback', { draft: draft() })).toMatchObject({
    state: 'draft',
    revision: 5,
    author: publisher,
    review: null,
  });
});
it('rejects malformed paths, sources, markup, unknown fields and excessive content', () => {
  for (const value of [
    { ...draft(), path: '/reports/private' },
    { ...draft(), title: '<script>' },
    { ...draft(), references: [{ title: 'bad', url: 'javascript:alert(1)' }] },
    { ...draft(), actor: author },
    { ...draft(), paragraphs: Array(101).fill('text') },
  ])
    expect(() => validateEditorialDraft(value)).toThrow();
});
it('rejects unsafe actions and does not permit author self-publication', () => {
  expect(() => step(saved(), publisher, 'unknown')).toThrow();
  const approved = step(step(saved(), author, 'submit'), reviewer, 'approve', {
    expiresAt: '2027-01-01T00:00:00.000Z',
  });
  expect(() => step(approved, { ...author, roles: ['publisher'] }, 'publish')).toThrow(/forbidden/);
});
