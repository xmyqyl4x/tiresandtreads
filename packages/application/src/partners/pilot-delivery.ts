import { ok, fail, type Id, type Result } from '../../../domain/src/values/core.ts';
import { matchPilotOffers } from '../../../domain/src/offer-matching.ts';
import type { PilotAudience } from '../../../domain/src/offer-matching.ts';
import type { PilotOffer, PilotContext, PilotLocation } from '../ports/pilot-delivery.ts';
import { normalizeEmail } from '../../../domain/src/contact-policy.ts';
import type {
  PilotRepository,
  PilotPolicy,
  PilotProvider,
  PilotRenderer,
  PilotRequest,
  PilotPayload,
} from '../ports/pilot-delivery.ts';
import type { PartnerCrypto, CodeSeal } from '../ports/partner-services.ts';
import type { ContactEncryption } from '../ports/contact-services.ts';
import type { DeliveryFiles } from '../ports/delivery-services.ts';
import type { KeyDigest } from '../ports/private-records.ts';
import type {
  UnitOfWork,
  TransactionContext as Tx,
  ApplicationFailure,
} from '../ports/transactions.ts';
import { demand, serviceWork, serviceFailure, ServiceFault } from '../services/service-work.ts';
import { capture, identifier, string } from './partner-work.ts';
export function createPilotDeliveryServices(d: {
  readonly uow: UnitOfWork;
  readonly repository: PilotRepository;
  readonly policy: PilotPolicy;
  readonly crypto: PartnerCrypto;
  readonly encryption: ContactEncryption;
  readonly files: DeliveryFiles;
  readonly renderer: PilotRenderer;
  readonly provider: PilotProvider;
}) {
  const policy = capture(d.policy),
    repo = d.repository;
  string(policy.version, 100);
  identifier('notice', policy.offersNotice);
  identifier('notice', policy.reportNotice);
  string(policy.consentPolicy, 100);
  demand(policy.creditUnits > 0n && policy.creditUnits <= 9223372036854775807n);
  new Intl.DateTimeFormat('en', { timeZone: policy.timeZone });
  demand(
    d.provider.name === policy.provider &&
      d.provider.fixture === policy.fixture &&
      d.renderer.fixture === policy.fixture,
    'forbidden',
  );
  const run = <T>(fn: (tx: Tx) => Promise<T>) => serviceWork(d.uow, async (tx) => ok(await fn(tx)));
  const safe = async <T>(fn: () => Promise<Result<T, ApplicationFailure>>) => {
    try {
      return await fn();
    } catch (e) {
      return fail(serviceFailure(e));
    }
  };
  const locationOf = (a: PilotLocation): PilotLocation => ({
    region: a.region,
    postal: a.postal,
    latitude: a.latitude,
    longitude: a.longitude,
  });
  const enrich = async (c: PilotContext): Promise<PilotContext> => {
    demand(c.policyVersion === policy.version, 'forbidden');
    const location = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        await d.encryption.decrypt(c.geo.box, 'pilot_geo', c.sendId),
      ),
    ) as PilotLocation;
    demand(
      location !== null &&
        typeof location === 'object' &&
        Object.keys(location).length === 4 &&
        d.crypto.digest(location) === c.geo.digest,
      'integrity',
    );
    for (const k of ['region', 'postal'] as const)
      demand(
        location[k] === null ||
          (typeof location[k] === 'string' && location[k].length > 0 && location[k].length <= 100),
        'integrity',
      );
    demand(
      (location.latitude === null && location.longitude === null) ||
        (typeof location.latitude === 'number' &&
          Number.isFinite(location.latitude) &&
          Math.abs(location.latitude) <= 90 &&
          typeof location.longitude === 'number' &&
          Number.isFinite(location.longitude) &&
          Math.abs(location.longitude) <= 180),
      'integrity',
    );
    return { ...c, audience: { ...c.audience, ...locationOf(location) } };
  };
  return {
    request(keys: readonly KeyDigest[], send: Id<'send'>, raw: PilotRequest) {
      return safe(async () => {
        const input = capture(raw),
          auth = capture(keys);
        identifier('send', send);
        string(input.itemKey);
        demand(
          typeof input.adult === 'boolean' &&
            typeof input.includeOffers === 'boolean' &&
            Number.isInteger(input.quantity) &&
            input.quantity >= 1 &&
            input.quantity <= 4,
        );
        for (const k of ['region', 'postal'] as const) if (input[k] !== null) string(input[k], 100);
        demand((input.latitude === null) === (input.longitude === null));
        if (input.latitude !== null)
          demand(
            Number.isFinite(input.latitude) &&
              Math.abs(input.latitude) <= 90 &&
              Number.isFinite(input.longitude) &&
              Math.abs(input.longitude!) <= 180,
          );
        const authorized = await run((tx) => repo.authorize(tx, auth, send));
        if (!authorized.ok) return authorized;
        const location = locationOf(input),
          box = await d.encryption.encrypt(
            new TextEncoder().encode(JSON.stringify(location)),
            'pilot_geo',
            send,
          );
        return run((tx) =>
          repo.capture(
            tx,
            auth,
            send,
            input,
            d.crypto.digest({ input, policy }),
            policy,
            box,
            d.crypto.digest(location),
          ),
        );
      });
    },
    cancel(keys: readonly KeyDigest[], send: Id<'send'>) {
      return safe(() => {
        const auth = capture(keys);
        return run((tx) => repo.cancel(tx, auth, identifier('send', send)));
      });
    },
    simulate(audience: PilotAudience, candidates: readonly PilotOffer[]) {
      return safe(async () => ok(matchPilotOffers(capture(audience), capture(candidates))));
    },
    dispatch(send: Id<'send'>) {
      return safe(async () => {
        const acquired = await run((tx) => repo.acquire(tx, identifier('send', send)));
        if (!acquired.ok) return acquired;
        const l = acquired.value;
        if (!l) return ok({ state: 'idle' });
        if (l.state === 'dispatching') {
          const recovered = await run((tx) => repo.finish(tx, l, 'uncertain', null));
          return recovered.ok ? ok({ state: 'uncertain' }) : recovered;
        }
        let attempted = false;
        try {
          const excluded = new Set<string>();
          let reserved = l.state === 'reserved';
          for (let attempt = 0; attempt < 4 && !reserved; attempt++) {
            const input = await run(async (tx) => ({
              context: await repo.context(tx, l, policy),
              offers: await repo.candidates(tx, l, policy),
            }));
            if (!input.ok) throw new ServiceFault(input.error.code, input.error);
            const { offers } = input.value;
            const c = await enrich(input.value.context);
            demand(c.provider === d.provider.name, 'forbidden');
            const decisions = matchPilotOffers(
                c.audience,
                offers.map((o) => ({
                  ...o,
                  available: o.available && c.offersAllowed && !excluded.has(o.offer.offerId),
                })),
              ),
              selected = offers
                .filter((o) => decisions.some((x) => x.selected && x.offerId === o.offer.offerId))
                .sort(
                  (a, b) =>
                    decisions.findIndex((x) => x.offerId === a.offer.offerId) -
                    decisions.findIndex((x) => x.offerId === b.offer.offerId),
                );
            const generated = new Map<string, CodeSeal>();
            for (const o of selected)
              if (o.mode === 'generated')
                generated.set(
                  o.poolId,
                  d.crypto.seal(
                    o.offer.organizationId,
                    o.poolId,
                    string(o.prefix, 32) + '-' + d.crypto.token(),
                    d.crypto.currentKeyVersion,
                  ),
                );
            const saved = await run((tx) =>
              repo.reserve(tx, l, c, selected, decisions, generated, policy),
            );
            if (saved.ok) {
              reserved = true;
              break;
            }
            if (!['conflict', 'timeout'].includes(saved.error.code))
              throw new ServiceFault(saved.error.code, saved.error);
            selected.forEach((o) => excluded.add(o.offer.offerId));
          }
          demand(reserved, 'conflict');
          for (let render = 0; render < 3; render++) {
            const input = await run(async (tx) => ({
              c: await repo.context(tx, l, policy),
              held: await repo.held(tx, l, policy),
            }));
            if (!input.ok) throw new ServiceFault(input.error.code, input.error);
            const c = await enrich(input.value.c),
              held = input.value.held,
              decisions = matchPilotOffers(
                c.audience,
                held.map((h) => h.offer),
              ),
              selected = c.offersAllowed
                ? held.filter((h) =>
                    decisions.some((x) => x.eligible && x.offerId === h.offer.offer.offerId),
                  )
                : [];
            const trimmed = await run((tx) =>
              repo.trim(
                tx,
                l,
                selected.map((x) => x.assignment.id),
              ),
            );
            if (!trimmed.ok) throw new ServiceFault(trimmed.error.code, trimmed.error);
            if (!c.reportAllowed && !selected.length) {
              const stopped = await run((tx) => repo.stop(tx, l));
              return stopped.ok ? ok({ state: 'suppressed' }) : stopped;
            }
            demand(policy.fixture || c.document?.report.issuanceAuthorized === true, 'forbidden');
            const blocks = selected.map((h) => ({
              offer: h.offer,
              code: d.crypto.open(h.assignment.organizationId, h.assignment.poolId, h.seal),
              reasons: decisions.find((x) => x.offerId === h.offer.offer.offerId)!.reasons,
            }));
            const mail = await d.renderer.render(c, blocks);
            demand(
              mail.fixture === policy.fixture &&
                mail.commercial === selected.length > 0 &&
                mail.stream === (selected.length ? 'commercial' : 'report') &&
                typeof mail.html === 'string' &&
                new TextEncoder().encode(mail.html).length < 100000 &&
                typeof mail.text === 'string' &&
                new TextEncoder().encode(mail.text).length <= 65536 &&
                typeof mail.subject === 'string' &&
                mail.subject.length > 0 &&
                mail.subject.length <= 200 &&
                !/[\r\n]/.test(mail.subject),
              'integrity',
            );
            demand(
              mail.commercial ||
                (mail.unsubscribeUrl === null && Object.keys(mail.headers).length === 0),
              'integrity',
            );
            demand(c.reportAllowed || mail.pdf === null, 'integrity');
            demand(
              !mail.commercial ||
                (mail.unsubscribeUrl !== null &&
                  new URL(mail.unsubscribeUrl).protocol === 'https:' &&
                  !/[\r\n<>]/.test(mail.unsubscribeUrl) &&
                  mail.headers['List-Unsubscribe'] === '<' + mail.unsubscribeUrl + '>' &&
                  mail.headers['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click'),
              'integrity',
            );
            const recipient = normalizeEmail(
                new TextDecoder('utf-8', { fatal: true }).decode(
                  await d.encryption.decrypt(c.contact, 'contact_email', c.contactId),
                ),
              ),
              payload: PilotPayload = capture({ recipient, mail }),
              bytes = new TextEncoder().encode(JSON.stringify(payload));
            demand(bytes.length <= 7 * 1024 * 1024, 'integrity');
            const frozen = await d.encryption.encrypt(bytes, 'pilot_payload', send),
              digest = d.crypto.checksum(bytes);
            demand(
              d.crypto.checksum(await d.encryption.decrypt(frozen, 'pilot_payload', send)) ===
                digest,
              'integrity',
            );
            const asset = d.crypto.id('asset'),
              objectBytes = new TextEncoder().encode(JSON.stringify(frozen)),
              objectHash = d.crypto.checksum(objectBytes);
            const reservedAsset = await run((tx) => repo.reservePayload(tx, l, asset));
            if (!reservedAsset.ok)
              throw new ServiceFault(reservedAsset.error.code, reservedAsset.error);
            await d.files.put(asset, 'email_payload', objectBytes);
            demand(d.crypto.checksum(await d.files.get(asset)) === objectHash, 'integrity');
            const claimed = await run((tx) =>
              repo.claim(
                tx,
                l,
                selected.map((x) => x.assignment.id),
                c.permissionRevision,
                c.reportAllowed,
                frozen,
                digest,
                asset,
                objectHash,
                policy,
                locationOf(c.audience),
                c.geo.digest,
              ),
            );
            if (!claimed.ok) throw new ServiceFault(claimed.error.code, claimed.error);
            if (!claimed.value) continue;
            attempted = true;
            let result: Awaited<ReturnType<PilotProvider['send']>>;
            try {
              result = await d.provider.send(c.providerKey, payload);
            } catch {
              result = { outcome: 'uncertain', messageId: null };
            }
            if (
              !result ||
              !['accepted', 'definitive_rejection', 'uncertain'].includes(result.outcome) ||
              (result.messageId !== null &&
                (typeof result.messageId !== 'string' ||
                  !result.messageId.length ||
                  result.messageId.length > 200 ||
                  /[\r\n]/.test(result.messageId)))
            )
              result = { outcome: 'uncertain', messageId: null };
            const finished = await run((tx) =>
              repo.finish(tx, l, result.outcome, result.messageId),
            );
            return finished.ok
              ? ok({ state: result.outcome === 'definitive_rejection' ? 'failed' : result.outcome })
              : finished;
          }
          throw new ServiceFault('conflict');
        } finally {
          if (!attempted) await run((tx) => repo.retry(tx, l));
        }
      });
    },
  };
}
