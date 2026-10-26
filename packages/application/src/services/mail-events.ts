import { ok, fail, id, instant } from '../../../domain/src/values/core.ts';
import { fixedEmailDestination } from '../../../domain/src/mail-events.ts';
import type {
  MailObservation,
  MailEventsRepository,
  EmailLinkRepository,
  EmailLinkCrypto,
  EmailLink,
} from '../ports/mail-events.ts';
import type { UnitOfWork, TransactionContext as Tx } from '../ports/transactions.ts';
import { demand, serviceWork, serviceFailure } from './service-work.ts';
import type { createContactServices } from './contacts.ts';
export function createMailEventServices(d: {
  readonly uow: UnitOfWork;
  readonly events: MailEventsRepository;
  readonly retrieve: (id: string) => Promise<Readonly<{ id: string; event: string }> | null>;
}) {
  const work = <T>(fn: (tx: Tx) => Promise<T>) =>
    serviceWork(d.uow, async (tx) => ok(await fn(tx)));
  return {
    // Only the verified integration owns this boundary; never bind it directly to parsed HTTP JSON.
    receive(e: MailObservation) {
      return work(async (tx) => {
        const receipt = await d.events.receive(tx, e);
        return { id: receipt, state: await d.events.apply(tx, receipt) };
      });
    },
    replay(raw: unknown) {
      return work(async (tx) => {
        const key = id('inbox', raw);
        demand(key.ok);
        return d.events.apply(tx, key.value);
      });
    },
    pending() {
      return work((tx) => d.events.pending(tx));
    },
    status(raw: unknown) {
      return work(async (tx) => {
        const key = id('send', raw);
        demand(key.ok);
        return d.events.status(tx, key.value);
      });
    },
    async reconcile(raw: unknown) {
      try {
        const key = id('send', raw);
        demand(key.ok);
        const before = await work((tx) => d.events.status(tx, key.value));
        if (!before.ok) return before;
        if (!before.value.messageId) return ok({ status: 'manual_review' as const });
        const r = await d.retrieve(before.value.messageId);
        if (!r) return ok({ status: 'manual_review' as const });
        demand(r.id === before.value.messageId, 'conflict');
        return work(async (tx) => {
          await d.events.reconciled(tx, key.value, r.id, r.event);
          return { status: 'reconciled' as const };
        });
      } catch (e) {
        return fail(serviceFailure(e));
      }
    },
  };
}
export function createEmailActionServices(d: {
  readonly uow: UnitOfWork;
  readonly links: EmailLinkRepository;
  readonly crypto: EmailLinkCrypto;
  readonly contacts: Pick<
    ReturnType<typeof createContactServices>,
    'confirm' | 'withdraw' | 'preferences'
  >;
  readonly origin: string;
}) {
  const work = <T>(fn: (tx: Tx) => Promise<T>) =>
    serviceWork(d.uow, async (tx) => ok(await fn(tx)));
  async function link(tx: Tx, raw: string) {
    const key = d.crypto.parse(raw);
    demand(key, 'forbidden');
    const row = await d.links.resolve(tx, key.id, key.key);
    demand(row, 'not_found');
    demand(
      row.destination ===
        fixedEmailDestination(d.origin, row.purpose, new URL(row.destination).pathname),
      'forbidden',
    );
    return row;
  }
  return {
    issue(
      input: Readonly<{
        sendId: EmailLink['sendId'];
        slot: string;
        purpose: EmailLink['purpose'];
        path: string;
        expiresAt: string;
      }>,
    ) {
      return work(async (tx) => {
        demand(typeof input.slot === 'string' && /^[a-z0-9_-]{1,80}$/.test(input.slot));
        const expiry = instant(input.expiresAt);
        demand(expiry.ok);
        let destination: string;
        try {
          destination = fixedEmailDestination(d.origin, input.purpose, input.path);
        } catch {
          demand(false);
        }
        const token = d.crypto.issue(input.sendId, input.slot);
        await d.links.issue(tx, {
          id: token.id,
          sendId: input.sendId,
          slot: input.slot,
          purpose: input.purpose,
          destination: destination!,
          key: token.key,
          expiresAt: expiry.value,
        });
        return { token: token.raw };
      });
    },
    visit(raw: string, method: string) {
      return work(async (tx) => {
        demand(method === 'GET' || method === 'HEAD');
        const r = await link(tx, raw);
        return r.purpose === 'education'
          ? { kind: 'redirect' as const, destination: r.destination }
          : { kind: 'feedback' as const };
      });
    },
    feedback(raw: string, value: 'yes' | 'no', method: string) {
      return work(async (tx) => {
        demand(method === 'POST' && (value === 'yes' || value === 'no'));
        const r = await link(tx, raw);
        demand(r.purpose === 'feedback', 'forbidden');
        await d.links.feedback(tx, r, value);
        return { status: 'recorded' as const };
      });
    },
    revoke(raw: unknown) {
      return work(async (tx) => {
        const key = id('email_link', raw);
        demand(key.ok);
        await d.links.revoke(tx, key.value);
        return { status: 'revoked' as const };
      });
    },
    preferences(raw: string, method: string) {
      return d.contacts.preferences(raw, method);
    },
    async unsubscribeHeaders(raw: string) {
      const r = await d.contacts.preferences(raw, 'GET');
      if (!r.ok) return r;
      try {
        fixedEmailDestination(d.origin, 'feedback', '/email/feedback');
      } catch {
        try {
          demand(false);
        } catch (e) {
          return fail(serviceFailure(e));
        }
      }
      return ok({
        'List-Unsubscribe': '<' + d.origin + '/email/unsubscribe/' + encodeURIComponent(raw) + '>',
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      });
    },
    confirm(raw: string, method: string) {
      return d.contacts.confirm(raw, method);
    },
    withdraw(raw: string, method: string) {
      return d.contacts.withdraw(raw, method);
    },
    async oneClick(raw: string, method: string, fields: Readonly<Record<string, unknown>>) {
      if (
        method !== 'POST' ||
        Object.keys(fields).join(',') !== 'List-Unsubscribe' ||
        fields['List-Unsubscribe'] !== 'One-Click'
      ) {
        try {
          demand(false);
        } catch (e) {
          return fail(serviceFailure(e));
        }
      }
      return d.contacts.withdraw(raw, 'POST');
    },
  };
}
