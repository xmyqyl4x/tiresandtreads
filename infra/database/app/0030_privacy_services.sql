-- Dedicated, headless privacy process. Public/private request roles gain no purge grants.
CREATE TABLE email.delivery_asset_reservations (
 send_id uuid NOT NULL REFERENCES email.email_sends(id) ON DELETE RESTRICT,
 asset_id uuid NOT NULL UNIQUE,
 purpose text NOT NULL CHECK(purpose IN ('report_pdf','email_payload')),
 PRIMARY KEY(send_id,purpose)
);
CREATE TABLE privacy.asset_barriers (
 asset_id uuid PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION privacy.block_erased_asset() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('asset-erasure:'||NEW.id::text,0));
 IF EXISTS(SELECT 1 FROM privacy.asset_barriers WHERE asset_id=NEW.id) THEN
  RAISE EXCEPTION 'Asset erased' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER object_assets_erasure BEFORE INSERT ON app.object_assets FOR EACH ROW EXECUTE FUNCTION privacy.block_erased_asset();
CREATE FUNCTION privacy.lock_asset_barrier() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('asset-erasure:'||NEW.asset_id::text,0));
 RETURN NEW;
END $$;
CREATE TRIGGER asset_barriers_serialize BEFORE INSERT ON privacy.asset_barriers FOR EACH ROW EXECUTE FUNCTION privacy.lock_asset_barrier();
GRANT SELECT,INSERT ON email.delivery_asset_reservations TO tt_private_runtime;
GRANT SELECT,DELETE ON email.delivery_asset_reservations TO tt_privacy_runtime;
GRANT SELECT,INSERT ON privacy.asset_barriers TO tt_privacy_runtime;
CREATE TABLE privacy.request_work (
 request_id uuid PRIMARY KEY REFERENCES privacy.privacy_requests(id) ON DELETE RESTRICT,
 target_kind text NOT NULL CHECK(target_kind IN ('subject','report')),
 target_id uuid,
 proof_hash bytea CHECK(octet_length(proof_hash)=32),
 proof_key_version text NOT NULL CHECK(length(proof_key_version) BETWEEN 1 AND 100),
 owner_key_version text CHECK(owner_key_version IS NULL OR length(owner_key_version) BETWEEN 1 AND 100),
 owner_request_hash bytea CHECK(octet_length(owner_request_hash)=32),
 proof_expires_at timestamptz NOT NULL,
 policy jsonb NOT NULL CHECK(jsonb_typeof(policy)='object' AND octet_length(policy::text)<=1024),
 notified_at timestamptz,
 lease_token uuid,
 lease_generation bigint NOT NULL DEFAULT 0 CHECK(lease_generation>=0),
 lease_until timestamptz,
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 1000),
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 barrier_until timestamptz NOT NULL DEFAULT (now()+interval '45 seconds'),
 recovery_run_id uuid,
 last_error text CHECK(last_error IN ('legal_hold','deadline_near','downstream_unconfirmed','execution_failed','operator_required')),
 CHECK((lease_token IS NULL)=(lease_until IS NULL)),
 CHECK((owner_key_version IS NULL)=(owner_request_hash IS NULL)),
 UNIQUE(owner_key_version,owner_request_hash)
);
CREATE INDEX request_work_due_idx ON privacy.request_work(next_attempt_at,request_id);
CREATE INDEX request_work_target_idx ON privacy.request_work(target_kind,target_id);
CREATE TABLE privacy.erasure_receipts (
 request_id uuid NOT NULL REFERENCES privacy.privacy_requests(id) ON DELETE RESTRICT,
 store text NOT NULL CHECK(store IN ('email','objects')),
 resource_id uuid NOT NULL,
 evidence_digest text NOT NULL CHECK(evidence_digest ~ '^[a-f0-9]{64}$'),
 completed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(request_id,store,resource_id)
);
CREATE TRIGGER erasure_receipts_immutable BEFORE UPDATE ON privacy.erasure_receipts FOR EACH ROW EXECUTE FUNCTION app.reject_history_change();
CREATE TABLE privacy.recovery_runs (
 id uuid PRIMARY KEY,
 backup_finished_at timestamptz NOT NULL,
 expected_digest text NOT NULL CHECK(expected_digest ~ '^[a-f0-9]{64}$'),
 cursor_key text,
 scan_complete boolean NOT NULL DEFAULT false,
 state text NOT NULL DEFAULT 'scanning' CHECK(state IN ('scanning','fulfilling','ready')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE privacy.request_work ADD CONSTRAINT request_work_recovery_fk FOREIGN KEY(recovery_run_id) REFERENCES privacy.recovery_runs(id) ON DELETE RESTRICT;
CREATE INDEX request_work_recovery_idx ON privacy.request_work(recovery_run_id,request_id) WHERE recovery_run_id IS NOT NULL;
GRANT SELECT(id) ON admin.audit_events TO tt_privacy_runtime;
GRANT USAGE ON SCHEMA app,privacy,email,analytics,admin TO tt_privacy_runtime;
GRANT SELECT,INSERT,UPDATE ON privacy.privacy_requests,privacy.fulfillment_steps,privacy.request_work,privacy.recovery_runs TO tt_privacy_runtime;
GRANT SELECT,INSERT,DELETE ON privacy.erasure_receipts TO tt_privacy_runtime;
GRANT SELECT,INSERT ON privacy.deletion_markers TO tt_privacy_runtime;
GRANT SELECT,INSERT,UPDATE ON privacy.suppressions,privacy.suppression_tombstones TO tt_privacy_runtime;
GRANT SELECT,UPDATE,DELETE ON app.subjects,app.owner_sessions,app.reports,app.report_drafts,app.shop_quotes,
 app.report_capabilities,app.download_grants,app.object_assets,app.outbox,app.job_runs,app.webhook_inbox,
 privacy.contacts,privacy.consent_state,privacy.verification_challenges,
 email.email_sends,email.email_links,email.delivery_work TO tt_privacy_runtime;
GRANT SELECT,DELETE ON app.report_versions,app.report_items,app.comparisons,app.comparison_items,app.report_assets,
 privacy.report_private_data,privacy.quote_private_data,privacy.contact_lookups,privacy.subject_links,privacy.cookie_consents,
 privacy.contact_intents,email.delivery_snapshots,email.send_attempts,email.send_receipts,email.email_events,
 email.email_feedback,email.callback_observations,admin.audit_identity_links TO tt_privacy_runtime;
GRANT SELECT,DELETE ON app.idempotency_requests TO tt_privacy_runtime;
GRANT SELECT ON privacy.consent_events TO tt_privacy_runtime;
GRANT INSERT ON admin.audit_events,admin.audit_identity_links TO tt_privacy_runtime;
GRANT INSERT ON app.outbox TO tt_privacy_runtime;
GRANT DELETE ON privacy.suppressions TO tt_privacy_runtime;
CREATE FUNCTION privacy.erase_released_holds(subject uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 DELETE FROM privacy.legal_holds WHERE subject_id=subject AND released_at IS NOT NULL
$$;
GRANT EXECUTE ON FUNCTION privacy.erase_released_holds(uuid) TO tt_privacy_runtime;
GRANT SELECT,INSERT,DELETE ON analytics.replay_barriers,analytics.processing_restrictions TO tt_privacy_runtime;
GRANT SELECT,DELETE ON analytics.events TO tt_privacy_runtime;
GRANT SELECT,INSERT,UPDATE ON analytics.dirty_days TO tt_privacy_runtime;
GRANT SELECT ON privacy.retention_policies,privacy.legal_holds,admin.staff_identities,admin.staff_role_assignments,admin.roles TO tt_privacy_runtime;
GRANT EXECUTE ON FUNCTION analytics.invalidate_days(date[],boolean) TO tt_privacy_runtime;
GRANT EXECUTE ON FUNCTION privacy.valid_purposes(jsonb) TO tt_privacy_runtime;
CREATE FUNCTION privacy.authorized_operator(actor uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM admin.staff_identities s JOIN admin.staff_role_assignments a ON a.staff_id=s.id JOIN admin.roles r ON r.id=a.role_id WHERE s.id=actor AND s.status='active' AND a.revoked_at IS NULL AND a.granted_at<=clock_timestamp() AND r.code='privacy_operator' FOR SHARE OF s,a,r)
$$;
GRANT EXECUTE ON FUNCTION privacy.authorized_operator(uuid) TO tt_privacy_runtime;
INSERT INTO admin.roles(code,permissions,policy_version) VALUES('privacy_operator','["privacy.review"]','p1-privacy-v1');
CREATE INDEX idempotency_requests_resource_idx ON app.idempotency_requests(resource_id,id) WHERE resource_id IS NOT NULL;
CREATE INDEX job_runs_resource_idx ON app.job_runs(resource_id,id) WHERE resource_id IS NOT NULL;
-- Only the privacy role can erase; immutable snapshots remain immutable to UPDATE.
