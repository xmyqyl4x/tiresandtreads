import { ok, fail, id, instant, type Id, type Result } from '../../../domain/src/values/core.ts';
import { partnerPrincipal, type PartnerPrincipal } from '../../../domain/src/partner-policy.ts';
import type {
  PartnerOnboardingRepository,
  PartnerAuthority,
  PartnerClock,
  PartnerCrypto,
  PartnerServicePolicy,
} from '../ports/partner-services.ts';
import type {
  UnitOfWork,
  TransactionContext as Tx,
  ApplicationFailure,
} from '../ports/transactions.ts';
import { failure } from '../ports/transactions.ts';
import { demand, ServiceFault, serviceFailure, serviceWork } from '../services/service-work.ts';
export interface PartnerDependencies {
  readonly uow: UnitOfWork;
  readonly onboarding: PartnerOnboardingRepository;
  readonly authority: PartnerAuthority;
  readonly clock: PartnerClock;
  readonly crypto: PartnerCrypto;
  readonly policy: PartnerServicePolicy;
}
export function capture<T>(input: T): T {
  let nodes = 0;
  const path = new WeakSet<object>();
  function copy(v: unknown, depth: number): unknown {
    demand(++nodes <= 5000 && depth <= 10);
    if (v === null || ['string', 'boolean', 'bigint'].includes(typeof v)) return v;
    if (typeof v === 'number') {
      demand(Number.isFinite(v));
      return v;
    }
    if (v && typeof v === 'object') {
      demand(!path.has(v));
      path.add(v);
      const descriptors = Object.getOwnPropertyDescriptors(v);
      demand(Object.values(descriptors).every((d) => !d.get && !d.set));
      let result: unknown;
      if (Array.isArray(v)) {
        demand(v.length <= 1000);
        result = Object.freeze(v.map((x) => copy(x, depth + 1)));
      } else {
        demand([Object.prototype, null].includes(Object.getPrototypeOf(v)));
        result = Object.freeze(
          Object.fromEntries(
            Object.entries(descriptors).map(([k, d]) => [k, copy(d.value, depth + 1)]),
          ),
        );
      }
      path.delete(v);
      return result;
    }
    throw new ServiceFault('invalid_input');
  }
  return copy(input, 0) as T;
}
export function string(v: unknown, max = 200) {
  demand(
    typeof v === 'string' &&
      v.trim().length > 0 &&
      v.length <= max &&
      !/[<>]/.test(v) &&
      ![...v].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127),
  );
  return v.trim();
}
export function identifier<K extends string>(kind: K, v: unknown): Id<K> {
  const r = id(kind, v);
  demand(r.ok);
  return r.value;
}
export function timestamp(v: unknown) {
  const r = instant(v);
  demand(r.ok);
  return r.value;
}
export function partnerContext(d: PartnerDependencies) {
  const policy = capture(d.policy);
  string(policy.version, 100);
  for (const kind of ['pilot_terms', 'privacy', 'dpa'] as const) {
    string(policy.agreements[kind].version, 100);
    demand(/^[a-f0-9]{64}$/.test(policy.agreements[kind].sha256));
  }
  demand(policy.excludedEmailDomains.length <= 100);
  async function principal(handle: string) {
    string(handle, 2048);
    const proof = await d.authority.verify(handle);
    demand(proof.ok, 'forbidden');
    const p = partnerPrincipal(proof.value, d.clock.now());
    demand(p.ok, 'forbidden');
    return p.value;
  }
  const run = <T>(fn: (tx: Tx) => Promise<T>) => serviceWork(d.uow, async (tx) => ok(await fn(tx)));
  const safe = async <T>(
    fn: () => Promise<Result<T, ApplicationFailure>>,
  ): Promise<Result<T, ApplicationFailure>> => {
    try {
      return await fn();
    } catch (e) {
      return fail(e instanceof ServiceFault ? serviceFailure(e) : failure('unavailable'));
    }
  };
  async function member(
    tx: Tx,
    p: PartnerPrincipal,
    org: Id<'organization'>,
    roles: readonly string[],
    pending = false,
    read = false,
  ) {
    const r = await d.onboarding.lock(tx, org, p.subject);
    demand(
      r.member &&
        roles.includes(r.member.role) &&
        (r.member.status === 'active' ||
          (pending &&
            r.member.role === 'owner' &&
            r.member.status === 'pending' &&
            r.organization.status === 'pending')),
      'forbidden',
    );
    demand(read || ['pending', 'active'].includes(r.organization.status), 'forbidden');
    return r;
  }
  async function staff(
    tx: Tx,
    p: PartnerPrincipal,
    org: Id<'organization'>,
    permission: 'partner.verify' | 'partner.moderate',
    independent = false,
  ) {
    await d.onboarding.staff(tx, p, permission);
    const r = await d.onboarding.lock(tx, org, p.subject);
    demand(!independent || !r.member || r.member.status === 'revoked', 'forbidden');
    return r;
  }
  const audit = (
    tx: Tx,
    p: PartnerPrincipal,
    org: Id<'organization'>,
    action: string,
    resource: string,
    body: unknown,
  ) =>
    d.onboarding.audit(
      tx,
      org,
      d.crypto.digest(['actor', p.subject]),
      action,
      resource,
      d.crypto.digest(body),
    );
  return { policy, principal, run, safe, member, staff, audit };
}
