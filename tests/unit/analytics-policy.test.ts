import { it, expect } from 'vitest';
import { decodeAnalyticsBatch } from '../../packages/domain/src/analytics-policy.ts';
const now = '2026-10-26T12:00:00.000Z';
const event = {
  id: '88888888-8888-4888-8888-888888888888',
  name: 'public_page_view',
  occurredAt: now,
  route: '/',
  props: {},
};
it('accepts only bounded, registered non-identifying event fields', () => {
  expect(decodeAnalyticsBatch(JSON.stringify({ events: [event] }), now)).toEqual([event]);
  for (const raw of [
    { events: [{ ...event, url: 'https://private.invalid' }] },
    { events: [{ ...event, props: { email: 'private@example.invalid' } }] },
    { events: [{ ...event, route: '/reports/secret' }] },
    { events: [event, event] },
    { events: Array.from({ length: 51 }, () => event) },
  ])
    expect(() => decodeAnalyticsBatch(JSON.stringify(raw), now)).toThrow();
});
it('enforces the replay horizon and rejects future events before persistence', () => {
  for (const occurredAt of ['2026-10-25T11:59:59.999Z', '2026-10-26T12:05:00.001Z', 'bad'])
    expect(() =>
      decodeAnalyticsBatch(JSON.stringify({ events: [{ ...event, occurredAt }] }), now),
    ).toThrow();
});
it.each([
  'null',
  '[]',
  '{}',
  'bad',
  '{"events":[]}',
  JSON.stringify({ events: [null] }),
  JSON.stringify({ events: [{ ...event, id: 'bad' }] }),
  JSON.stringify({ events: [{ ...event, name: 'unknown' }] }),
  JSON.stringify({ events: [{ ...event, props: null }] }),
  JSON.stringify({ events: [{ ...event, props: { step: 'email' } }] }),
  JSON.stringify({ events: [{ ...event, props: { outcome: 'email' } }] }),
])('rejects malformed or unregistered batch %s', (raw) => {
  expect(() => decodeAnalyticsBatch(raw, now)).toThrow();
});
it('enforces serialized byte and clock bounds', () => {
  expect(() => decodeAnalyticsBatch(' '.repeat(65537), now)).toThrow();
  expect(() => decodeAnalyticsBatch(JSON.stringify({ events: [event] }), 'bad')).toThrow();
});
it.each([
  ['assessment_started', '/assess'],
  ['report_viewed', '/reports/:report'],
  ['comparison_saved', '/compare/:report'],
  ['delivery_requested', '/reports/:report'],
])('admits only the registered route for %s', (name, route) => {
  expect(
    decodeAnalyticsBatch(
      JSON.stringify({
        events: [{ ...event, name, route, props: { step: 'results', outcome: 'success' } }],
      }),
      now,
    ),
  ).toHaveLength(1);
});
