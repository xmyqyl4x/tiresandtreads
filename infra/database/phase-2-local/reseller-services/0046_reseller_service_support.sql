-- Explicit opt-in local service track; no default bootstrap or production role provisioning.
ALTER TABLE partners.offer_versions ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE partners.offer_versions ADD COLUMN partner_author text;
ALTER TABLE partners.offer_versions ADD CONSTRAINT offer_author_exactly_one CHECK(num_nonnulls(created_by,partner_author)=1);
ALTER TABLE partners.offer_versions ADD CONSTRAINT offer_partner_author_fk FOREIGN KEY(org_id,partner_author) REFERENCES partners.memberships(org_id,provider_subject);
CREATE FUNCTION partners.service_offer_author() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.created_by,NEW.partner_author) IS DISTINCT FROM (OLD.created_by,OLD.partner_author) THEN RAISE EXCEPTION 'Immutable offer authorship' USING ERRCODE='23514';END IF;
 IF NEW.partner_author IS NOT NULL AND NEW.reviewed_by IS NOT NULL AND EXISTS(SELECT 1 FROM admin.staff_identities s WHERE s.id=NEW.reviewed_by AND s.provider_subject=NEW.partner_author) THEN RAISE EXCEPTION 'Independent offer reviewer required' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER service_offer_author BEFORE INSERT OR UPDATE ON partners.offer_versions FOR EACH ROW EXECUTE FUNCTION partners.service_offer_author();
CREATE TABLE partners.onboarding_profiles(
 org_id uuid PRIMARY KEY REFERENCES partners.organizations(id), email_domain text NOT NULL CHECK(length(email_domain) BETWEEN 3 AND 253),
 services jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(services)='array' AND jsonb_array_length(services)<=16),
 state text NOT NULL DEFAULT 'draft' CHECK(state IN('draft','submitted','approved','rejected')),
 policy_version text NOT NULL CHECK(length(policy_version) BETWEEN 1 AND 100), reason_code text CHECK(reason_code ~ '^[a-z][a-z0-9_]{0,79}$'), email_override boolean NOT NULL DEFAULT false,
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE partners.membership_invites(
 id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES partners.organizations(id), issuer text NOT NULL,target_subject text NOT NULL CHECK(length(target_subject) BETWEEN 1 AND 200),role text NOT NULL CHECK(role IN('manager','analyst')),
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),expires_at timestamptz NOT NULL,state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','accepted','revoked')),
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(org_id,issuer) REFERENCES partners.memberships(org_id,provider_subject),CHECK(expires_at>created_at),UNIQUE(org_id,id)
);
CREATE INDEX service_invite_expiry_idx ON partners.membership_invites(org_id,state,expires_at,id);
CREATE TABLE partners.organization_audit(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES partners.organizations(id),actor_hmac text NOT NULL CHECK(actor_hmac ~ '^[a-f0-9]{64}$'),
 action text NOT NULL CHECK(action ~ '^[a-z][a-z0-9_.]{0,79}$'),resource text NOT NULL CHECK(length(resource) BETWEEN 1 AND 100), body_hmac text NOT NULL CHECK(body_hmac ~ '^[a-f0-9]{64}$'),result text NOT NULL DEFAULT 'succeeded' CHECK(result='succeeded'),occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX organization_audit_page_idx ON partners.organization_audit(org_id,id);
CREATE TRIGGER organization_audit_immutable BEFORE UPDATE OR DELETE ON partners.organization_audit FOR EACH ROW EXECUTE FUNCTION partners.reject_update();
CREATE TABLE partners.coupon_imports(
 id uuid PRIMARY KEY,org_id uuid NOT NULL REFERENCES partners.organizations(id),pool_id uuid NOT NULL UNIQUE,asset_id uuid NOT NULL,job_id uuid NOT NULL UNIQUE REFERENCES app.job_runs(id),
 requester text NOT NULL,member_revision bigint NOT NULL CHECK(member_revision>0),authorized_until timestamptz NOT NULL,body_hash text NOT NULL CHECK(body_hash ~ '^[a-f0-9]{64}$'),key_version text NOT NULL CHECK(length(key_version) BETWEEN 1 AND 100),
 state text NOT NULL DEFAULT 'queued' CHECK(state IN('queued','processing','ready','rejected')),through_row integer NOT NULL DEFAULT 0 CHECK(through_row BETWEEN 0 AND 100000),accepted integer NOT NULL DEFAULT 0 CHECK(accepted>=0),duplicates integer NOT NULL DEFAULT 0 CHECK(duplicates>=0),rejected integer NOT NULL DEFAULT 0 CHECK(rejected>=0),
 errors jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(errors)='array' AND jsonb_array_length(errors)<=1000),expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(org_id,id),FOREIGN KEY(org_id,requester) REFERENCES partners.memberships(org_id,provider_subject),FOREIGN KEY(org_id,pool_id) REFERENCES partners.coupon_pools(org_id,id),FOREIGN KEY(org_id,asset_id) REFERENCES partners.organization_assets(org_id,asset_id),CHECK(authorized_until>created_at),CHECK(expires_at>created_at),CHECK(accepted+duplicates+rejected=through_row)
);
CREATE INDEX coupon_import_job_idx ON partners.coupon_imports(org_id,state,job_id);
CREATE TABLE partners.coupon_import_rows(
 org_id uuid NOT NULL,import_id uuid NOT NULL,row_number integer NOT NULL CHECK(row_number BETWEEN 1 AND 100000),code_hmac bytea NOT NULL CHECK(octet_length(code_hmac)=32),encrypted_code bytea NOT NULL CHECK(octet_length(encrypted_code) BETWEEN 32 AND 4096),key_version text NOT NULL,
 PRIMARY KEY(import_id,row_number),UNIQUE(import_id,code_hmac),FOREIGN KEY(org_id,import_id) REFERENCES partners.coupon_imports(org_id,id)
);
CREATE INDEX coupon_import_rows_org_idx ON partners.coupon_import_rows(org_id,import_id);
CREATE FUNCTION partners.authorize_service_staff(actor uuid,subject text,permission text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF permission NOT IN('partner.verify','partner.moderate') THEN RETURN false;END IF;
 PERFORM 1 FROM admin.staff_identities s WHERE s.id=actor AND s.provider_subject=subject AND s.status='active' FOR SHARE;
 IF NOT FOUND THEN RETURN false;END IF;
 PERFORM 1 FROM admin.staff_role_assignments a JOIN admin.roles r ON r.id=a.role_id WHERE a.staff_id=actor AND a.revoked_at IS NULL AND r.permissions ? permission FOR SHARE OF a,r;
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION partners.authorize_service_staff(uuid,text,text),partners.service_offer_author() FROM PUBLIC;
INSERT INTO admin.roles(code,permissions,policy_version) VALUES('partner_verifier','["partner.verify"]','p2-local-service-v1'),('partner_moderator','["partner.moderate"]','p2-local-service-v1');
GRANT EXECUTE ON FUNCTION partners.authorize_service_staff(uuid,text,text) TO tt_p2_partner_service;
GRANT USAGE ON SCHEMA partners,app,admin TO tt_p2_partner_service,tt_p2_coupon_worker;
GRANT SELECT ON partners.organizations,partners.memberships,partners.organization_assets,partners.agreements,partners.verification_records,partners.locations,partners.organization_domains,partners.offers,partners.offer_versions,partners.offer_targets,partners.coupon_pools,partners.coupon_codes TO tt_p2_partner_service,tt_p2_coupon_worker;
GRANT INSERT,UPDATE ON partners.organization_assets,partners.agreements,partners.verification_records,partners.locations,partners.organization_domains TO tt_p2_partner_service;
GRANT INSERT,UPDATE ON partners.coupon_pools TO tt_p2_partner_service;
GRANT SELECT,INSERT,UPDATE ON partners.onboarding_profiles,partners.membership_invites,partners.coupon_imports TO tt_p2_partner_service;
GRANT SELECT,INSERT ON partners.organization_audit TO tt_p2_partner_service,tt_p2_coupon_worker;
GRANT SELECT ON partners.onboarding_profiles TO tt_p2_coupon_worker;
GRANT SELECT,INSERT,UPDATE ON partners.coupon_imports,partners.coupon_import_rows TO tt_p2_coupon_worker;
GRANT DELETE ON partners.coupon_import_rows TO tt_p2_coupon_worker;
GRANT INSERT ON partners.coupon_codes TO tt_p2_coupon_worker;
GRANT UPDATE(state) ON partners.coupon_pools TO tt_p2_coupon_worker;
GRANT SELECT,INSERT,UPDATE ON app.job_runs TO tt_p2_partner_service,tt_p2_coupon_worker;
GRANT SELECT,INSERT,UPDATE ON app.object_assets TO tt_p2_partner_service;
GRANT SELECT ON app.object_assets TO tt_p2_coupon_worker;
-- Each predicate is fixed to an owned server capability. Client credentials are never exposed.
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['onboarding_profiles','membership_invites','organization_audit','coupon_imports','coupon_import_rows'] LOOP
  EXECUTE format('ALTER TABLE partners.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE partners.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY service_extension_owner ON partners.%I TO tt_app_migrator USING(true) WITH CHECK(true)',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['organizations','memberships','organization_assets','agreements','verification_records','locations','organization_domains','offers','offer_versions','offer_targets','coupon_pools','coupon_codes','onboarding_profiles','membership_invites','organization_audit','coupon_imports'] LOOP
  EXECUTE format('CREATE POLICY service_extension_actor ON partners.%I TO tt_p2_partner_service USING(true) WITH CHECK(true)',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['organizations','memberships','organization_assets','agreements','verification_records','locations','organization_domains','offers','offer_versions','offer_targets','coupon_pools','coupon_codes','onboarding_profiles','organization_audit','coupon_imports','coupon_import_rows'] LOOP
  EXECUTE format('CREATE POLICY service_extension_worker ON partners.%I TO tt_p2_coupon_worker USING(true) WITH CHECK(true)',t);
 END LOOP;
END $$;
CREATE POLICY partner_service_job ON app.job_runs TO tt_p2_partner_service,tt_p2_coupon_worker USING(job_type='partner.coupon_import') WITH CHECK(job_type='partner.coupon_import');
CREATE POLICY partner_service_assets ON app.object_assets TO tt_p2_partner_service USING(purpose IN('agreement','import_evidence','import_source','cms_media')) WITH CHECK(purpose IN('agreement','import_evidence','import_source','cms_media'));
CREATE POLICY partner_worker_assets ON app.object_assets FOR SELECT TO tt_p2_coupon_worker USING(purpose='import_source');
-- Append renewal evidence; the original accepted agreement is never rewritten.
CREATE TABLE partners.agreement_renewals(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL,agreement_id uuid NOT NULL,asset_id uuid NOT NULL,
 asset_purpose text NOT NULL DEFAULT 'agreement' CHECK(asset_purpose='agreement'),accepted_by text NOT NULL,accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL,
 document_sha256 text NOT NULL CHECK(document_sha256 ~ '^[a-f0-9]{64}$'),
 UNIQUE(org_id,id),UNIQUE(org_id,agreement_id,asset_id),
 FOREIGN KEY(org_id,agreement_id) REFERENCES partners.agreements(org_id,id),
 FOREIGN KEY(org_id,asset_id,asset_purpose) REFERENCES partners.organization_assets(org_id,asset_id,purpose),
 FOREIGN KEY(org_id,accepted_by) REFERENCES partners.memberships(org_id,provider_subject),CHECK(expires_at>accepted_at)
);
CREATE INDEX agreement_renewal_latest_idx ON partners.agreement_renewals(org_id,agreement_id,accepted_at DESC,id DESC);
ALTER TABLE partners.agreement_renewals ENABLE ROW LEVEL SECURITY;
ALTER TABLE partners.agreement_renewals FORCE ROW LEVEL SECURITY;
CREATE POLICY agreement_renewal_owner ON partners.agreement_renewals TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY agreement_renewal_service ON partners.agreement_renewals TO tt_p2_partner_service USING(true) WITH CHECK(true);
GRANT SELECT,INSERT ON partners.agreement_renewals TO tt_p2_partner_service;
CREATE TRIGGER agreement_renewal_immutable BEFORE UPDATE OR DELETE ON partners.agreement_renewals FOR EACH ROW EXECUTE FUNCTION partners.reject_update();
CREATE VIEW partners.current_agreements WITH (security_barrier=true) AS
SELECT a.id,a.org_id,a.kind,a.version,coalesce(r.asset_id,a.asset_id) AS asset_id,a.asset_purpose,
 coalesce(r.accepted_by,a.accepted_by) AS accepted_by,coalesce(r.accepted_at,a.accepted_at) AS accepted_at,
 coalesce(r.expires_at,a.expires_at) AS expires_at,a.status,a.billing_mode,a.created_at
FROM partners.agreements a LEFT JOIN LATERAL(
 SELECT e.asset_id,e.accepted_by,e.accepted_at,e.expires_at FROM partners.agreement_renewals e
 WHERE e.org_id=a.org_id AND e.agreement_id=a.id ORDER BY e.accepted_at DESC,e.id DESC LIMIT 1
) r ON true;
GRANT SELECT ON partners.current_agreements TO tt_p2_partner_service;
-- Existing staff-authored S2 rows remain readable; serving in this opt-in track now requires actual onboarding metadata.
CREATE OR REPLACE VIEW partners.eligible_offer_versions WITH (security_barrier=true) AS
SELECT o.org_id,o.id AS offer_id,v.version,v.valid_from,v.valid_until,v.title,v.discount_type
FROM partners.offers o JOIN partners.organizations company ON company.id=o.org_id
JOIN partners.offer_versions v ON v.org_id=o.org_id AND v.offer_id=o.id AND v.version=o.current_version
WHERE o.status='active' AND company.status='active' AND company.verification_status='verified'
  AND v.status='published' AND v.valid_from<=statement_timestamp() AND v.valid_until>statement_timestamp()
  AND EXISTS(SELECT 1 FROM partners.offer_targets t WHERE t.org_id=o.org_id AND t.offer_id=o.id AND t.offer_version=v.version AND t.market=company.market)
  AND (SELECT count(DISTINCT a.kind) FROM partners.current_agreements a
    JOIN partners.organization_assets b ON b.org_id=a.org_id AND b.asset_id=a.asset_id
    JOIN app.object_assets physical ON physical.id=b.asset_id
    WHERE a.org_id=o.org_id AND a.status='accepted' AND a.accepted_at<=statement_timestamp()
      AND (a.expires_at IS NULL OR a.expires_at>statement_timestamp()) AND b.state='ready' AND physical.state='ready' AND (physical.expires_at IS NULL OR physical.expires_at>statement_timestamp()))=3
  AND (v.redemption_domain IS NULL OR EXISTS(SELECT 1 FROM partners.organization_domains d
    WHERE d.org_id=o.org_id AND d.domain=v.redemption_domain AND d.status='verified' AND d.expires_at>statement_timestamp()))
  AND (v.logo_asset_id IS NULL OR EXISTS(SELECT 1 FROM partners.organization_assets b
    JOIN app.object_assets physical ON physical.id=b.asset_id
    WHERE b.org_id=o.org_id AND b.asset_id=v.logo_asset_id AND b.purpose='logo' AND b.state='ready' AND physical.state='ready' AND (physical.expires_at IS NULL OR physical.expires_at>statement_timestamp())))
 AND EXISTS(SELECT 1 FROM partners.onboarding_profiles p WHERE p.org_id=o.org_id AND p.state='approved')
 AND EXISTS(SELECT 1 FROM partners.locations l WHERE l.org_id=o.org_id AND l.status='approved')
 AND EXISTS(SELECT 1 FROM partners.verification_records r JOIN partners.organization_assets b ON b.org_id=r.org_id AND b.asset_id=r.asset_id JOIN app.object_assets a ON a.id=b.asset_id WHERE r.org_id=o.org_id AND r.status='verified' AND r.expires_at>statement_timestamp() AND NOT EXISTS(SELECT 1 FROM partners.verification_records denied WHERE denied.org_id=r.org_id AND denied.status='rejected' AND denied.reviewed_at>=r.reviewed_at) AND b.state='ready' AND a.state='ready' AND (a.expires_at IS NULL OR a.expires_at>statement_timestamp()));
GRANT SELECT ON partners.eligible_offer_versions TO tt_p2_partner_service,tt_p2_coupon_worker;

CREATE FUNCTION partners.lock_coupon_authority(organization uuid,actor text,asset uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM 1 FROM partners.organizations WHERE id=organization FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Import authority unavailable' USING ERRCODE='23514';END IF;
 PERFORM 1 FROM partners.memberships WHERE org_id=organization AND provider_subject=actor FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Import authority unavailable' USING ERRCODE='23514';END IF;
 PERFORM 1 FROM partners.organization_assets b JOIN app.object_assets a ON a.id=b.asset_id WHERE b.org_id=organization AND b.asset_id=asset AND b.purpose='coupon_pool' AND b.state='ready' AND a.state='ready' AND a.expires_at>clock_timestamp() FOR SHARE OF b,a;
 IF NOT FOUND THEN RAISE EXCEPTION 'Import asset unavailable' USING ERRCODE='23514';END IF;
END $$;
REVOKE ALL ON FUNCTION partners.lock_coupon_authority(uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION partners.lock_coupon_authority(uuid,text,uuid) TO tt_p2_coupon_worker;

-- Immutable coordination and evidence scope even for a mistaken privileged service write.
CREATE FUNCTION partners.service_record_identity() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_TABLE_NAME='onboarding_profiles' THEN
  IF (NEW.org_id,NEW.email_domain,NEW.policy_version,NEW.created_at) IS DISTINCT FROM (OLD.org_id,OLD.email_domain,OLD.policy_version,OLD.created_at) THEN RAISE EXCEPTION 'Immutable onboarding identity' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='coupon_imports' THEN
  IF (NEW.id,NEW.org_id,NEW.pool_id,NEW.asset_id,NEW.requester,NEW.body_hash,NEW.key_version,NEW.expires_at,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.org_id,OLD.pool_id,OLD.asset_id,OLD.requester,OLD.body_hash,OLD.key_version,OLD.expires_at,OLD.created_at) THEN RAISE EXCEPTION 'Immutable import identity' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION partners.service_record_identity() FROM PUBLIC;
CREATE TRIGGER onboarding_identity BEFORE UPDATE ON partners.onboarding_profiles FOR EACH ROW EXECUTE FUNCTION partners.service_record_identity();
CREATE TRIGGER coupon_import_identity BEFORE UPDATE ON partners.coupon_imports FOR EACH ROW EXECUTE FUNCTION partners.service_record_identity();
CREATE TRIGGER coupon_import_row_immutable BEFORE UPDATE ON partners.coupon_import_rows FOR EACH ROW EXECUTE FUNCTION partners.reject_update();

CREATE FUNCTION partners.lock_coupon_reveal(organization uuid,code uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM 1 FROM partners.coupon_codes c JOIN partners.coupon_pools p ON p.org_id=c.org_id AND p.id=c.pool_id WHERE c.org_id=organization AND c.id=code AND p.state='ready' AND c.state IN('available','issued') AND c.expires_at>clock_timestamp() FOR SHARE OF c,p;
 IF NOT FOUND THEN RAISE EXCEPTION 'Code unavailable' USING ERRCODE='23514';END IF;
END $$;
REVOKE ALL ON FUNCTION partners.lock_coupon_reveal(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION partners.lock_coupon_reveal(uuid,uuid) TO tt_p2_partner_service;

CREATE FUNCTION partners.lock_shared_pool(organization uuid,pool uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM 1 FROM partners.coupon_pools p WHERE p.org_id=organization AND p.id=pool AND p.mode='shared' AND p.state='ready' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Pool unavailable' USING ERRCODE='23514';END IF;
END $$;
REVOKE ALL ON FUNCTION partners.lock_shared_pool(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION partners.lock_shared_pool(uuid,uuid) TO tt_p2_partner_service;
