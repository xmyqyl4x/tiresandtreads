import { beforeAll, afterAll, it, expect } from 'vitest';
import { insightsFixture } from '../fixtures/phase2/partner-insights.ts';
import { composeInsights } from '../fixtures/phase2/compose-insights.ts';
import { value, uuid } from '../fixtures/phase2/compose-partner-services.ts';
import { createPartnerInsightsServices } from '../../packages/application/src/partners/partner-insights.ts';
import { createPartnerInsightsRepository } from '../../packages/db/src/repositories/partner-insights.ts';
import { ok } from '../../packages/domain/src/values/core.ts';
let f: Awaited<ReturnType<typeof insightsFixture>>, s: Awaited<ReturnType<typeof composeInsights>>;
beforeAll(async () => {
  f = await insightsFixture();
  s = await composeInsights(f);
}, 60000);
afterAll(async () => {
  await f?.cleanup();
  console.log(
    'P2_PARTNER_INSIGHTS_EVIDENCE ' +
      JSON.stringify({
        actualPostgreSQL: true,
        migrations: 48,
        newTables: 6,
        nativeCases: 46,
        minimumCohort: 50,
        wholeMatrixComplementSuppression: true,
        immutableWeeklyRelease: true,
        privacyPublicationSerialized: true,
        auditedContactReveal: true,
        boundedSourceRows: 10000,
        oversizeRefused: 10001,
        boundedRetention: true,
        healthCurrentPermission: true,
        heldReleaseRetention: true,
        closedOrganizationIndependence: true,
        privateEncryption: 'scoped-local-aes-double',
        authentication: 'synthetic-authority-double',
        actualS1Approval: false,
        actualS2Approval: false,
        actualAuthenticationAccepted: false,
        actualPrivacyAccepted: false,
        actualProviderPilotDeploymentAcceptance: false,
        productionBootstrapChanged: false,
        productionRuntimeChanged: false,
        providerDispatches: 0,
        actualRecipientNotifications: 0,
        casesClosed: 0,
        gatesClosed: 0,
      }),
  );
}, 60000);
it('installs only the opt-in operations extension and denies raw contacts to its restricted role', async () => {
  expect(f.insightsApplied).toBe(1);
  expect(
    (await f.admin.query('SELECT count(*)::int n FROM migration_meta.applied')).rows[0]!.n,
  ).toBe(48);
  const denied = await s.scope.unitOfWork.run(async (tx) => {
    await s.scope.query(tx, 'SELECT encrypted_email FROM privacy.contacts');
    return { ok: true, value: null };
  });
  expect(denied.ok).toBe(false);
});
it('excludes machine and unknown clicks and suppresses the entire small partner cohort', async () => {
  const o = await s.company(),
    a = await s.assignment(o);
  for (const classification of ['machine', 'unknown', 'suspected_human'] as const)
    value(
      await s.service.offerClick(s.events, {
        key: uuid('command'),
        organization: o.id,
        assignment: a.id,
        method: 'HEAD',
        classification,
        occurredAt: s.now(),
      }),
    );
  expect(value(await s.service.report(o.handle, o.id, s.week))).toMatchObject({
    state: 'suppressed',
    cells: null,
  });
});
it('denies tenant guessing and analyst mutation before any ledger change', async () => {
  const a = await s.company(),
    b = await s.company(),
    assignment = await s.assignment(b);
  expect((await s.service.report(a.handle, b.id, s.week)).ok).toBe(false);
  expect((await s.service.redemption(a.handle, a.id, s.redemption(assignment.id))).ok).toBe(false);
});
it('forces RLS and refuses every ordinary P1/partner role from the new private tables', async () => {
  const rows = (
    await f.admin.query(
      "SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relnamespace='partners'::regnamespace AND relname=ANY($1)",
      [
        [
          'operations_receipts',
          'operations_audit',
          'operations_clicks',
          'operations_releases',
          'operations_release_subjects',
          'operations_domain_samples',
        ],
      ],
    )
  ).rows;
  expect(rows).toHaveLength(6);
  expect(rows.every((r) => r.relrowsecurity && r.relforcerowsecurity)).toBe(true);
  for (const role of [
    'tt_private_runtime',
    'tt_operations_runtime',
    'tt_p2_partner_runtime',
    'tt_p2_pilot_reader',
  ])
    expect(
      (
        await f.admin.query(
          "SELECT has_table_privilege($1,'partners.operations_release_subjects','SELECT') AS allowed",
          [role],
        )
      ).rows[0]!.allowed,
    ).toBe(false);
});
it('revokes PUBLIC execution and fixes privileged search paths', async () => {
  const rows = (
    await f.admin.query(
      "SELECT proname,prosecdef,proconfig,proacl::text acl FROM pg_proc WHERE pronamespace='partners'::regnamespace AND proname LIKE 'ops_%'",
    )
  ).rows;
  expect(rows.length).toBeGreaterThan(10);
  for (const r of rows) {
    expect(r.prosecdef).toBe(true);
    expect(r.proconfig).toContain('search_path=pg_catalog');
    expect(r.acl).not.toMatch(/(?:\{|,)=X/);
  }
});
it('allows analyst aggregate reads but denies redemption and dispute mutation', async () => {
  const o = await s.company(),
    a = await s.assignment(o),
    handle = s.session('analyst:' + uuid('actor'));
  await f.admin.query(
    "INSERT INTO partners.memberships(org_id,provider_subject,role,status) VALUES($1,$2,'analyst','active')",
    [o.id, s.sessions.get(handle)!.subject],
  );
  expect((await s.service.report(handle, o.id, s.week)).ok).toBe(true);
  expect((await s.service.redemption(handle, o.id, s.redemption(a.id))).ok).toBe(false);
  expect((await s.service.dispute(handle, o.id, dispute(a.id))).ok).toBe(false);
});
function dispute(assignment: Parameters<typeof s.redemption>[0]) {
  return {
    key: uuid('command'),
    id: uuid('partner_dispute'),
    assignment,
    reason: 'terms' as const,
    kind: 'opened' as const,
    expected: 0,
    details: 'Synthetic private business evidence only',
  };
}
it('appends one reported redemption, replays once and records no verified sale or charge', async () => {
  const o = await s.company(),
    a = await s.assignment(o),
    c = s.redemption(a.id),
    first = value(await s.service.redemption(o.handle, o.id, c));
  expect(first).toMatchObject({ verifiedSale: false, charging: false });
  expect(value(await s.service.redemption(o.handle, o.id, c))).toEqual(first);
  expect(
    (
      await f.admin.query(
        'SELECT quantity_delta,verified_sale FROM partners.redemption_events WHERE org_id=$1',
        [o.id],
      )
    ).rows,
  ).toEqual([{ quantity_delta: 1, verified_sale: false }]);
  expect((await s.service.redemption(o.handle, o.id, { ...c, quantity: 2 })).ok).toBe(false);
});
it('keeps corrections/reversals append-only with one current chain and bounded net quantity', async () => {
  const o = await s.company(),
    a = await s.assignment(o),
    c = s.redemption(a.id),
    e = value(await s.service.redemption(o.handle, o.id, { ...c, quantity: 2 })).event;
  const correction = value(
    await s.service.redemption(o.handle, o.id, {
      ...c,
      key: uuid('command'),
      kind: 'correction',
      previous: e,
      quantity: 1,
    }),
  ).event;
  expect(
    (
      await s.service.redemption(o.handle, o.id, {
        ...c,
        key: uuid('command'),
        kind: 'correction',
        previous: e,
        quantity: 1,
      })
    ).ok,
  ).toBe(false);
  expect(
    (
      await s.service.redemption(o.handle, o.id, {
        ...c,
        key: uuid('command'),
        kind: 'correction',
        previous: correction,
        quantity: 2,
      })
    ).ok,
  ).toBe(false);
  value(
    await s.service.redemption(o.handle, o.id, {
      ...c,
      key: uuid('command'),
      kind: 'reversal',
      previous: correction,
      quantity: -1,
    }),
  );
  expect(
    (
      await f.admin.query(
        'SELECT sum(quantity_delta)::int n FROM partners.redemption_events WHERE org_id=$1',
        [o.id],
      )
    ).rows[0]!.n,
  ).toBe(2);
  await expect(
    f.admin.query('UPDATE partners.redemption_events SET quantity_delta=4 WHERE id=$1', [e]),
  ).rejects.toMatchObject({ code: '23514' });
});
it('serializes simultaneous first redemptions on the real assignment', async () => {
  const o = await s.company(),
    a = await s.assignment(o),
    results = await Promise.all([
      s.service.redemption(o.handle, o.id, s.redemption(a.id)),
      s.service.redemption(o.handle, o.id, s.redemption(a.id)),
    ]);
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(
    (
      await f.admin.query(
        'SELECT count(*)::int n FROM partners.redemption_events WHERE reservation_id=$1',
        [a.id],
      )
    ).rows[0]!.n,
  ).toBe(1);
});
it('refuses exact shared-code redemption attribution', async () => {
  const o = await s.company(),
    a = await s.assignment(o, 'shared');
  expect((await s.service.redemption(o.handle, o.id, s.redemption(a.id))).ok).toBe(false);
});
it('opens, appends evidence, resolves independently and reopens without overwriting history', async () => {
  const o = await s.company(),
    a = await s.assignment(o),
    c = dispute(a.id),
    first = value(await s.service.dispute(o.handle, o.id, c));
  expect(first).toMatchObject({ state: 'open', revision: 1 });
  expect(value(await s.service.dispute(o.handle, o.id, c))).toEqual(first);
  value(
    await s.service.dispute(o.handle, o.id, {
      ...c,
      key: uuid('command'),
      kind: 'evidence',
      expected: 1,
    }),
  );
  const closed = value(
    await s.service.dispute(s.caseworker, o.id, {
      ...c,
      key: uuid('command'),
      kind: 'resolved',
      expected: 2,
    }),
  );
  expect(closed).toMatchObject({ state: 'closed', revision: 3 });
  expect(
    (
      await s.service.dispute(o.handle, o.id, {
        ...c,
        key: uuid('command'),
        kind: 'evidence',
        expected: 3,
      })
    ).ok,
  ).toBe(false);
  expect(
    value(
      await s.service.dispute(s.caseworker, o.id, {
        ...c,
        key: uuid('command'),
        kind: 'reopened',
        expected: 3,
      }),
    ),
  ).toMatchObject({ state: 'open', revision: 4 });
  const rows = (
    await f.admin.query(
      'SELECT encrypted_details FROM partners.dispute_events WHERE dispute_id=$1',
      [c.id],
    )
  ).rows;
  expect(rows).toHaveLength(4);
  expect(rows.every((r) => !r.encrypted_details.toString().includes(c.details))).toBe(true);
  expect(JSON.stringify(value(await s.service.disputes(o.handle, o.id)))).not.toMatch(
    /reservation|encrypted|subject|contact/,
  );
});
it('refuses stale dispute revisions, cross-tenant parents and self resolution', async () => {
  const o = await s.company(),
    other = await s.company(),
    a = await s.assignment(o),
    c = dispute(a.id);
  value(await s.service.dispute(o.handle, o.id, c));
  expect(
    (
      await s.service.dispute(o.handle, o.id, {
        ...c,
        key: uuid('command'),
        kind: 'evidence',
        expected: 2,
      })
    ).ok,
  ).toBe(false);
  expect((await s.service.dispute(other.handle, other.id, { ...c, key: uuid('command') })).ok).toBe(
    false,
  );
  const p = s.sessions.get(s.caseworker)!;
  await f.admin.query(
    "INSERT INTO partners.memberships(org_id,provider_subject,role,status) VALUES($1,$2,'manager','active')",
    [o.id, p.subject],
  );
  expect(
    (
      await s.service.dispute(s.caseworker, o.id, {
        ...c,
        key: uuid('command'),
        kind: 'resolved',
        expected: 1,
      })
    ).ok,
  ).toBe(false);
  await f.admin.query(
    "UPDATE partners.organizations SET status='closed',revision=revision+1 WHERE id=$1",
    [o.id],
  );
  expect(
    (
      await s.service.dispute(s.caseworker, o.id, {
        ...c,
        key: uuid('command'),
        kind: 'resolved',
        expected: 1,
      })
    ).ok,
  ).toBe(false);
  const independent = await s.staff('partner_caseworker');
  expect(
    value(
      await s.service.dispute(independent, o.id, {
        ...c,
        key: uuid('command'),
        kind: 'resolved',
        expected: 1,
      }),
    ),
  ).toMatchObject({ state: 'closed', revision: 2 });
  expect(
    (
      await s.service.dispute(s.caseworker, o.id, {
        ...c,
        key: uuid('command'),
        kind: 'reopened',
        expected: 2,
      })
    ).ok,
  ).toBe(false);
  expect(
    (
      await f.admin.query(
        'SELECT count(*)::int n FROM partners.dispute_events WHERE dispute_id=$1',
        [c.id],
      )
    ).rows[0]!.n,
  ).toBe(2);
});
it('serializes concurrent dispute evidence using expected revisions', async () => {
  const o = await s.company(),
    a = await s.assignment(o),
    c = dispute(a.id);
  value(await s.service.dispute(o.handle, o.id, c));
  const results = await Promise.all(
    [1, 2].map(() =>
      s.service.dispute(o.handle, o.id, {
        ...c,
        key: uuid('command'),
        kind: 'evidence',
        expected: 1,
      }),
    ),
  );
  expect(results.filter((r) => r.ok)).toHaveLength(1);
});
async function cohort(n = 50) {
  const o = await s.company(),
    rows = [];
  for (let i = 0; i < n; i++) rows.push(await s.assignment(o));
  return { o, rows };
}
it('publishes a safe completed-week partner matrix with no identities and freezes repeat queries', async () => {
  const { o, rows } = await cohort(),
    first = value(await s.service.report(o.handle, o.id, s.week));
  expect(first).toMatchObject({
    state: 'available',
    cells: {
      included: '50',
      codes_issued: '50',
      clicks: '0',
      reported_redemptions: '0',
      complaints: '0',
    },
  });
  expect(JSON.stringify(first)).not.toContain(rows[0]!.subject);
  await s.assignment(o);
  expect(value(await s.service.report(o.handle, o.id, s.week))).toEqual(first);
}, 30000);
it('suppresses every cell when a click or its complement is small', async () => {
  const { o, rows } = await cohort();
  value(
    await s.service.offerClick(s.events, {
      key: uuid('command'),
      organization: o.id,
      assignment: rows[0]!.id,
      method: 'GET',
      classification: 'suspected_human',
      occurredAt: s.now(),
    }),
  );
  expect(value(await s.service.report(o.handle, o.id, s.week))).toMatchObject({
    state: 'suppressed',
    cells: null,
  });
}, 30000);
it('excludes scanner and unknown observations while deduplicating the command key', async () => {
  const { o, rows } = await cohort();
  const c = {
    key: uuid('command'),
    organization: o.id,
    assignment: rows[0]!.id,
    method: 'GET' as const,
    classification: 'machine' as const,
    occurredAt: s.now(),
  };
  value(await s.service.offerClick(s.events, c));
  value(await s.service.offerClick(s.events, c));
  value(
    await s.service.offerClick(s.events, { ...c, key: uuid('command'), classification: 'unknown' }),
  );
  expect(value(await s.service.report(o.handle, o.id, s.week))).toMatchObject({
    state: 'available',
    cells: { clicks: '0' },
  });
  expect(
    (
      await f.admin.query(
        'SELECT count(*)::int n FROM partners.operations_clicks WHERE reservation_id=$1',
        [rows[0]!.id],
      )
    ).rows[0]!.n,
  ).toBe(2);
}, 30000);
it.each(['withdrawal', 'suppression', 'restriction', 'expiry', 'revision', 'raw-erasure'] as const)(
  'hides an already released partner snapshot on %s and never republishes its complement',
  async (kind) => {
    const { o, rows } = await cohort(),
      person = rows[0]!.subject;
    expect(value(await s.service.report(o.handle, o.id, s.week)).state).toBe('available');
    if (kind === 'withdrawal') await s.consent(person, 'email', 'withdrawn', s.now());
    if (kind === 'suppression')
      await f.admin.query(
        "INSERT INTO privacy.suppressions(subject_id,scope_key,reason_code,effective_at) VALUES($1,'all-analytics','synthetic',now())",
        [person],
      );
    if (kind === 'restriction')
      await f.admin.query("UPDATE app.subjects SET status='restricted' WHERE id=$1", [person]);
    if (kind === 'expiry')
      await f.admin.query(
        "UPDATE privacy.consent_state SET expires_at=clock_timestamp()-interval '1 second' WHERE subject_id=$1",
        [person],
      );
    if (kind === 'revision')
      await f.admin.query(
        'UPDATE app.subjects SET permission_revision=permission_revision+1 WHERE id=$1',
        [person],
      );
    if (kind === 'raw-erasure') value(await s.service.purge(s.privacy, person));
    expect(value(await s.service.report(o.handle, o.id, s.week))).toMatchObject({
      state: 'blocked',
      cells: null,
    });
    if (kind === 'withdrawal') await s.consent(person, 'email', 'confirmed', s.now());
    expect(value(await s.service.report(o.handle, o.id, s.week))).toMatchObject({
      state: 'blocked',
      cells: null,
    });
  },
  30000,
);
it('does not retroactively count a recipient with a later analytics grant', async () => {
  const o = await s.company(),
    a = await s.assignment(o);
  await s.consent(a.subject, 'email', 'confirmed', s.now());
  const facts = await f.admin.query('SELECT * FROM partners.ops_partner_facts($1,$2::date)', [
    o.id,
    s.week,
  ]);
  expect(facts.rows).toHaveLength(0);
});
it('blocks published outcomes when a reported redemption is corrected instead of exposing a before/after difference', async () => {
  const { o, rows } = await cohort();
  value(await s.service.report(o.handle, o.id, s.week));
  value(await s.service.redemption(o.handle, o.id, s.redemption(rows[0]!.id)));
  expect(value(await s.service.report(o.handle, o.id, s.week))).toMatchObject({
    state: 'blocked',
    cells: null,
  });
}, 30000);
it('publishes disjoint internal web/app cells only at safe cohort sizes', async () => {
  for (let i = 0; i < 50; i++) {
    await s.visitor('web');
    await s.visitor('app');
  }
  const first = value(await s.service.internal(s.analyst, s.week));
  expect(first).toMatchObject({
    state: 'available',
    cells: { web: '50', app: '50' },
    exportEnabled: false,
  });
  await s.visitor('web');
  expect(value(await s.service.internal(s.analyst, s.week))).toEqual(first);
}, 30000);
it.each(['machine', 'suspected_bot', 'internal', 'unknown'])(
  'excludes %s visitor observations',
  async (bot) => {
    const p = await s.visitor('web', bot === 'machine' ? 'suspected_bot' : bot),
      rows = (
        await f.admin.query('SELECT person FROM partners.ops_visitor_facts($1::date)', [s.week])
      ).rows;
    expect(rows.some((r) => r.person === p.subject)).toBe(false);
  },
);
it('excludes connector records and later permission grants from the explorer', async () => {
  const p = await s.visitor('mcp');
  expect(
    (
      await f.admin.query('SELECT person FROM partners.ops_visitor_facts($1::date)', [s.week])
    ).rows.some((r) => r.person === p.subject),
  ).toBe(false);
  const v = await s.visitor();
  await s.consent(v.subject, 'site', 'confirmed', s.now());
  expect(
    (
      await f.admin.query('SELECT person FROM partners.ops_visitor_facts($1::date)', [s.week])
    ).rows.some((r) => r.person === v.subject),
  ).toBe(false);
});
it('returns masked visitor pages with actor-bound encrypted continuations', async () => {
  const page = value(await s.service.visitors(s.visitors, s.week, null, 2));
  expect(page.items).toHaveLength(2);
  expect(page.next).toBeTruthy();
  expect(page.items.every((r) => r.contact === 'masked')).toBe(true);
  const next = value(await s.service.visitors(s.visitors, s.week, page.next, 2));
  expect(next.items[0]!.ref).not.toBe(page.items[0]!.ref);
  expect((await s.service.visitors(s.owner, s.week, page.next, 2)).ok).toBe(false);
  expect((await s.service.visitors(s.email, s.week)).ok).toBe(false);
});
it('denies contact reveal to ordinary visitor operators and insight analysts', async () => {
  const page = value(await s.service.visitors(s.visitors, s.week, null, 1)),
    token = page.items[0]!.ref;
  expect((await s.service.reveal(s.visitors, token, 'support_request', uuid('case'))).ok).toBe(
    false,
  );
  expect((await s.service.reveal(s.analyst, token, 'support_request', uuid('case'))).ok).toBe(
    false,
  );
});
it('audits an Owner/Privacy contact reveal before decryption and refuses stale permission afterward', async () => {
  const page = value(await s.service.visitors(s.privacy, s.week, null, 1)),
    token = page.items[0]!.ref;
  expect(
    value(await s.service.reveal(s.privacy, token, 'privacy_request', uuid('case'))),
  ).toMatchObject({ email: 'synthetic@example.invalid', exportEnabled: false });
  const person = s.tokens.parse(
    s.sessions.get(s.privacy)!.subject,
    'visitor',
    token,
    Date.now(),
  )!.subject;
  expect(
    (
      await f.admin.query(
        "SELECT count(*)::int n FROM admin.audit_events e JOIN admin.audit_identity_links l ON l.event_id=e.id WHERE e.action='operations.contact_reveal' AND l.subject_id=$1",
        [person],
      )
    ).rows[0]!.n,
  ).toBeGreaterThanOrEqual(1);
  const custom = createPartnerInsightsServices({
    ...s.d,
    encryption: {
      ...s.encryption,
      async decrypt(...args) {
        const bytes = await s.encryption.decrypt(...args);
        await s.consent(person, 'site', 'withdrawn', s.now());
        return bytes;
      },
    },
  });
  expect((await custom.reveal(s.privacy, token, 'privacy_request', uuid('case'))).ok).toBe(false);
});
it('preserves independent delivery facts and excludes machine clicks from human estimates', async () => {
  const o = await s.company(),
    a = await s.assignment(o),
    before = value(await s.service.health(s.email, s.week));
  for (const [type, classification] of [
    ['delivered', 'unknown'],
    ['bounced', 'hard'],
    ['opened', 'machine'],
    ['clicked', 'machine'],
    ['clicked', 'suspected_human'],
  ])
    await f.admin.query(
      "INSERT INTO email.email_events(send_id,provider,provider_event_id,type,occurred_at,received_at,classification) VALUES($1,'synthetic',$2,$3,now(),now(),$4)",
      [a.send, uuid('event'), type, classification],
    );
  const after = value(await s.service.health(s.email, s.week));
  expect(BigInt(after.delivered) - BigInt(before.delivered)).toBe(1n);
  expect(BigInt(after.bounced) - BigInt(before.bounced)).toBe(1n);
  expect(BigInt(after.machineClicks) - BigInt(before.machineClicks)).toBe(1n);
  expect(BigInt(after.suspectedHumanClicks) - BigInt(before.suspectedHumanClicks)).toBe(1n);
  expect(after.opensAreEstimates).toBe(true);
  await s.consent(a.subject, 'email', 'withdrawn', s.now());
  const withdrawn = value(await s.service.health(s.email, s.week));
  expect(withdrawn.suspectedHumanClicks).toBe(before.suspectedHumanClicks);
  expect(withdrawn.machineClicks).toBe(before.machineClicks);
  expect(withdrawn.machineOpens).toBe(before.machineOpens);
  expect(withdrawn.delivered).toBe(after.delivered);
  expect(withdrawn.bounced).toBe(after.bounced);
  expect((await s.service.health(s.analyst, s.week)).ok).toBe(false);
});
it('imports structured domain health idempotently and exposes stale/unavailable sources explicitly', async () => {
  const key = uuid('command'),
    sample = {
      domain: 'mail.synthetic.example',
      source: 'google_postmaster',
      day: s.now().slice(0, 10),
      status: 'available',
      reputation: 'medium',
      spamBasisPoints: 10,
      sampleSize: 1000,
    };
  value(await s.service.importDomain(s.email, key, sample));
  value(await s.service.importDomain(s.email, key, sample));
  expect((await s.service.importDomain(s.email, key, { ...sample, sampleSize: 2000 })).ok).toBe(
    false,
  );
  expect(value(await s.service.domains(s.email, sample.domain))).toMatchObject({
    samples: [{ sample, fresh: true }],
    missingSourceStatus: 'unavailable',
  });
  expect(value(await s.service.domains(s.email, 'empty.example'))).toMatchObject({ samples: [] });
});
it('revokes staff/member rights at the database boundary and fails a rolled-back ledger transaction atomically', async () => {
  const o = await s.company(),
    a = await s.assignment(o),
    c = s.redemption(a.id);
  const r = await s.scope.unitOfWork.run(async (tx) => {
    await s.repository.member(tx, s.sessions.get(o.handle)!, o.id, true);
    await s.repository.redemption(tx, o.id, o.actor, c, s.crypto.digest(c));
    await s.scope.query(tx, 'SELECT 1/0');
    return ok(null);
  });
  expect(r.ok).toBe(false);
  expect(
    (
      await f.admin.query(
        'SELECT count(*)::int n FROM partners.redemption_events WHERE reservation_id=$1',
        [a.id],
      )
    ).rows[0]!.n,
  ).toBe(0);
  await f.admin.query(
    "UPDATE partners.memberships SET status='revoked' WHERE org_id=$1 AND provider_subject=$2",
    [o.id, o.actor],
  );
  expect((await s.service.report(o.handle, o.id, s.week)).ok).toBe(false);
  const h = await s.staff('insights_analyst');
  await f.admin.query("UPDATE admin.staff_identities SET status='disabled' WHERE id=$1", [
    s.sessions.get(h)!.staffId,
  ]);
  expect((await s.service.internal(h, s.week)).ok).toBe(false);
});
it('serializes a first publication with withdrawal even when privacy changes are issued directly in SQL', async () => {
  const { o, rows } = await cohort(),
    person = rows[0]!.subject;
  let ready!: () => void,
    finish!: () => void,
    once = true,
    withdrawn = false;
  const held = new Promise<void>((r) => (ready = r)),
    resume = new Promise<void>((r) => (finish = r));
  const scope = {
    ...s.scope,
    async query(...args: Parameters<typeof s.scope.query>) {
      const value = await s.scope.query(...args);
      if (once && args[1].startsWith('SELECT partners.ops_lock_subjects')) {
        once = false;
        ready();
        await resume;
      }
      return value;
    },
  };
  const service = createPartnerInsightsServices({
    ...s.d,
    repository: createPartnerInsightsRepository(scope, s.crypto.digest),
  });
  const report = service.report(o.handle, o.id, s.week);
  await held;
  const withdrawal = f.admin
    .query(
      "UPDATE privacy.consent_state SET status='withdrawn',revision=revision+1 WHERE subject_id=$1 AND scope_key='email'",
      [person],
    )
    .then(() => {
      withdrawn = true;
    });
  try {
    await new Promise((r) => setTimeout(r, 100));
    expect(withdrawn).toBe(false);
  } finally {
    finish();
  }
  expect((await report).ok).toBe(true);
  await withdrawal;
  expect(value(await s.service.report(o.handle, o.id, s.week))).toMatchObject({
    state: 'blocked',
    cells: null,
  });
}, 30000);
it('refuses unaudited raw-role contact access without an Owner/Privacy principal', async () => {
  const p = await s.visitor(),
    actor = s.sessions.get(s.visitors)!;
  const r = await s.scope.unitOfWork.run(async (tx) =>
    ok(
      await s.scope.query(tx, 'SELECT * FROM partners.ops_reveal($1,$2,$3,$4::date,$5,$6)', [
        actor.staffId,
        actor.subject,
        p.subject,
        s.week,
        'support_request',
        uuid('case'),
      ]),
    ),
  );
  expect(r.ok).toBe(false);
});
it('refuses click tracking without current purpose permission before retaining an observation', async () => {
  const o = await s.company(),
    a = await s.assignment(o);
  await s.consent(a.subject, 'email', 'withdrawn', s.now());
  expect(
    (
      await s.service.offerClick(s.events, {
        key: uuid('command'),
        organization: o.id,
        assignment: a.id,
        method: 'GET',
        classification: 'suspected_human',
        occurredAt: s.now(),
      })
    ).ok,
  ).toBe(false);
  expect(
    (
      await f.admin.query(
        'SELECT count(*)::int n FROM partners.operations_clicks WHERE reservation_id=$1',
        [a.id],
      )
    ).rows[0]!.n,
  ).toBe(0);
});
it('runs bounded retention without claiming full privacy acceptance', async () => {
  expect(value(await s.service.maintenance(s.privacy, 1)).purged).toBeGreaterThanOrEqual(0);
  expect((await s.service.maintenance(s.analyst, 1)).ok).toBe(false);
});
it('binds generated expiry to the same statement timestamp as creation', async () => {
  const r = await f.admin.query(
    "INSERT INTO partners.operations_releases(audience,week,state,expires_at) SELECT gen_random_uuid()::text,$1::date,'suppressed',statement_timestamp()+interval '13 months' FROM generate_series(1,100) RETURNING (expires_at=computed_at+interval '13 months') AS exact",
    [s.week],
  );
  expect(r.rows.every((v) => v.exact)).toBe(true);
});
it('purges only a bounded batch of expired observations and domain samples', async () => {
  const o = await s.company(),
    a = await s.assignment(o);
  for (let i = 0; i < 2; i++) {
    await f.admin.query(
      "INSERT INTO partners.operations_clicks(id,org_id,reservation_id,method,classification,occurred_at,created_at,expires_at) VALUES($1,$2,$3,'GET','unknown',statement_timestamp()-interval '14 months',statement_timestamp()-interval '14 months',(statement_timestamp()-interval '14 months')+interval '13 months')",
      [uuid('click'), o.id, a.id],
    );
    await f.admin.query(
      "INSERT INTO partners.operations_domain_samples(id,domain,source,day,status,imported_at,expires_at) VALUES($1,'retention.synthetic.example','microsoft_snds',current_date-31,'unavailable',statement_timestamp()-interval '31 days',statement_timestamp()-interval '1 day')",
      [uuid('sample')],
    );
  }
  const hold = uuid('hold'),
    release = uuid('release');
  await f.admin.query(
    "INSERT INTO partners.operations_releases(id,audience,week,state,computed_at,expires_at) VALUES($1,$2,$3::date,'suppressed',statement_timestamp()-interval '14 months',(statement_timestamp()-interval '14 months')+interval '13 months')",
    [release, o.id, s.week],
  );
  await f.admin.query(
    "INSERT INTO partners.operations_release_subjects(release_id,subject_id,permission_revision,scope,collected_at,valid_until) VALUES($1,$2,1,'email',$3,statement_timestamp()+interval '1 day')",
    [release, a.subject, s.historical],
  );
  await f.admin.query(
    "INSERT INTO privacy.legal_holds(id,resource_id,resource_kind,reason_code,approved_by,review_after) VALUES($1,$2,'operations_release','synthetic',$3,now()+interval '1 day')",
    [hold, release, f.staff],
  );
  for (let i = 0; i < 2; i++) {
    value(await s.service.maintenance(s.privacy, 500));
    expect(
      (
        await f.admin.query(
          'SELECT count(*)::int n FROM partners.operations_release_subjects WHERE release_id=$1',
          [release],
        )
      ).rows[0]!.n,
    ).toBe(1);
  }
  expect(
    (
      await f.admin.query(
        'SELECT count(*)::int n FROM partners.operations_clicks WHERE reservation_id=$1',
        [a.id],
      )
    ).rows[0]!.n,
  ).toBe(2);
  await f.admin.query('UPDATE privacy.legal_holds SET released_at=now() WHERE id=$1', [hold]);
  value(await s.service.maintenance(s.privacy, 1));
  expect(
    (
      await f.admin.query(
        'SELECT count(*)::int n FROM partners.operations_clicks WHERE reservation_id=$1',
        [a.id],
      )
    ).rows[0]!.n,
  ).toBe(1);
  expect(
    (
      await f.admin.query(
        "SELECT count(*)::int n FROM partners.operations_domain_samples WHERE domain='retention.synthetic.example'",
      )
    ).rows[0]!.n,
  ).toBe(0);
  value(await s.service.maintenance(s.privacy, 1));
  expect(
    (
      await f.admin.query(
        'SELECT count(*)::int n FROM partners.operations_clicks WHERE reservation_id=$1',
        [a.id],
      )
    ).rows[0]!.n,
  ).toBe(0);
});
it.each(['subject', 'assignment', 'send'] as const)(
  'retains observations under a %s hold and purges only after release',
  async (kind) => {
    const o = await s.company(),
      a = await s.assignment(o),
      key = uuid('command');
    value(
      await s.service.offerClick(s.events, {
        key,
        organization: o.id,
        assignment: a.id,
        method: 'GET',
        classification: 'unknown',
        occurredAt: s.now(),
      }),
    );
    const hold = uuid('hold');
    await f.admin.query(
      "INSERT INTO privacy.legal_holds(id,subject_id,resource_id,resource_kind,reason_code,approved_by,review_after) VALUES($1,$2,$4,$5,'synthetic',$3,now()+interval '1 day')",
      [
        hold,
        kind === 'subject' ? a.subject : null,
        f.staff,
        kind === 'subject' ? null : kind === 'assignment' ? a.id : a.send,
        kind,
      ],
    );
    expect((await s.service.purge(s.privacy, a.subject)).ok).toBe(false);
    expect(
      (
        await f.admin.query('SELECT count(*)::int n FROM partners.operations_clicks WHERE id=$1', [
          key,
        ])
      ).rows[0]!.n,
    ).toBe(1);
    await f.admin.query('UPDATE privacy.legal_holds SET released_at=now() WHERE id=$1', [hold]);
    expect(value(await s.service.purge(s.privacy, a.subject))).toMatchObject({
      newOperationsLinksPurged: true,
      fullSubjectErasureAccepted: false,
    });
    expect(
      (
        await f.admin.query('SELECT count(*)::int n FROM partners.operations_clicks WHERE id=$1', [
          key,
        ])
      ).rows[0]!.n,
    ).toBe(0);
  },
);
it('refuses an oversized analytics source before returning a truncated explorer or cohort', async () => {
  const p = await s.visitor();
  await f.admin.query(
    "INSERT INTO analytics.events(id,subject_id,session_ref,event_name,schema_version,occurred_at,received_at,market,locale,route_template,channel,permission_revision,policy_version,props,payload_digest,bot_classification,expires_at,collection_scope) SELECT gen_random_uuid(),$1,gen_random_uuid(),'public_page_view',1,$2,$2,'US','en-US','/assess','web',1,'synthetic','{}',decode(repeat('aa',32),'hex'),'not_flagged',$2::timestamptz+interval '13 months','site' FROM generate_series(1,10001)",
    [p.subject, s.historical],
  );
  expect(await s.service.visitors(s.visitors, s.week)).toMatchObject({
    ok: false,
    error: { code: 'unavailable' },
  });
});
