import { ok, fail, instant, type Id, type Instant } from '../../../domain/src/values/core.ts';
import { rightsKinds, type RightsKind } from '../../../domain/src/privacy-policy.ts';
import { normalizeEmail } from '../../../domain/src/contact-policy.ts';
import type { KeyDigest } from '../ports/private-records.ts';
import type { ContactCrypto, ContactEncryption } from '../ports/contact-services.ts';
import type { OwnerRepository } from '../ports/owner-report.ts';
import type { UnitOfWork, TransactionContext as Tx } from '../ports/transactions.ts';
import type {
  PrivacyServiceRepository,
  PrivacyCrypto,
  PrivacyJournal,
  PrivacyMail,
  JournalEntry,
} from '../ports/privacy-services.ts';
import type { PrivateObjects } from '../ports/assets.ts';
import type { ReliabilityRepository } from '../ports/reliability.ts';
import { serviceWork, serviceFailure, demand } from './service-work.ts';
import { rightsClock } from './privacy-clock.ts';
import { canonical, exact } from './service-records.ts';

export function createPrivacyServices(d: {
  readonly uow: UnitOfWork;
  readonly repo: PrivacyServiceRepository;
  readonly owners: OwnerRepository;
  readonly reliability: ReliabilityRepository;
  readonly crypto: PrivacyCrypto;
  readonly contacts: Pick<ContactCrypto, 'emailKeys' | 'lookupVersions'>;
  readonly encryption: ContactEncryption;
  readonly journal: PrivacyJournal;
  readonly mail: PrivacyMail;
  readonly objects: PrivateObjects;
  readonly policyVersion: string;
  readonly now: () => string;
}) {
  const work = <T>(fn: (tx: Tx) => Promise<T>) =>
    serviceWork(d.uow, async (tx) => ok(await fn(tx)));
  function proof(raw: string) {
    const p = d.crypto.parse(raw);
    demand(p, 'forbidden');
    return p;
  }
  async function entry(tx: Tx, id: Id<'privacy_request'>): Promise<JournalEntry> {
    const r = await d.repo.journal(tx, id);
    demand(r.targetKind === 'subject' || r.targetKind === 'report');
    return {
      version: 1,
      action: r.kind,
      resourceKind: r.targetKind,
      markers: r.targetId ? d.crypto.markers(r.targetKind, r.targetId) : [],
      tombstones: r.contacts,
      policy: r.policy,
    };
  }
  async function create(
    tx: Tx,
    target: { subjectId: Id<'subject'> | null; kind: 'subject' | 'report'; id: string | null },
    kind: RightsKind,
    jurisdiction: string,
    restoreRunId: Id<'restore'> | null,
    ownerProof: KeyDigest | null = null,
  ) {
    demand(rightsKinds.includes(kind));
    demand(typeof jurisdiction === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(jurisdiction));
    const policy = await d.repo.policy(tx, jurisdiction, d.policyVersion, kind);
    demand(policy, 'unavailable');
    const id = d.crypto.id('privacy_request'),
      token = d.crypto.proof(id, d.crypto.current),
      clock = rightsClock(d.now(), policy);
    await d.repo.create(tx, {
      id,
      subjectId: target.subjectId,
      targetKind: target.kind,
      targetId: target.id,
      kind,
      jurisdiction,
      policyVersion: d.policyVersion,
      policy,
      dueAt: clock.dueAt as Instant,
      proofExpiresAt: clock.proofExpiresAt as Instant,
      proof: token.key,
      reply: null,
      verified: true,
      restoreRunId,
      ownerProof,
    });
    await d.repo.restrict(tx, id);
    if (['delete', 'restrict', 'opt_out'].includes(kind))
      await d.repo.replayMarkers(tx, [await entry(tx, id)]);
    return { id, proof: token.raw };
  }
  async function acknowledge(id: Id<'privacy_request'>) {
    const e = await work((tx) => entry(tx, id));
    if (!e.ok) return e;
    if (!['delete', 'restrict', 'opt_out'].includes(e.value.action)) return ok(null);
    const signed = d.crypto.sign(e.value);
    await d.journal.append(d.crypto.hash('journal-entry', id), signed);
    return work(async (tx) => {
      await d.repo.journaled(tx, id, signed.digest);
      return null;
    });
  }
  return {
    async requestOwner(
      keys: readonly KeyDigest[],
      kind: RightsKind,
      jurisdiction: string,
      requestKey: string,
    ) {
      try {
        demand(typeof requestKey === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(requestKey));
        const bindings = d.crypto.markers(
          'owner-request',
          canonical({ keys, kind, jurisdiction, requestKey }, 4096),
        );
        const previous = await work((tx) => d.repo.resume(tx, bindings));
        if (!previous.ok) return previous;
        if (previous.value) {
          if (!previous.value.journaled && ['delete', 'restrict', 'opt_out'].includes(kind)) {
            const ack = await acknowledge(previous.value.id);
            if (!ack.ok) return ack;
          }
          return ok({
            id: previous.value.id,
            proof: d.crypto.proof(previous.value.id, previous.value.proofVersion).raw,
          });
        }
        const saved = await work(async (tx) => {
          const owner = await d.owners.resolve(tx, keys);
          demand(owner, 'forbidden');
          return create(
            tx,
            { subjectId: owner.subjectId, kind: 'subject', id: owner.subjectId },
            kind,
            jurisdiction,
            null,
            bindings.find((k) => k.keyVersion === d.crypto.current)!,
          );
        });
        if (!saved.ok) return saved;
        const ack = await acknowledge(saved.value.id);
        if (!ack.ok) return ack;
        return saved;
      } catch (e) {
        return fail(serviceFailure(e));
      }
    },
    async requestEmail(address: string, kind: RightsKind, jurisdiction: string) {
      try {
        const email = normalizeEmail(address);
        demand(rightsKinds.includes(kind));
        demand(typeof jurisdiction === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(jurisdiction));
        const p = await work((tx) => d.repo.policy(tx, jurisdiction, d.policyVersion, kind));
        if (!p.ok) return p;
        demand(p.value, 'unavailable');
        const id = d.crypto.id('privacy_request'),
          token = d.crypto.proof(id, d.crypto.current),
          clock = rightsClock(d.now(), p.value),
          reply = await d.encryption.encrypt(new TextEncoder().encode(email), 'privacy_reply', id);
        const saved = await work(async (tx) => {
          const subjectId = await d.repo.contactSubject(tx, d.contacts.emailKeys(email));
          await d.repo.create(tx, {
            id,
            subjectId,
            targetKind: 'subject',
            targetId: subjectId,
            kind,
            jurisdiction,
            policyVersion: d.policyVersion,
            policy: p.value!,
            dueAt: clock.dueAt as Instant,
            proofExpiresAt: clock.proofExpiresAt as Instant,
            proof: token.key,
            reply,
            verified: false,
            restoreRunId: null,
            ownerProof: null,
          });
          await d.reliability.append(tx, {
            eventId: d.crypto.id('event'),
            aggregateKind: 'privacy_request',
            aggregateId: id as unknown as Id<'aggregate'>,
            type: 'privacy.verify',
            version: 1,
            payload: { resource_id: id, resource_kind: 'privacy_request', version: 1 },
          });
          return { accepted: true as const };
        });
        return saved;
      } catch (e) {
        return fail(serviceFailure(e));
      }
    },
    async dispatchVerification(id: Id<'privacy_request'>) {
      try {
        const pending = await work((tx) => d.repo.notification(tx, id));
        if (!pending.ok) return pending;
        if (!pending.value) return ok(null);
        const address = new TextDecoder('utf-8', { fatal: true }).decode(
          await d.encryption.decrypt(pending.value.envelope, 'privacy_reply', id),
        );
        await d.mail.verify({
          key: d.crypto.proof(id, pending.value.keyVersion).key.digest,
          address: normalizeEmail(address),
          proof: d.crypto.proof(id, pending.value.keyVersion).raw,
        });
        const saved = await work(async (tx) => {
          await d.repo.notified(tx, id);
          return { accepted: true as const };
        });
        return saved;
      } catch (e) {
        return fail(serviceFailure(e));
      }
    },
    async confirm(raw: string) {
      try {
        const p = proof(raw);
        const saved = await work(async (tx) => {
          await d.repo.confirm(tx, p.id, p.key);
          await d.repo.restrict(tx, p.id);
          const e = await entry(tx, p.id);
          if (['delete', 'restrict', 'opt_out'].includes(e.action))
            await d.repo.replayMarkers(tx, [e]);
          return { verified: true as const };
        });
        if (!saved.ok) return saved;
        const ack = await acknowledge(p.id);
        return ack.ok ? saved : ack;
      } catch (e) {
        return fail(serviceFailure(e));
      }
    },
    async status(raw: string) {
      try {
        const p = proof(raw);
        return work((tx) => d.repo.authorize(tx, p.id, p.key));
      } catch (e) {
        return fail(serviceFailure(e));
      }
    },
    // Trusted worker boundary. One leased stage/item per call; external I/O never holds SQL.
    async workOne(id: Id<'privacy_request'>) {
      const acquired = await work((tx) => d.repo.lease(tx, id));
      if (!acquired.ok) return acquired;
      if (!acquired.value) return ok(null);
      const l = acquired.value;
      try {
        const next = await work((tx) => d.repo.stage(tx, l));
        if (!next.ok) throw Error('Privacy stage unavailable');
        const stage = next.value;
        let done = true;
        if (stage === 'journal') {
          const r = await work((tx) => entry(tx, id));
          if (!r.ok) throw Error('Privacy journal unavailable');
          const signed = d.crypto.sign(r.value);
          await d.journal.append(d.crypto.hash('journal-entry', id), signed);
          const saved = await work(async (tx) => {
            await d.repo.replayMarkers(tx, [r.value]);
            await d.repo.finishStage(tx, l, stage, signed.digest);
          });
          if (!saved.ok) throw Error('Privacy journal acknowledgment unavailable');
        } else if (stage === 'email') {
          const item = await work((tx) => d.repo.email(tx, l));
          if (!item.ok) throw Error('Privacy email unavailable');
          if (item.value) {
            const x = item.value,
              result = x.attempted ? await d.mail.erase(x) : 'not_stored';
            if (result === 'unsupported') {
              return work(async (tx) => {
                await d.repo.failed(tx, l, 'downstream_unconfirmed');
                return { status: 'manual_review' as const };
              });
            }
            const receipt = await work((tx) =>
              d.repo.receipt(
                tx,
                l,
                'email',
                x.id,
                d.crypto.hash('email-erasure', x.id + ':' + result),
              ),
            );
            if (!receipt.ok) throw Error('Privacy email acknowledgment unavailable');
            done = false;
          }
        } else if (stage === 'objects') {
          const item = await work((tx) => d.repo.asset(tx, l));
          if (!item.ok) throw Error('Privacy object unavailable');
          if (item.value) {
            await d.objects.erase(item.value);
            const receipt = await work((tx) =>
              d.repo.receipt(
                tx,
                l,
                'objects',
                item.value!.id,
                d.crypto.hash('object-erasure', item.value!.id),
              ),
            );
            if (!receipt.ok) throw Error('Privacy object acknowledgment unavailable');
            done = false;
          }
        } else if (stage === 'analytics' || stage === 'sql') {
          const r = await work((tx) =>
            stage === 'analytics' ? d.repo.analytics(tx, l) : d.repo.erase(tx, l),
          );
          if (!r.ok) throw Error('Privacy erasure unavailable');
          done = r.value;
        }
        return work(async (tx) => {
          if (stage && stage !== 'journal' && done)
            await d.repo.finishStage(tx, l, stage, d.crypto.hash('stage', id + ':' + stage));
          if (!stage) {
            await d.repo.complete(tx, l);
            return { status: 'completed' as const };
          }
          await d.repo.release(tx, l);
          return { status: 'processing' as const };
        });
      } catch {
        const failed = await work((tx) => d.repo.failed(tx, l, 'execution_failed'));
        return failed.ok ? ok({ status: 'retry_pending' as const }) : failed;
      }
    },
    queue: () => work((tx) => d.repo.queue(tx)),
    retry: (actor: Id<'staff'>, id: Id<'privacy_request'>, evidence: string) =>
      work((tx) => d.repo.retry(tx, actor, id, evidence)),
    review: (
      actor: Id<'staff'>,
      id: Id<'privacy_request'>,
      decision: 'fulfilled' | 'rejected',
      evidence: string,
    ) => work((tx) => d.repo.review(tx, actor, id, decision, evidence)),
    async sweep(jurisdiction: string, dryRun = true) {
      return work(async (tx) => {
        const targets = await d.repo.retention(tx, dryRun, d.policyVersion, jurisdiction),
          cleanup = await d.repo.cleanup(tx, dryRun);
        const ids: Id<'privacy_request'>[] = [];
        if (!dryRun)
          for (const t of targets)
            ids.push(
              (
                await create(
                  tx,
                  { subjectId: t.subjectId, kind: t.kind, id: t.id },
                  'delete',
                  jurisdiction,
                  null,
                )
              ).id,
            );
        return {
          dryRun,
          counts: { ...cleanup, targets: targets.length } as Readonly<Record<string, number>>,
          requests: ids,
        };
      });
    },
    async replay(
      input: Readonly<{
        runId: Id<'restore'>;
        backupFinishedAt: Instant;
        expectedDigest: string;
        snapshot: unknown;
        jurisdiction: string;
      }>,
    ) {
      try {
        const signed = exact(input.snapshot, 'digest,document,keyVersion'),
          doc = d.crypto.verify(input.snapshot);
        demand(doc, 'forbidden');
        demand(signed.digest === input.expectedDigest, 'forbidden');
        const manifest = exact(doc, 'capturedAt,entries,version');
        demand(
          manifest.version === 1 &&
            typeof manifest.capturedAt === 'string' &&
            instant(manifest.capturedAt).ok,
        );
        const age = Date.parse(d.now()) - Date.parse(manifest.capturedAt);
        demand(
          age >= -5000 &&
            age <= 300000 &&
            Date.parse(manifest.capturedAt) >= Date.parse(input.backupFinishedAt),
          'forbidden',
        );
        demand(Array.isArray(manifest.entries) && manifest.entries.length <= 1000);
        const entries: JournalEntry[] = manifest.entries.map((raw) => {
          const r = exact(raw, 'action,markers,policy,resourceKind,tombstones,version');
          demand(
            r.version === 1 &&
              ['delete', 'restrict', 'opt_out'].includes(String(r.action)) &&
              ['subject', 'report'].includes(String(r.resourceKind)) &&
              typeof r.policy === 'string' &&
              r.policy.length <= 100,
          );
          for (const name of ['markers', 'tombstones'] as const) {
            demand(Array.isArray(r[name]) && r[name].length <= 1000);
            for (const k of r[name]) {
              const v = exact(k, 'digest,keyVersion');
              demand(
                typeof v.digest === 'string' &&
                  /^[a-f0-9]{64}$/.test(v.digest) &&
                  typeof v.keyVersion === 'string' &&
                  (name === 'markers' ? d.crypto.versions : d.contacts.lookupVersions).includes(
                    v.keyVersion,
                  ),
                'forbidden',
              );
            }
          }
          return r as unknown as JournalEntry;
        });
        canonical(entries, 2097152);
        return work(async (tx) => {
          await d.repo.restoreStart(tx, input.runId, input.backupFinishedAt, input.expectedDigest);
          await d.repo.replayMarkers(tx, entries);
          const page = await d.repo.restorePage(tx, input.runId);
          for (const target of page) {
            const action = await d.repo.markedAction(
              tx,
              target.kind,
              d.crypto.markers(target.kind, target.id),
            );
            if (action)
              await create(
                tx,
                { subjectId: target.subjectId, kind: target.kind, id: target.id },
                action,
                input.jurisdiction,
                input.runId,
              );
          }
          const ready = await d.repo.restoreProgress(
            tx,
            input.runId,
            page.length ? targetCursor(page.at(-1)!) : null,
          );
          return { ready, scanned: page.length };
        });
      } catch (e) {
        return fail(serviceFailure(e));
      }
    },
  };
}
function targetCursor(t: { kind: string; id: string }) {
  return t.kind + ':' + t.id;
}
