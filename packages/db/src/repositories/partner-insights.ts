import type {
  PartnerInsightsRepository,
  InsightRelease,
  DisputeSummary,
  DeliveryHealth,
} from '../../../application/src/ports/partner-insights.ts';
import type { DomainSample } from '../../../domain/src/partner-insights-policy.ts';
import { suppressCells } from '../../../domain/src/partner-insights-policy.ts';
import type { TransactionContext as Tx } from '../../../application/src/ports/transactions.ts';
import { guarded, stop, type WriteScope } from './mutations.ts';
import { uid, word, integer, at, sha } from './partner-service-values.ts';
type Row = Record<string, unknown>;
const partnerKeys = ['included', 'codes_issued', 'clicks', 'reported_redemptions', 'complaints'],
  internalKeys = ['web', 'app'];
function summary(row: Row): DisputeSummary {
  const state = word(row.state);
  if (!['open', 'reviewing', 'closed'].includes(state)) return stop('integrity');
  return Object.freeze({
    id: uid('partner_dispute', row.id),
    reason: word(row.reason_code),
    state: state as DisputeSummary['state'],
    revision: integer(row.revision, 1, 10001),
    createdAt: at(row.created_at),
  });
}
function count(v: unknown) {
  if (typeof v !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(v)) return stop('integrity');
  return v;
}
export function createPartnerInsightsRepository(
  s: WriteScope,
  digest: (v: unknown) => string,
): PartnerInsightsRepository {
  const q = s.query;
  async function receipt(tx: Tx, scope: string, key: string, action: string, hash: string) {
    const r = (
      await q(
        tx,
        'SELECT action,request_hash,result FROM partners.operations_receipts WHERE scope=$1 AND command_id=$2',
        [scope, uid('command', key)],
      )
    ).rows[0];
    if (r && (r.action !== action || r.request_hash !== sha(hash))) return stop('conflict');
    return r?.result as Row | undefined;
  }
  async function save(
    tx: Tx,
    scope: string,
    key: string,
    action: string,
    hash: string,
    result: unknown,
  ) {
    await q(
      tx,
      'INSERT INTO partners.operations_receipts(scope,command_id,action,request_hash,result) VALUES($1,$2,$3,$4,$5)',
      [scope, key, action, hash, JSON.stringify(result)],
    );
  }
  async function audit(tx: Tx, actor: string, action: string, resource: string, hash: string) {
    await q(
      tx,
      'INSERT INTO partners.operations_audit(actor_hash,action,resource_hash,change_hash) VALUES($1,$2,$3,$4)',
      [sha(digest(['actor', actor])), action, sha(digest(['resource', resource])), sha(hash)],
    );
  }
  async function source(tx: Tx, organization: string | null, week: string) {
    return (
      await q(
        tx,
        organization === null
          ? 'SELECT *,revision::text AS revision FROM partners.ops_visitor_facts($1::date) ORDER BY person'
          : 'SELECT *,revision::text AS revision FROM partners.ops_partner_facts($2::uuid,$1::date) ORDER BY person',
        organization === null ? [week] : [week, organization],
      )
    ).rows;
  }
  async function readRelease(
    tx: Tx,
    audience: string,
    week: string,
  ): Promise<InsightRelease | null> {
    let row = (
      await q(
        tx,
        'SELECT * FROM partners.operations_releases WHERE audience=$1 AND week=$2::date',
        [audience, week],
      )
    ).rows[0];
    if (!row) return null;
    const people = (
      await q(
        tx,
        'SELECT subject_id FROM partners.operations_release_subjects WHERE release_id=$1 ORDER BY subject_id',
        [row.id],
      )
    ).rows;
    await q(tx, 'SELECT partners.ops_lock_subjects($1::uuid[])', [people.map((r) => r.subject_id)]);
    // Re-read after the subject locks. A privacy transaction may have invalidated/purged it.
    row =
      (
        await q(
          tx,
          `UPDATE partners.operations_releases r SET state='blocked',cells=NULL WHERE r.id=$1 AND r.state<>'blocked' AND
      (r.expires_at<=clock_timestamp() OR EXISTS(SELECT 1 FROM partners.operations_release_subjects m WHERE m.release_id=r.id AND (m.valid_until<=clock_timestamp() OR NOT partners.ops_permitted(m.subject_id,m.scope,m.collected_at,m.permission_revision)))) RETURNING *`,
          [row.id],
        )
      ).rows[0] ??
      (
        await q(
          tx,
          'SELECT * FROM partners.operations_releases WHERE audience=$1 AND week=$2::date',
          [audience, week],
        )
      ).rows[0]!;
    if (!['available', 'suppressed', 'blocked'].includes(String(row.state)))
      return stop('integrity');
    const keys = audience === 'internal' ? internalKeys : partnerKeys;
    let cells: Readonly<Record<string, string>> | null = null;
    if (row.state === 'available') {
      if (
        !row.cells ||
        typeof row.cells !== 'object' ||
        Object.keys(row.cells).sort().join() !== [...keys].sort().join()
      )
        return stop('integrity');
      cells = Object.freeze(Object.fromEntries(keys.map((k) => [k, count((row.cells as Row)[k])])));
    }
    return Object.freeze({
      week,
      state: row.state as InsightRelease['state'],
      computedAt: at(row.computed_at),
      cells,
    });
  }
  async function assignment(tx: Tx, org: string, id: string, unique = true) {
    const row = (
      await q(tx, 'SELECT partners.ops_assignment($1,$2,$3) AS value', [
        uid('organization', org),
        uid('coupon_assignment', id),
        unique,
      ])
    ).rows[0]?.value;
    return row && typeof row === 'object' ? (row as Row) : stop('forbidden');
  }
  async function disputeRow(tx: Tx, org: string, id: string) {
    return (
      (
        await q(
          tx,
          `SELECT d.id,d.reason_code,d.state,d.created_at,(SELECT count(*)::int FROM partners.dispute_events e WHERE e.org_id=d.org_id AND e.dispute_id=d.id) AS revision FROM partners.disputes d WHERE d.org_id=$1 AND d.id=$2`,
          [org, id],
        )
      ).rows[0] ?? stop('conflict')
    );
  }
  return guarded<PartnerInsightsRepository>(s, {
    async member(tx, p, org, write) {
      if (
        (
          await q(tx, 'SELECT partners.ops_member($1,$2,$3) AS ok', [
            uid('organization', org),
            word(p.subject),
            write,
          ])
        ).rows[0]?.ok !== true
      )
        return stop('forbidden');
    },
    async staff(tx, p, permission) {
      if (
        !p.staffId ||
        (
          await q(tx, 'SELECT partners.ops_staff($1,$2,$3) AS ok', [
            uid('staff', p.staffId),
            word(p.subject),
            permission,
          ])
        ).rows[0]?.ok !== true
      )
        return stop('forbidden');
    },
    async release(tx, organization, week) {
      const audience = organization === null ? 'internal' : uid('organization', organization),
        prior = await readRelease(tx, audience, week);
      if (prior) return prior;
      const rows = await source(tx, organization, week);
      await q(tx, 'SELECT partners.ops_lock_subjects($1::uuid[])', [rows.map((r) => r.person)]);
      const current = await source(tx, organization, week);
      if (JSON.stringify(rows) !== JSON.stringify(current)) return stop('conflict');
      const keys = organization === null ? internalKeys : partnerKeys,
        counts = Object.fromEntries(
          keys.map((k) => [
            k,
            BigInt(
              rows.filter((r) => (organization === null ? r.first_channel === k : r[k] === true))
                .length,
            ),
          ]),
        ),
        masked = suppressCells(BigInt(rows.length), counts);
      const created = (
        await q(
          tx,
          `INSERT INTO partners.operations_releases(audience,week,state,cells,expires_at) VALUES($1,$2::date,$3,$4,statement_timestamp()+interval '13 months') ON CONFLICT(audience,week) DO NOTHING RETURNING id`,
          [
            audience,
            week,
            masked.state,
            masked.cells === null ? null : JSON.stringify(masked.cells),
          ],
        )
      ).rows[0];
      if (created && rows.length)
        await q(
          tx,
          `INSERT INTO partners.operations_release_subjects(release_id,subject_id,permission_revision,scope,collected_at,valid_until) SELECT $1,b.person,b.revision,$2,b.collected,b.valid_until FROM jsonb_to_recordset($3::jsonb) b(person uuid,revision bigint,collected timestamptz,valid_until timestamptz)`,
          [
            created.id,
            organization === null ? 'site' : 'email',
            JSON.stringify(
              rows.map((r) => ({
                person: r.person,
                revision: r.revision,
                collected: r.collected,
                valid_until: r.valid_until,
              })),
            ),
          ],
        );
      return (await readRelease(tx, audience, week)) ?? stop('integrity');
    },
    async redemption(tx, org, actor, input, hash) {
      const a = await assignment(tx, org, input.assignment),
        old = await receipt(tx, org, input.key, 'redemption', hash);
      if (old) return uid('redemption_event', old.event);
      const events = (
          await q(
            tx,
            'SELECT id,quantity_delta,reverses_event_id FROM partners.redemption_events WHERE org_id=$1 AND reservation_id=$2',
            [org, input.assignment],
          )
        ).rows,
        net = events.reduce((n, e) => n + Number(e.quantity_delta), 0),
        parent = events.find((e) => e.id === input.previous);
      if (
        input.kind === 'reported'
          ? events.length !== 0
          : !parent || events.some((e) => e.reverses_event_id === input.previous)
      )
        return stop('conflict');
      if (
        net + input.quantity < 0 ||
        net + input.quantity > 4 ||
        (input.kind === 'reversal' && input.quantity !== -Number(parent!.quantity_delta))
      )
        return stop('invalid_input');
      const event = (
        await q(
          tx,
          `INSERT INTO partners.redemption_events(org_id,reservation_id,offer_id,offer_version,external_event_key,kind,quantity_delta,reverses_event_id,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [
            org,
            input.assignment,
            a.offer,
            a.version,
            input.key,
            input.kind,
            input.quantity,
            input.previous,
            input.occurredAt,
          ],
        )
      ).rows[0]!;
      await audit(tx, actor, 'partner.redemption.' + input.kind, String(event.id), hash);
      await save(tx, org, input.key, 'redemption', hash, { event: event.id });
      return uid('redemption_event', event.id);
    },
    async dispute(tx, org, actor, input, details, hash) {
      const isMember =
        (await q(tx, 'SELECT partners.ops_member($1,$2,false) AS member', [org, actor.subject]))
          .rows[0]?.member === true;
      if ((input.kind === 'resolved' || input.kind === 'reopened') && isMember)
        return stop('forbidden');
      await assignment(tx, org, input.assignment, false);
      const old = await receipt(tx, org, input.key, 'dispute', hash);
      if (old) return summary({ ...old, created_at: old.createdAt, reason_code: old.reason });
      if (!/^[a-f0-9]{64,16384}$/.test(details.hex) || details.hex.length % 2)
        return stop('invalid_input');
      let prior = (
        await q(
          tx,
          'SELECT id,reservation_id,reason_code,state FROM partners.disputes WHERE org_id=$1 AND id=$2 FOR UPDATE',
          [org, input.id],
        )
      ).rows[0];
      if (input.kind === 'opened') {
        if (prior) return stop('conflict');
        await q(
          tx,
          `INSERT INTO partners.disputes(id,org_id,reservation_id,reason_code,encrypted_details,key_version) VALUES($1,$2,$3,$4,decode($5,'hex'),$6)`,
          [
            input.id,
            org,
            input.assignment,
            input.reason,
            details.hex,
            word(details.keyVersion, 100),
          ],
        );
        prior = { state: 'open', reservation_id: input.assignment, reason_code: input.reason };
      } else {
        if (
          !prior ||
          prior.reservation_id !== input.assignment ||
          prior.reason_code !== input.reason
        )
          return stop('conflict');
        const count = (
          await q(
            tx,
            'SELECT count(*)::int n FROM partners.dispute_events WHERE org_id=$1 AND dispute_id=$2',
            [org, input.id],
          )
        ).rows[0]!.n;
        if (
          count !== input.expected ||
          (input.kind === 'reopened' ? prior.state !== 'closed' : prior.state === 'closed')
        )
          return stop('conflict');
      }
      const e = (
        await q(
          tx,
          `INSERT INTO partners.dispute_events(org_id,dispute_id,kind,encrypted_details,key_version,actor_staff_id) VALUES($1,$2,$3,decode($4,'hex'),$5,$6) RETURNING id`,
          [org, input.id, input.kind, details.hex, details.keyVersion, actor.staffId],
        )
      ).rows[0]!;
      if (input.kind === 'resolved')
        await q(
          tx,
          "UPDATE partners.disputes SET state='closed',resolution_event_id=$3,closed_at=clock_timestamp() WHERE org_id=$1 AND id=$2",
          [org, input.id, e.id],
        );
      if (input.kind === 'reopened')
        await q(
          tx,
          "UPDATE partners.disputes SET state='open',resolution_event_id=NULL,closed_at=NULL WHERE org_id=$1 AND id=$2",
          [org, input.id],
        );
      const result = summary(await disputeRow(tx, org, input.id));
      await audit(tx, actor.subject, 'partner.dispute.' + input.kind, input.id, hash);
      await save(tx, org, input.key, 'dispute', hash, result);
      return result;
    },
    async disputes(tx, org, after, limit) {
      if (integer(limit, 1, 50) !== limit) return stop('invalid_input');
      return Object.freeze(
        (
          await q(
            tx,
            `SELECT d.id,d.reason_code,d.state,d.created_at,(SELECT count(*)::int FROM partners.dispute_events e WHERE e.org_id=d.org_id AND e.dispute_id=d.id) AS revision FROM partners.disputes d WHERE d.org_id=$1 AND ($2::uuid IS NULL OR d.id>$2) ORDER BY d.id LIMIT $3`,
            [uid('organization', org), after, limit],
          )
        ).rows.map(summary),
      );
    },
    async click(tx, actor, input, hash) {
      await assignment(tx, input.organization, input.assignment, false);
      if (
        (
          await q(tx, 'SELECT partners.ops_allow_click($1,$2,$3) AS ok', [
            input.organization,
            input.assignment,
            input.occurredAt,
          ])
        ).rows[0]?.ok !== true
      )
        return stop('forbidden');
      if (await receipt(tx, input.organization, input.key, 'click', hash)) return;
      await q(
        tx,
        'INSERT INTO partners.operations_clicks(id,org_id,reservation_id,method,classification,occurred_at) VALUES($1,$2,$3,$4,$5,$6)',
        [
          input.key,
          input.organization,
          input.assignment,
          input.method,
          input.classification,
          input.occurredAt,
        ],
      );
      await audit(tx, actor, 'operations.offer.click', input.key, hash);
      await save(tx, input.organization, input.key, 'click', hash, { recorded: true });
    },
    async health(tx, week) {
      const value = (await q(tx, 'SELECT partners.ops_health($1::date) AS value', [week])).rows[0]!
        .value as Row;
      const keys = [
        'accepted',
        'uncertain',
        'delivered',
        'bounced',
        'complained',
        'suspectedHumanOpens',
        'machineOpens',
        'unknownOpens',
        'suspectedHumanClicks',
        'machineClicks',
        'unknownClicks',
      ];
      return Object.freeze(
        Object.fromEntries(keys.map((k) => [k, count(value[k])])),
      ) as unknown as DeliveryHealth;
    },
    async importDomain(tx, key, actor, sample, hash) {
      if (await receipt(tx, 'staff', key, 'domain', hash)) return;
      await q(
        tx,
        'INSERT INTO partners.operations_domain_samples(id,domain,source,day,status,reputation,spam_basis_points,sample_size) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          key,
          sample.domain,
          sample.source,
          sample.day,
          sample.status,
          sample.reputation,
          sample.spamBasisPoints,
          sample.sampleSize,
        ],
      );
      await audit(tx, actor, 'operations.domain.import', key, hash);
      await save(tx, 'staff', key, 'domain', hash, { imported: true });
    },
    async domains(tx, domain) {
      const rows = (
        await q(
          tx,
          `SELECT DISTINCT ON(source) domain,source,day::text AS day,status,reputation,spam_basis_points,sample_size,imported_at, (day>=((clock_timestamp() AT TIME ZONE 'UTC')::date-2) AND expires_at>clock_timestamp()) AS fresh FROM partners.operations_domain_samples WHERE domain=$1 ORDER BY source,day DESC,imported_at DESC,id DESC`,
          [word(domain, 253)],
        )
      ).rows;
      return Object.freeze(
        rows.map((r) =>
          Object.freeze({
            sample: Object.freeze({
              domain: String(r.domain),
              source: r.source as DomainSample['source'],
              day: String(r.day),
              status: r.status as DomainSample['status'],
              reputation: r.reputation as DomainSample['reputation'],
              spamBasisPoints:
                r.spam_basis_points === null ? null : integer(r.spam_basis_points, 0, 10000),
              sampleSize: r.sample_size === null ? null : integer(r.sample_size, 1, 1000000000),
            }),
            importedAt: at(r.imported_at),
            fresh: r.fresh === true,
          }),
        ),
      );
    },
    async visitors(tx, week, after, limit) {
      integer(limit, 1, 51);
      return Object.freeze(
        (
          await q(
            tx,
            'SELECT *,sessions::text AS sessions,events::text AS events FROM partners.ops_visitor_facts($1::date) WHERE ($2::uuid IS NULL OR person>$2) ORDER BY person LIMIT $3',
            [week, after, limit],
          )
        ).rows.map((r) =>
          Object.freeze({
            subject: uid('subject', r.person),
            lastSeen: at(r.last_seen),
            sessions: count(r.sessions),
            events: count(r.events),
            routes: Object.freeze((r.routes as string[]).map((v) => word(v))),
            channels: Object.freeze(r.channels as string[]),
          }),
        ),
      );
    },
    async reveal(tx, actor, subject, week, reason, caseId) {
      const r = (
        await q(
          tx,
          'SELECT *,revision::text AS revision FROM partners.ops_reveal($1,$2,$3,$4::date,$5,$6)',
          [actor.staffId, actor.subject, subject, week, reason, caseId],
        )
      ).rows[0];
      if (!r) return null;

      return Object.freeze({
        id: uid('contact', r.id),
        revision: count(r.revision),
        envelope: Object.freeze({ keyVersion: word(r.key_version, 100), hex: word(r.hex, 131072) }),
      });
    },
    async purge(tx, subject, actor) {
      await q(tx, 'SELECT partners.ops_purge($1)', [subject]);
      await audit(tx, actor, 'operations.links.purge', subject, sha(digest(['purge', subject])));
    },
    async maintenance(tx, limit) {
      integer(limit, 1, 500);
      let total = 0;
      for (const sql of [
        `WITH b AS(SELECT id FROM partners.operations_clicks WHERE expires_at<=clock_timestamp() AND NOT partners.ops_observation_held(id) ORDER BY expires_at,id LIMIT $1 FOR UPDATE SKIP LOCKED) DELETE FROM partners.operations_clicks d USING b WHERE d.id=b.id`,
        `WITH b AS(SELECT id FROM partners.operations_domain_samples WHERE expires_at<=clock_timestamp() ORDER BY expires_at,id LIMIT $1 FOR UPDATE SKIP LOCKED) DELETE FROM partners.operations_domain_samples d USING b WHERE d.id=b.id`,
        `WITH b AS(SELECT id FROM partners.operations_releases WHERE expires_at<=clock_timestamp() AND state<>'blocked' ORDER BY expires_at,id LIMIT $1 FOR UPDATE SKIP LOCKED) UPDATE partners.operations_releases r SET state='blocked',cells=NULL FROM b WHERE r.id=b.id`,
        `WITH b AS(SELECT s.release_id,s.subject_id FROM partners.operations_release_subjects s JOIN partners.operations_releases r ON r.id=s.release_id WHERE r.expires_at<=clock_timestamp() ORDER BY s.release_id,s.subject_id LIMIT $1 FOR UPDATE OF s SKIP LOCKED) DELETE FROM partners.operations_release_subjects s USING b WHERE s.release_id=b.release_id AND s.subject_id=b.subject_id`,
      ])
        total += (await q(tx, sql, [limit])).rowCount;
      return total;
    },
  });
}
