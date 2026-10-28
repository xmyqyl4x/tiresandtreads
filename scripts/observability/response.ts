import { randomUUID } from 'node:crypto';
import { lstat, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, basename, join } from 'node:path';
import {
  alertSchema,
  responseJournalSchema,
  responseInputSchema,
  type ResponseJournal,
  type FixtureAlert,
} from '../../packages/config/src/observation-preflight.ts';
import { localProviderProject } from '../../packages/config/src/provider-preflight.ts';
const refused = () => Error('Local response evidence unavailable');
function instant(now: number) {
  if (!Number.isSafeInteger(now) || now < 0 || now > 8640000000000000) throw refused();
  return now;
}
export function responseState(input: unknown, project: string): ResponseJournal {
  try {
    const s = responseJournalSchema.parse(
      input ?? { schemaVersion: 1, project, incidents: [], events: [] },
    );
    if (
      s.project !== project ||
      new Set(s.incidents.map((i) => i.component)).size !== s.incidents.length ||
      new Set(s.incidents.map((i) => i.id)).size !== s.incidents.length ||
      new Set(s.events.map((e) => e.message.id)).size !== s.events.length ||
      s.events.some((e) => e.message.project !== project) ||
      s.events.filter((e) => e.status !== 'delivered').length > 32
    )
      throw Error();
    return s;
  } catch {
    throw refused();
  }
}
type Input = {
  healthy: boolean;
  fresh: boolean;
  activeAlerts: readonly string[];
  events: readonly { component: string; state: string; reasons: readonly string[] }[];
};
function retain(s: ResponseJournal, now: number) {
  s.events = s.events.filter(
    (e) => e.status !== 'delivered' || now - Date.parse(e.message.at) < 300000,
  );
  const delivered = s.events.filter((e) => e.status === 'delivered');
  if (delivered.length > 64) {
    const remove = new Set(delivered.slice(0, delivered.length - 64).map((e) => e.message.id));
    s.events = s.events.filter((e) => !remove.has(e.message.id));
  }
  return s;
}
export function transition(input: ResponseJournal, sample: Input, now: number) {
  try {
    instant(now);
    const s = responseState(input, input.project),
      v = responseInputSchema.parse({
        healthy: sample.healthy,
        fresh: sample.fresh,
        activeAlerts: sample.activeAlerts,
        events: sample.events,
      });
    if (
      new Set(v.activeAlerts).size !== v.activeAlerts.length ||
      new Set(v.events.map((e) => e.component)).size !== v.events.length ||
      (v.healthy && (!v.fresh || v.activeAlerts.length))
    )
      throw Error();
    if (
      s.incidents.some((i) =>
        [i.openedAt, i.acknowledgedAt, i.escalatedAt, i.resolvedAt].some(
          (at) => at !== null && at > now,
        ),
      )
    )
      throw Error();
    retain(s, now);
    const changes = [...v.events];
    if (v.healthy)
      for (const i of s.incidents)
        if (i.open && !changes.some((e) => e.component === i.component))
          changes.push({ component: i.component, state: 'recovered', reasons: [] });
    for (const e of changes) {
      if (
        (e.state === 'alert' && !v.activeAlerts.includes(e.component)) ||
        (e.state === 'recovered' && v.activeAlerts.includes(e.component)) ||
        new Set(e.reasons).size !== e.reasons.length ||
        (e.state === 'recovered' && e.reasons.length) ||
        (e.state === 'alert' && !e.reasons.length)
      )
        throw Error();
      let incident = s.incidents.find((i) => i.component === e.component);
      if (e.state === 'recovered' && !incident?.open) continue;
      if (
        e.state === 'alert' &&
        incident?.open &&
        incident.reasons.join('|') === e.reasons.join('|')
      )
        continue;
      if (e.state === 'alert' && !incident?.open) {
        s.incidents = s.incidents.filter((i) => i.component !== e.component);
        incident = {
          id: randomUUID(),
          component: e.component,
          open: true,
          reasons: e.reasons,
          openedAt: now,
          acknowledgedAt: null,
          escalatedAt: null,
          resolvedAt: null,
        };
        s.incidents.push(incident);
      } else if (incident) {
        incident.reasons = e.reasons;
        if (e.state === 'recovered') {
          incident.open = false;
          incident.resolvedAt = now;
        }
      }
      s.events.push({
        message: alertSchema.parse({
          schemaVersion: 1,
          project: s.project,
          id: randomUUID(),
          ...e,
          at: new Date(now).toISOString(),
        }),
        status: 'pending',
        attempts: 0,
        nextAttemptAt: now,
      });
    }
    for (const i of s.incidents)
      if (
        i.open &&
        i.acknowledgedAt === null &&
        i.escalatedAt === null &&
        now - i.openedAt >= 15000
      )
        i.escalatedAt = now;
    retain(s, now);
    return responseState(s, s.project);
  } catch {
    throw refused();
  }
}
export function acknowledge(input: ResponseJournal, id: string, now: number) {
  const s = responseState(input, input.project),
    i = s.incidents.find((i) => i.id === id && i.open);
  if (!i) throw refused();
  if (instant(now) < i.openedAt) throw refused();
  i.acknowledgedAt ??= instant(now);
  return s;
}
export function retryDelivery(input: ResponseJournal, id: string, now: number) {
  const s = responseState(input, input.project),
    e = s.events.find((e) => e.message.id === id && e.status === 'failed');
  if (!e) throw refused();
  if (instant(now) < Date.parse(e.message.at)) throw refused();
  e.status = 'pending';
  e.attempts = 0;
  e.nextAttemptAt = instant(now);
  return s;
}

// Disposable local fixture controller only. Neither recipients nor production alert policy exist here.
export async function localResponse(d: {
  file: string;
  env: Readonly<Record<string, string | undefined>>;
  now: () => number;
  send: (message: FixtureAlert) => Promise<void>;
}) {
  const project = localProviderProject(d.env),
    directory = dirname(d.file);
  if (!isAbsolute(d.file) || basename(d.file) !== 'response.json') throw refused();
  const dir = await lstat(directory);
  if (
    !/^tt-observation-[a-zA-Z0-9_-]+$/.test(basename(directory)) ||
    !dir.isDirectory() ||
    dir.isSymbolicLink() ||
    dir.mode & 0o077 ||
    (process.getuid && dir.uid !== process.getuid())
  )
    throw refused();
  const lock = await open(join(directory, 'response.lock'), 'wx', 0o600).catch(() => {
    throw refused();
  });
  let state: ResponseJournal,
    busy = false,
    closed = false;
  async function save(next: ResponseJournal) {
    const kept = retain(responseState(next, project), instant(d.now()));
    const body = JSON.stringify(kept) + '\n';
    if (Buffer.byteLength(body) > 131072) throw refused();
    const temp = join(directory, 'response-' + randomUUID() + '.tmp'),
      handle = await open(temp, 'wx', 0o600);
    try {
      await handle.writeFile(body);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temp, d.file);
      const parent = await open(directory, 'r');
      try {
        await parent.sync();
      } finally {
        await parent.close();
      }
    } finally {
      await unlink(temp).catch(() => {});
    }
    state = kept;
  }
  async function release() {
    await lock.close();
    await unlink(join(directory, 'response.lock'));
  }
  try {
    let input: unknown = null;
    try {
      const file = await lstat(d.file);
      if (!file.isFile() || file.isSymbolicLink() || file.mode & 0o077 || file.size > 131072)
        throw refused();
      input = JSON.parse(await readFile(d.file, 'utf8'));
    } catch (e) {
      if (!(e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT')) throw refused();
    }
    state = responseState(input, project);
    await save(state);
  } catch {
    await release();
    throw refused();
  }
  function summary() {
    return {
      incidents: state.incidents.map((i) => ({ ...i, reasons: [...i.reasons] })),
      pending: state.events.filter((e) => e.status === 'pending').length,
      failed: state.events.filter((e) => e.status === 'failed').length,
      deliveryUncertain: state.events.some((e) => e.status !== 'delivered'),
      retainedEvents: state.events.length,
      actualRecipientNotifications: 0,
      automaticRemediation: false,
    };
  }
  async function exclusive<T>(work: () => Promise<T>) {
    if (closed || busy) throw refused();
    busy = true;
    try {
      return await work();
    } finally {
      busy = false;
    }
  }
  return {
    status: () => summary(),
    accept: (sample: Input) =>
      exclusive(async () => {
        await save(transition(state, sample, d.now()));
        return summary();
      }),
    acknowledge: (id: string) =>
      exclusive(async () => {
        await save(acknowledge(state, id, d.now()));
        return summary();
      }),
    retry: (id: string) =>
      exclusive(async () => {
        await save(retryDelivery(state, id, d.now()));
        return summary();
      }),
    flush: () =>
      exclusive(async () => {
        for (let n = 0; n < 4; n++) {
          const next = responseState(state, project),
            e = next.events.find((e) => e.status !== 'delivered');
          if (!e || e.status === 'failed' || e.nextAttemptAt > d.now()) break;
          if (e.attempts >= 3) {
            e.status = 'failed';
            await save(next);
            break;
          }
          e.attempts++;
          e.nextAttemptAt = d.now() + 1000;
          await save(next);
          try {
            await d.send(structuredClone(e.message));
            e.status = 'delivered';
          } catch {
            if (e.attempts === 3) e.status = 'failed';
          }
          await save(next);
          if (e.status !== 'delivered') break;
        }
        return summary();
      }),
    close: () =>
      closed
        ? Promise.resolve()
        : exclusive(async () => {
            closed = true;
            await release();
          }),
  };
}
