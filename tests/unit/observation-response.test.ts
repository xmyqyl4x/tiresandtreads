import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  responseState,
  transition,
  acknowledge,
  retryDelivery,
} from '../../scripts/observability/response.ts';
const project = 'tt-test-0123456789abcdef';
it('refuses outbox overflow without dropping unresolved events or mutating the previous journal', () => {
  const a = transition(responseState(null, project), alert, 1000),
    event = a.events[0]!;
  a.events = Array.from({ length: 32 }, () => ({
    ...event,
    message: { ...event.message, id: randomUUID() },
  }));
  expect(() =>
    transition(
      a,
      { ...alert, events: [{ component: 'callbacks', state: 'alert', reasons: ['lag'] }] },
      2000,
    ),
  ).toThrow(/^Local response evidence unavailable$/);
  expect(a.events).toHaveLength(32);
  expect(a.incidents[0]!.reasons).toEqual(['backlog']);
});
it('refuses a clock rollback instead of clearing or re-dating prior incident evidence', () => {
  const a = transition(responseState(null, project), alert, 1000);
  expect(() => acknowledge(a, a.incidents[0]!.id, 999)).toThrow();
  expect(() =>
    transition(a, { healthy: true, fresh: true, activeAlerts: [], events: [] }, 999),
  ).toThrow(/^Local response evidence unavailable$/);
});
const alert = {
  healthy: false,
  fresh: true,
  activeAlerts: ['callbacks'],
  events: [{ component: 'callbacks', state: 'alert', reasons: ['backlog'] }],
};
it('keeps stable incidents and delivery identities across duplicate samples and restart', () => {
  const a = transition(responseState(null, project), alert, 1000),
    b = transition(responseState(JSON.parse(JSON.stringify(a)), project), alert, 2000);
  expect(b.incidents[0]!.id).toBe(a.incidents[0]!.id);
  expect(b.events).toEqual(a.events);
});
it('acknowledgment does not resolve an active incident or imply delivery', () => {
  const a = transition(responseState(null, project), alert, 1000),
    b = acknowledge(a, a.incidents[0]!.id, 2000);
  expect(b.incidents[0]).toMatchObject({ open: true, acknowledgedAt: 2000 });
  expect(b.events[0]!.status).toBe('pending');
  expect(transition(b, alert, 20000).incidents[0]!.escalatedAt).toBeNull();
});
it('escalates unacknowledged incidents with simulated time and retains them through unavailable evidence', () => {
  const a = transition(responseState(null, project), alert, 1000),
    b = transition(
      a,
      { healthy: false, fresh: false, activeAlerts: ['telemetry'], events: [] },
      16000,
    );
  expect(b.incidents[0]).toMatchObject({ open: true, escalatedAt: 16000 });
});
it('requires fresh healthy evidence to resolve a persisted incident after observer restart', () => {
  const a = transition(responseState(null, project), alert, 1000);
  expect(
    transition(a, { healthy: false, fresh: false, activeAlerts: [], events: [] }, 2000)
      .incidents[0]!.open,
  ).toBe(true);
  const b = transition(a, { healthy: true, fresh: true, activeAlerts: [], events: [] }, 3000);
  expect(b.incidents[0]!.open).toBe(false);
  expect(b.events.map((e) => e.message.state)).toEqual(['alert', 'recovered']);
});
it('prunes delivered history by local retention while preserving unresolved delivery and incidents', () => {
  const a = transition(responseState(null, project), alert, 1000);
  a.events[0]!.status = 'delivered';
  const b = transition(a, alert, 302000);
  expect(b.events).toHaveLength(0);
  expect(b.incidents[0]!.open).toBe(true);
  const c = transition(responseState(null, project), alert, 1000);
  expect(transition(c, alert, 302000).events).toHaveLength(1);
});
it('requires explicit operator retry of exhausted delivery without changing its event identity', () => {
  const a = transition(responseState(null, project), alert, 1000);
  a.events[0]!.status = 'failed';
  a.events[0]!.attempts = 3;
  const b = retryDelivery(a, a.events[0]!.message.id, 2000);
  expect(b.events[0]).toMatchObject({ status: 'pending', attempts: 0 });
  expect(b.events[0]!.message.id).toBe(a.events[0]!.message.id);
});
it('refuses malformed/private or foreign journal data and invalid events', () => {
  const a = transition(responseState(null, project), alert, 1000);
  for (const input of [
    { ...a, project: 'tt-test-fedcba9876543210' },
    { ...a, secret: 'private' },
    { ...a, incidents: [a.incidents[0], a.incidents[0]] },
  ])
    expect(() => responseState(input, project)).toThrow(/^Local response evidence unavailable$/);
  expect(() =>
    transition(
      a,
      { ...alert, events: [{ component: 'private', state: 'alert', reasons: ['secret'] }] },
      2000,
    ),
  ).toThrow();
});
