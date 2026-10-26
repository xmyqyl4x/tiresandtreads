import { id, instant, type Id, type Instant } from './values/core.ts';
import { instantMilliseconds } from './values/time.ts';
export interface CollectedEvent {
  readonly id: Id<'event'>;
  readonly name:
    | 'public_page_view'
    | 'assessment_started'
    | 'report_viewed'
    | 'comparison_saved'
    | 'delivery_requested';
  readonly occurredAt: Instant;
  readonly route:
    | '/'
    | '/assess'
    | '/reports/:report'
    | '/compare/:report'
    | '/learn/:slug'
    | '/guides/:slug'
    | '/glossary/:slug'
    | '/tires/models/:slug'
    | '/tires/sizes/:slug';
  readonly props: Readonly<{
    step?: 'start' | 'vehicle' | 'tires' | 'conditions' | 'results';
    outcome?: 'success' | 'denied' | 'failed';
  }>;
}
export function decodeAnalyticsBatch(raw: string, now: string): readonly CollectedEvent[] {
  const reject = (): never => {
    throw Error('Invalid analytics batch');
  };
  if (
    typeof raw !== 'string' ||
    raw.length > 65536 ||
    new TextEncoder().encode(raw).length > 65536 ||
    !instant(now).ok
  )
    reject();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return reject();
  }
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).join(',') !== 'events'
  )
    reject();
  const events = (body as { events: unknown }).events;
  if (!Array.isArray(events) || events.length < 1 || events.length > 50) return reject();
  const routes = {
    public_page_view: [
      '/',
      '/learn/:slug',
      '/guides/:slug',
      '/glossary/:slug',
      '/tires/models/:slug',
      '/tires/sizes/:slug',
    ],
    assessment_started: ['/assess'],
    report_viewed: ['/reports/:report'],
    comparison_saved: ['/compare/:report'],
    delivery_requested: ['/reports/:report'],
  } as const;
  const seen = new Set<string>();
  return events.map((e) => {
    if (
      !e ||
      typeof e !== 'object' ||
      Array.isArray(e) ||
      Object.keys(e).sort().join(',') !== 'id,name,occurredAt,props,route'
    )
      return reject();
    const key = id('event', e.id),
      stamp = instant(e.occurredAt);
    if (
      !key.ok ||
      !stamp.ok ||
      seen.has(key.value) ||
      instantMilliseconds(now as Instant) - instantMilliseconds(stamp.value) > 86400000 ||
      instantMilliseconds(stamp.value) - instantMilliseconds(now as Instant) > 300000 ||
      !Object.hasOwn(routes, e.name) ||
      !(routes[e.name as keyof typeof routes] as readonly unknown[]).includes(e.route)
    )
      return reject();
    seen.add(key.value);
    if (
      !e.props ||
      typeof e.props !== 'object' ||
      Array.isArray(e.props) ||
      Object.keys(e.props).some((k) => !['step', 'outcome'].includes(k)) ||
      ('step' in e.props &&
        !['start', 'vehicle', 'tires', 'conditions', 'results'].includes(e.props.step)) ||
      ('outcome' in e.props && !['success', 'denied', 'failed'].includes(e.props.outcome))
    )
      return reject();
    return {
      id: key.value,
      name: e.name,
      occurredAt: stamp.value,
      route: e.route,
      props: { ...e.props },
    } as CollectedEvent;
  });
}
