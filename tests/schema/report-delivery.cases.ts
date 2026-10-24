import { randomBytes, randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import pg from 'pg';
import type { DatabaseRole } from '../../scripts/database/bootstrap.ts';

const hash = 'b'.repeat(64);
const future = () => new Date(Date.now() + 3600000);

export function registerReportDeliveryTests(
  clients: () => Record<DatabaseRole, pg.Client>,
  ownerUrl: () => string,
) {
  function scenario(name: string, test: (f: Awaited<ReturnType<typeof fixture>>) => Promise<void>) {
    it(`P1-PR-006 ${name}`, async () => {
      const db = clients().tt_app_migrator;
      await db.query('BEGIN');
      try {
        await test(await fixture(db));
      } finally {
        await db.query('ROLLBACK');
      }
    });
  }

  async function fixture(db: pg.Client) {
    async function insert(table: string, values: Record<string, unknown>) {
      if (!/^(app|privacy|email|admin)\.[a-z_]+$/.test(table)) throw new Error('Invalid table');
      if (Object.keys(values).some((key) => !/^[a-z_]+$/.test(key)))
        throw new Error('Invalid column');
      const result = await db.query(
        `INSERT INTO ${table} (${Object.keys(values).join(',')}) VALUES (${Object.keys(values)
          .map((_, i) => `$${i + 1}`)
          .join(',')}) RETURNING *`,
        Object.values(values),
      );
      return result.rows[0] as Record<string, unknown> & { id: string };
    }
    async function denied(sql: string, values: unknown[], code = '23514', constraint?: string) {
      await db.query('SAVEPOINT expected_denial');
      try {
        await expect(db.query(sql, values)).rejects.toMatchObject({
          code,
          ...(constraint ? { constraint } : {}),
        });
      } finally {
        await db.query('ROLLBACK TO SAVEPOINT expected_denial');
        await db.query('RELEASE SAVEPOINT expected_denial');
      }
    }
    const subject = (await insert('app.subjects', { kind: 'guest' })).id;
    const stranger = (await insert('app.subjects', { kind: 'guest' })).id;
    const bundle = (
      await insert('app.dataset_bundles', { market: 'US', manifest_hash: hash, status: 'staging' })
    ).id;
    const rule = (
      await insert('app.rule_versions', {
        kind: 'synthetic',
        version: '1',
        document: {},
        document_hash: hash,
        schema_version: 1,
        status: 'draft',
      })
    ).id;
    async function report(owner = subject) {
      const id = (
        await insert('app.reports', {
          owner_subject_id: owner,
          market: 'US',
          locale: 'en-US',
          expires_at: future(),
        })
      ).id;
      await insert('app.report_versions', {
        report_id: id,
        version: 1,
        bundle_id: bundle,
        rule_version_id: rule,
        engine_version: 'synthetic',
        schema_version: 1,
        input_snapshot: {},
        output_snapshot: {},
        snapshot_hash: hash,
      });
      await db.query("UPDATE app.reports SET current_version=1,status='active' WHERE id=$1", [id]);
      return id;
    }
    const reportId = await report();
    const otherReport = await report(stranger);
    const notice = (
      await insert('privacy.notices', {
        purpose: 'offers',
        market_policy: 'synthetic',
        version: '1',
        content_hash: hash,
        published_at: new Date(),
        content_ref: 'notices/synthetic-v1',
      })
    ).id;
    const contact = (
      await insert('privacy.contacts', {
        subject_id: stranger,
        encrypted_email: Buffer.from('synthetic-encrypted-envelope'),
        key_version: 'test-1',
        status: 'active',
      })
    ).id;
    const template = (
      await insert('email.template_versions', {
        template_key: 'report',
        version: '1',
        locale: 'en-US',
        purpose: 'report',
        renderer_hash: hash,
        status: 'draft',
      })
    ).id;
    const token = () => ({
      token_hash: randomBytes(32),
      key_version: 'test-1',
      expires_at: future(),
    });
    const sendValues = () => {
      const deadline = new Date(Date.now() + 60000);
      return {
        kind: 'report',
        recipient_contact_id: contact,
        owner_subject_id: subject,
        report_id: reportId,
        report_version: 1,
        template_id: template,
        send_after: deadline,
        cancel_deadline: deadline,
        provider_key: randomUUID(),
        provider: 'synthetic',
        requested_purposes: JSON.stringify(['report']),
        dispatch_policy_version: 'test-1',
      };
    };
    async function asset(view = 'shared') {
      const id = (
        await insert('app.object_assets', {
          purpose: 'report_pdf',
          bucket: 'synthetic-private',
          object_key: `assets/${randomUUID()}`,
          mime_type: 'application/pdf',
        })
      ).id;
      await insert('app.report_assets', {
        asset_id: id,
        report_id: reportId,
        report_version: 1,
        renderer_version: 'test-1',
        locale: 'en-US',
        view_scope: view,
        render_key: randomUUID(),
      });
      return id;
    }
    return {
      db,
      insert,
      denied,
      subject,
      stranger,
      reportId,
      otherReport,
      report,
      bundle,
      rule,
      notice,
      contact,
      template,
      token,
      sendValues,
      asset,
    };
  }

  scenario(
    'UC03 DB01 defers the circular pointer and rejects a missing version at validation',
    async (f) => {
      const id = (
        await f.insert('app.reports', {
          owner_subject_id: f.subject,
          market: 'US',
          locale: 'en-US',
          status: 'active',
          current_version: 2,
          expires_at: future(),
        })
      ).id;
      await f.denied('SET CONSTRAINTS app.reports_current_version_fk IMMEDIATE', [], '23503');
      await f.insert('app.report_versions', {
        report_id: id,
        version: 2,
        bundle_id: f.bundle,
        rule_version_id: f.rule,
        engine_version: 'test',
        schema_version: 1,
        input_snapshot: {},
        output_snapshot: {},
        snapshot_hash: hash,
      });
      await f.db.query('SET CONSTRAINTS ALL IMMEDIATE');
      await f.denied('UPDATE app.reports SET current_version=9 WHERE id=$1', [id], '23503');
    },
  );
  scenario(
    'UC03 DB01 preserves historical snapshots and validates base/draft references',
    async (f) => {
      await f.denied("UPDATE app.report_versions SET output_snapshot='{}' WHERE report_id=$1", [
        f.reportId,
      ]);
      await f.denied(
        "INSERT INTO app.report_drafts(report_id,base_version,input,schema_version,expires_at) VALUES($1,2,'{}',1,$2)",
        [f.reportId, future()],
        '23503',
      );
      await f.insert('app.report_drafts', {
        report_id: f.reportId,
        base_version: 1,
        input: {},
        schema_version: 1,
        expires_at: future(),
      });
      await f.denied('UPDATE app.report_drafts SET revision=0 WHERE report_id=$1', [f.reportId]);
      await f.denied('UPDATE app.report_versions SET base_version=1 WHERE report_id=$1', [
        f.reportId,
      ]);
    },
  );
  scenario(
    'UC04 DB02 rejects fifth comparison slots and duplicate source identities',
    async (f) => {
      await f.insert('app.comparisons', {
        report_id: f.reportId,
        report_version: 1,
        revision: 1,
        scenario: {},
        schema_version: 1,
        snapshot_hash: hash,
      });
      for (let slot = 1; slot <= 4; slot++)
        await f.insert('app.comparison_items', {
          report_id: f.reportId,
          report_version: 1,
          comparison_revision: 1,
          slot,
          source_key: `sku-${slot}`,
          kind: 'catalog',
          snapshot: {},
        });
      await f.denied(
        "INSERT INTO app.comparison_items VALUES($1,1,1,5,'sku-5','catalog','{}',now())",
        [f.reportId],
      );
      await f.db.query('DELETE FROM app.comparison_items WHERE report_id=$1 AND slot=4', [
        f.reportId,
      ]);
      await f.denied(
        "INSERT INTO app.comparison_items(report_id,report_version,comparison_revision,slot,source_key,kind,snapshot) VALUES($1,1,1,4,'sku-1','catalog','{}')",
        [f.reportId],
        '23505',
      );
      await f.denied('UPDATE app.comparisons SET schema_version=2 WHERE report_id=$1', [
        f.reportId,
      ]);
    },
  );
  scenario(
    'UC02 bounds pick ranks and quote quantities and preserves unknown SKU references',
    async (f) => {
      await f.insert('app.report_items', {
        report_id: f.reportId,
        report_version: 1,
        item_key: 'pick',
        kind: 'picked',
        rank: 1,
        snapshot: {},
      });
      await f.denied(
        "INSERT INTO app.report_items(report_id,report_version,item_key,kind,rank,snapshot) VALUES($1,1,'second','picked',1,'{}')",
        [f.reportId],
        '23505',
      );
      await f.denied(
        "INSERT INTO app.report_items(report_id,report_version,item_key,kind,rank,snapshot) VALUES($1,1,'sixth','picked',6,'{}')",
        [f.reportId],
      );
      const quote = await f.insert('app.shop_quotes', {
        report_id: f.reportId,
        source_key: 'unknown',
        currency: 'USD',
        total_minor: 0,
        quantity: 4,
        basis: 'set',
        observed_on: '2026-01-01',
        components: JSON.stringify([]),
        expires_at: future(),
      });
      expect(quote.sku_id).toBeNull();
      await f.denied('UPDATE app.shop_quotes SET quantity=0 WHERE id=$1', [quote.id]);
    },
  );
  scenario(
    'UC05 DB15 rejects wrong-owner, wrong-report and owner-only asset download references',
    async (f) => {
      const session = (
        await f.insert('app.owner_sessions', { subject_id: f.stranger, ...f.token() })
      ).id;
      const asset = await f.asset();
      const expiry = new Date(Date.now() + 600000);
      await f.denied(
        "INSERT INTO app.download_grants(asset_id,report_id,report_version,view_scope,owner_session_id,owner_subject_id,token_hash,key_version,expires_at) VALUES($1,$2,1,'shared',$3,$4,$5,'test',$6)",
        [asset, f.reportId, session, f.subject, randomBytes(32), expiry],
        '23503',
      );
      const cap = (
        await f.insert('app.report_capabilities', {
          report_id: f.otherReport,
          scope: 'view',
          version_scope: 'latest',
          ...f.token(),
        })
      ).id;
      await f.denied(
        "INSERT INTO app.download_grants(asset_id,report_id,report_version,view_scope,share_capability_id,share_version_binding,token_hash,key_version,expires_at) VALUES($1,$2,1,'shared',$3,0,$4,'test',$5)",
        [asset, f.reportId, cap, randomBytes(32), expiry],
        '23503',
      );
      const ownCap = (
        await f.insert('app.report_capabilities', {
          report_id: f.reportId,
          report_version: 1,
          scope: 'view',
          version_scope: 'fixed',
          ...f.token(),
        })
      ).id;
      await f.insert('app.download_grants', {
        asset_id: asset,
        report_id: f.reportId,
        report_version: 1,
        view_scope: 'shared',
        share_capability_id: ownCap,
        share_version_binding: 1,
        ...f.token(),
        expires_at: expiry,
      });
      const privateAsset = await f.asset('owner');
      await f.denied(
        "INSERT INTO app.download_grants(asset_id,report_id,report_version,view_scope,share_capability_id,share_version_binding,token_hash,key_version,expires_at) VALUES($1,$2,1,'owner',$3,1,$4,'test',$5)",
        [privateAsset, f.reportId, ownCap, randomBytes(32), expiry],
      );
    },
  );
  scenario(
    'UC05 constrains capability authority, digest identity and grant lifetime',
    async (f) => {
      const token = f.token();
      await f.insert('app.report_capabilities', {
        report_id: f.reportId,
        scope: 'view',
        version_scope: 'latest',
        ...token,
      });
      await f.denied(
        "INSERT INTO app.report_capabilities(report_id,scope,version_scope,token_hash,key_version,expires_at) VALUES($1,'view','latest',$2,$3,$4)",
        [f.reportId, token.token_hash, token.key_version, token.expires_at],
        '23505',
      );
      await f.denied(
        "INSERT INTO app.report_capabilities(report_id,scope,version_scope,token_hash,key_version,expires_at) VALUES($1,'edit','latest',$2,'test',$3)",
        [f.reportId, randomBytes(32), future()],
      );
      await f.denied(
        "INSERT INTO app.report_capabilities(report_id,scope,version_scope,token_hash,key_version,expires_at) VALUES($1,'view','fixed',$2,'test',$3)",
        [f.reportId, randomBytes(32), future()],
      );
      const session = (
        await f.insert('app.owner_sessions', { subject_id: f.subject, ...f.token() })
      ).id;
      const asset = await f.asset('owner');
      await f.denied(
        "INSERT INTO app.download_grants(asset_id,report_id,report_version,view_scope,owner_session_id,owner_subject_id,token_hash,key_version,expires_at) VALUES($1,$2,1,'owner',$3,$4,$5,'test',now()+interval '16 minutes')",
        [asset, f.reportId, session, f.subject, randomBytes(32)],
      );
      await f.insert('app.download_grants', {
        asset_id: asset,
        report_id: f.reportId,
        report_version: 1,
        view_scope: 'owner',
        owner_session_id: session,
        owner_subject_id: f.subject,
        ...f.token(),
        expires_at: new Date(Date.now() + 600000),
      });
    },
  );
  scenario(
    'UC08 DB06 deduplicates rotated contact lookups and binds consent to its subject/purpose/scope',
    async (f) => {
      const lookup = randomBytes(32);
      await f.insert('privacy.contact_lookups', {
        key_version: 'test-1',
        email_hmac: lookup,
        contact_id: f.contact,
      });
      await f.denied(
        "INSERT INTO privacy.contact_lookups(key_version,email_hmac,contact_id) VALUES('test-1',$1,$2)",
        [lookup, f.contact],
        '23505',
      );
      const event = (
        await f.insert('privacy.consent_events', {
          purpose: 'offers',
          action: 'confirm',
          notice_id: f.notice,
          policy_version: 'test-1',
          scope_key: 'global',
          occurred_at: new Date(),
          method: 'confirmed_post',
        })
      ).id;
      await f.insert('privacy.subject_links', { event_id: event, subject_id: f.subject });
      await f.insert('privacy.consent_state', {
        subject_id: f.subject,
        purpose: 'offers',
        scope_key: 'global',
        status: 'confirmed',
        source_event_id: event,
        effective_at: new Date(),
        policy_version: 'test-1',
      });
      await f.denied(
        'UPDATE privacy.consent_state SET subject_id=$1 WHERE subject_id=$2',
        [f.stranger, f.subject],
        '23503',
      );
      await f.denied(
        "UPDATE privacy.consent_state SET scope_key='reseller:other' WHERE subject_id=$1",
        [f.subject],
        '23503',
      );
      await f.denied("UPDATE privacy.consent_events SET action='grant' WHERE id=$1", [event]);
    },
  );
  scenario(
    'UC09 preserves minimal replay markers after erasing identity links and ciphertext',
    async (f) => {
      const tombstone = {
        key_version: 'test-1',
        lookup_hmac: randomBytes(32),
        scope_key: 'all_email',
        reason_code: 'deletion',
        effective_at: new Date(),
        review_after: future(),
      };
      await f.insert('privacy.suppression_tombstones', tombstone);
      await f.insert('privacy.deletion_markers', {
        resource_kind: 'contact',
        resource_key_hmac: randomBytes(32),
        key_version: 'test-1',
        deleted_at: new Date(),
        policy_version: 'test-1',
      });
      await f.db.query('DELETE FROM privacy.contacts WHERE id=$1', [f.contact]);
      expect(
        (await f.db.query('SELECT count(*)::int AS n FROM privacy.suppression_tombstones')).rows[0]
          .n,
      ).toBe(1);
      expect(
        (await f.db.query('SELECT count(*)::int AS n FROM privacy.deletion_markers')).rows[0].n,
      ).toBe(1);
    },
  );
  scenario(
    'UC09 validates encrypted envelopes and idempotent rights fulfillment identities',
    async (f) => {
      await f.denied("UPDATE privacy.contacts SET encrypted_email=''::bytea WHERE id=$1", [
        f.contact,
      ]);
      const request = (
        await f.insert('privacy.privacy_requests', {
          subject_id: f.subject,
          kind: 'delete',
          jurisdiction: 'synthetic',
          policy_version: 'test-1',
          status: 'pending',
          due_at: future(),
        })
      ).id;
      await f.insert('privacy.fulfillment_steps', {
        request_id: request,
        store: 'app',
        action: 'erase',
        status: 'pending',
      });
      await f.denied(
        "INSERT INTO privacy.fulfillment_steps(request_id,store,action,status) VALUES($1,'app','erase','pending')",
        [request],
        '23505',
      );
      await f.denied("UPDATE privacy.privacy_requests SET status='completed' WHERE id=$1", [
        request,
      ]);
      await f.denied(
        "UPDATE privacy.privacy_requests SET encrypted_reply_context='abc'::bytea WHERE id=$1",
        [request],
      );
    },
  );
  scenario('UC06 DB03 DB04 pins delivery to exact report owner/version/comparison', async (f) => {
    const send = await f.insert('email.email_sends', f.sendValues());
    await f.denied('UPDATE email.email_sends SET report_id=$1 WHERE id=$2', [
      f.otherReport,
      send.id,
    ]);
    await f.db.query('SAVEPOINT wrong_owner');
    await expect(
      f.insert('email.email_sends', { ...f.sendValues(), owner_subject_id: f.stranger }),
    ).rejects.toMatchObject({ code: '23503' });
    await f.db.query('ROLLBACK TO SAVEPOINT wrong_owner');
    await f.db.query('SAVEPOINT wrong_compare');
    await expect(
      f.insert('email.email_sends', { ...f.sendValues(), comparison_revision: 2 }),
    ).rejects.toMatchObject({ code: '23503' });
    await f.db.query('ROLLBACK TO SAVEPOINT wrong_compare');
    await f.denied("UPDATE email.email_sends SET dispatch_state='accepted' WHERE id=$1", [send.id]);
    await f.denied('UPDATE email.email_sends SET send_after=created_at WHERE id=$1', [send.id]);
  });
  scenario(
    'UC07 DB05 keeps provider identity and payload frozen through uncertain reconciliation',
    async (f) => {
      const send = await f.insert('email.email_sends', f.sendValues());
      const payload = (
        await f.insert('app.object_assets', {
          purpose: 'email_payload',
          bucket: 'synthetic-private',
          object_key: `assets/${randomUUID()}`,
          mime_type: 'application/json',
        })
      ).id;
      await f.db.query(
        "UPDATE email.email_sends SET dispatch_state='dispatching', claimed_at=send_after,payload_asset_id=$2,payload_hash=$3 WHERE id=$1",
        [send.id, payload, hash],
      );
      await f.db.query("UPDATE email.email_sends SET dispatch_state='uncertain' WHERE id=$1", [
        send.id,
      ]);
      await f.denied("UPDATE email.email_sends SET provider_key='changed' WHERE id=$1", [send.id]);
      await f.denied('UPDATE email.email_sends SET payload_hash=$2 WHERE id=$1', [
        send.id,
        'a'.repeat(64),
      ]);
      await f.insert('email.send_attempts', {
        send_id: send.id,
        attempt_no: 1,
        started_at: new Date(),
        outcome: 'uncertain',
        finished_at: new Date(),
      });
      await f.denied(
        "INSERT INTO email.send_attempts(send_id,attempt_no,started_at,outcome) VALUES($1,1,now(),'in_progress')",
        [send.id],
        '23505',
      );
    },
  );
  scenario('UC09 DB13 detaches erased sends without leaving dispatchable references', async (f) => {
    const send = await f.insert('email.email_sends', f.sendValues());
    await f.denied('UPDATE email.email_sends SET anonymized_at=now() WHERE id=$1', [send.id]);
    await f.db.query(
      "UPDATE email.email_sends SET dispatch_state='suppressed',anonymized_at=now(),recipient_contact_id=NULL,owner_subject_id=NULL,report_id=NULL,report_version=NULL,comparison_revision=NULL,requested_purposes='[]' WHERE id=$1",
      [send.id],
    );
    await f.denied("UPDATE email.email_sends SET dispatch_state='scheduled' WHERE id=$1", [
      send.id,
    ]);
    await f.insert('email.send_receipts', {
      send_id: send.id,
      provider: 'synthetic',
      provider_key_digest: randomBytes(32),
      outcome: 'suppressed',
      last_reconciled_at: new Date(),
    });
    await f.db.query('DELETE FROM email.email_sends WHERE id=$1', [send.id]);
    expect(
      (
        await f.db.query('SELECT count(*)::int AS n FROM email.send_receipts WHERE send_id=$1', [
          send.id,
        ])
      ).rows[0].n,
    ).toBe(1);
  });
  scenario(
    'UC07 DB07 deduplicates provider events, inbox receipts and purpose-scoped links',
    async (f) => {
      const send = await f.insert('email.email_sends', f.sendValues());
      await f.insert('email.email_events', {
        send_id: send.id,
        provider: 'synthetic',
        provider_event_id: 'event-1',
        type: 'delivered',
        occurred_at: new Date(),
        received_at: new Date(),
      });
      await f.denied(
        "INSERT INTO email.email_events(provider,provider_event_id,type,occurred_at,received_at) VALUES('synthetic','event-1','delivered',now(),now())",
        [],
        '23505',
      );
      const inbox = (
        await f.insert('app.webhook_inbox', {
          provider: 'synthetic',
          provider_event_id: 'event-1',
          payload_digest: randomBytes(32),
          received_at: new Date(),
          signature_verified_at: new Date(),
        })
      ).id;
      await f.denied(
        'UPDATE app.webhook_inbox SET signature_verified_at=NULL WHERE id=$1',
        [inbox],
        '23514',
      );
      await f.denied(
        "INSERT INTO email.email_links(send_id,slot,purpose,approved_destination,token_hash,key_version,expires_at) VALUES($1,'education-1','education','javascript:alert(1)',$2,'test',$3)",
        [send.id, randomBytes(32), future()],
      );
    },
  );
  scenario(
    'UC06 DB04 deduplicates command identities with allowlisted response keys',
    async (f) => {
      const values = {
        actor_scope_hash: randomBytes(32),
        operation: 'request_report',
        key_hash: randomBytes(32),
        body_hash: randomBytes(32),
        canonical_version: 1,
        state: 'pending',
        expires_at: new Date(Date.now() + 8 * 86400000),
      };
      const request = await f.insert('app.idempotency_requests', values);
      await f.db.query('SAVEPOINT duplicate_command');
      await expect(f.insert('app.idempotency_requests', values)).rejects.toMatchObject({
        code: '23505',
      });
      await f.db.query('ROLLBACK TO SAVEPOINT duplicate_command');
      await f.denied('UPDATE app.idempotency_requests SET body_hash=$2 WHERE id=$1', [
        request.id,
        randomBytes(2),
      ]);
      await f.denied('UPDATE app.idempotency_requests SET body_hash=$2 WHERE id=$1', [
        request.id,
        randomBytes(32),
      ]);
      await f.denied('UPDATE app.idempotency_requests SET expires_at=created_at WHERE id=$1', [
        request.id,
      ]);
      await f.denied('UPDATE app.idempotency_requests SET safe_response=$2 WHERE id=$1', [
        request.id,
        { token: 'forbidden' },
      ]);
    },
  );
  scenario(
    'UC07 DB08 persists fenced work and rejects partial leases or negative retry counters',
    async (f) => {
      const job = (
        await f.insert('app.job_runs', {
          job_type: 'synthetic',
          business_key: 'one',
          schema_version: 1,
        })
      ).id;
      await f.denied('UPDATE app.job_runs SET attempts=-1 WHERE id=$1', [job]);
      await f.denied('UPDATE app.job_runs SET lease_until=$2 WHERE id=$1', [job, future()]);
      await f.db.query(
        "UPDATE app.job_runs SET state='running',lease_token=$2,lease_until=$3,lease_generation=1 WHERE id=$1",
        [job, randomUUID(), future()],
      );
      await f.denied('UPDATE app.job_runs SET lease_token=$2 WHERE id=$1', [job, randomUUID()]);
      await f.db.query('UPDATE app.job_runs SET lease_token=$2,lease_generation=2 WHERE id=$1', [
        job,
        randomUUID(),
      ]);
      const event = (
        await f.insert('app.outbox', {
          event_id: randomUUID(),
          aggregate_kind: 'report',
          aggregate_id: f.reportId,
          event_type: 'report_created',
          schema_version: 1,
          payload: {},
        })
      ).id;
      await f.denied("UPDATE app.outbox SET state='published' WHERE id=$1", [event]);
      await f.denied('UPDATE app.outbox SET payload=$2 WHERE id=$1', [
        event,
        { email: 'forbidden' },
      ]);
    },
  );
  scenario(
    'UC13 resolves the pending audit reference with an immutable event and erasable mapping',
    async (f) => {
      const audit = (
        await f.insert('admin.audit_events', {
          action: 'approve_import',
          resource_kind: 'import',
          result: 'approved',
          occurred_at: new Date(),
          field_names: JSON.stringify(['status']),
        })
      ).id;
      await f.insert('admin.audit_identity_links', {
        event_id: audit,
        actor_staff_id: '22222222-2222-4222-8222-222222222222',
      });
      await f.denied("UPDATE admin.audit_events SET result='rejected' WHERE id=$1", [audit]);
      const constraints = await f.db.query(
        "SELECT conname,convalidated FROM pg_constraint WHERE conrelid='app.import_publications'::regclass AND conname IN ('import_publications_audit_fk','import_publications_audit_pending_ck')",
      );
      expect(constraints.rows).toEqual([
        { conname: 'import_publications_audit_fk', convalidated: true },
      ]);
      const prior = (
        await f.db.query(
          "SELECT * FROM app.import_publications WHERE id='66666666-6666-4666-8666-666666666666'",
        )
      ).rows[0];
      expect(prior.approval_record_id).toBeNull();
      const run = (
        await f.db.query(
          "INSERT INTO app.import_runs(provider_id,upstream_run_key,status,started_at,mode,mapping_version,content_hash,schema_version) SELECT provider_id,'approved-after-upgrade','validated',now(),'manual','test',repeat('c',64),'1' FROM app.import_runs WHERE id=$1 RETURNING id",
          [prior.run_id],
        )
      ).rows[0].id;
      await f.denied(
        "INSERT INTO app.import_publications(run_id,bundle_id,market,actor_id,published_at,approval_record_id) VALUES($1,$2,'US',$3,now(),$4)",
        [run, prior.bundle_id, prior.actor_id, randomUUID()],
        '23503',
        'import_publications_audit_fk',
      );
      await f.insert('app.import_publications', {
        run_id: run,
        bundle_id: prior.bundle_id,
        market: 'US',
        actor_id: prior.actor_id,
        published_at: new Date(),
        approval_record_id: audit,
      });
      await f.db.query('DELETE FROM admin.audit_identity_links WHERE event_id=$1', [audit]);
      await f.denied('DELETE FROM admin.audit_events WHERE id=$1', [audit], '23001');
    },
  );
  scenario(
    'denies every existing runtime access to new private and operational tables',
    async (f) => {
      for (const role of ['tt_app_runtime', 'tt_staff_runtime', 'tt_asset_runtime'] as const) {
        for (const table of [
          'app.reports',
          'privacy.contacts',
          'email.email_sends',
          'admin.audit_events',
          'app.outbox',
        ]) {
          await expect(clients()[role].query(`SELECT * FROM ${table}`)).rejects.toMatchObject({
            code: '42501',
          });
        }
      }
      expect((await f.db.query('SELECT count(*)::int AS n FROM app.reports')).rows[0].n).toBe(2);
    },
  );

  scenario(
    'UC09 DB13 allows an ordered privileged snapshot purge without weakening UPDATE immutability',
    async (f) => {
      await f.insert('app.report_drafts', {
        report_id: f.reportId,
        base_version: 1,
        input: {},
        schema_version: 1,
        expires_at: future(),
      });
      await f.insert('privacy.report_private_data', {
        report_id: f.reportId,
        encrypted_fields: Buffer.from('synthetic-encrypted-envelope'),
        key_version: 'test-1',
        expires_at: future(),
      });
      await f.denied('DELETE FROM app.reports WHERE id=$1', [f.reportId], '23001');
      await f.db.query('DELETE FROM privacy.report_private_data WHERE report_id=$1', [f.reportId]);
      await f.db.query('DELETE FROM app.report_drafts WHERE report_id=$1', [f.reportId]);
      await f.db.query('DELETE FROM app.report_versions WHERE report_id=$1', [f.reportId]);
      await f.db.query('DELETE FROM app.reports WHERE id=$1', [f.reportId]);
      await f.db.query('SET CONSTRAINTS ALL IMMEDIATE');
      expect(
        (
          await f.db.query(
            'SELECT count(*)::int AS n FROM app.report_versions WHERE report_id=$1',
            [f.reportId],
          )
        ).rows[0].n,
      ).toBe(0);
    },
  );

  scenario(
    'UC08 bounds cookie purposes and GPC and requires a reviewed template before freezing',
    async (f) => {
      await f.denied(
        "INSERT INTO privacy.cookie_consents(subject_id,notice_id,policy_version,gpc,allowed_purposes,receipt_digest,expires_at) VALUES($1,$2,'test',true,'[\"targeted_ads\"]',$3,$4)",
        [f.subject, f.notice, hash, future()],
      );
      await f.insert('privacy.cookie_consents', {
        subject_id: f.subject,
        notice_id: f.notice,
        policy_version: 'test-1',
        gpc: true,
        allowed_purposes: JSON.stringify(['necessary']),
        receipt_digest: hash,
        expires_at: future(),
      });
      await f.denied("UPDATE email.template_versions SET status='published' WHERE id=$1", [
        f.template,
      ]);
      await f.db.query(
        "UPDATE email.template_versions SET status='published',reviewed_at=now() WHERE id=$1",
        [f.template],
      );
      await f.denied(
        "UPDATE email.template_versions SET renderer_hash=repeat('c',64) WHERE id=$1",
        [f.template],
      );
    },
  );

  it('P1-PR-006 UC06 DB04 serializes simultaneous command claims and recovers after rollback', async () => {
    const writer = clients().tt_app_migrator;
    const contender = new pg.Client({
      connectionString: ownerUrl(),
      connectionTimeoutMillis: 3000,
    });
    await contender.connect();
    const values = [randomBytes(32), randomBytes(32), randomBytes(32)];
    const sql =
      "INSERT INTO app.idempotency_requests(actor_scope_hash,operation,key_hash,body_hash,canonical_version,state,expires_at) VALUES($1,'synthetic_race',$2,$3,1,'pending',now()+interval '8 days') RETURNING id";
    try {
      await writer.query('BEGIN');
      await writer.query(sql, values);
      await contender.query('BEGIN');
      await contender.query("SET LOCAL lock_timeout='100ms'");
      await expect(contender.query(sql, values)).rejects.toMatchObject({ code: '55P03' });
      await contender.query('ROLLBACK');
      await writer.query('ROLLBACK');
      const recovered = (await contender.query(sql, values)).rows[0].id;
      await expect(writer.query(sql, values)).rejects.toMatchObject({ code: '23505' });
      await contender.query('DELETE FROM app.idempotency_requests WHERE id=$1', [recovered]);
    } finally {
      await writer.query('ROLLBACK');
      await contender.query('ROLLBACK');
      await contender.query(
        "DELETE FROM app.idempotency_requests WHERE actor_scope_hash=$1 AND operation='synthetic_race'",
        [values[0]],
      );
      await contender.end();
    }
  });
}
