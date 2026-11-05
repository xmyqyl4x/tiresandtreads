-- Explicitly opt-in disposable P2 track. Runtime roles are provisioned only by test support.
CREATE SCHEMA partners;
REVOKE ALL ON SCHEMA partners FROM PUBLIC;
GRANT USAGE ON SCHEMA partners TO tt_p2_partner_runtime,tt_p2_staff_runtime,tt_p2_worker_runtime;

CREATE TABLE partners.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name text NOT NULL CHECK (length(btrim(legal_name)) BETWEEN 1 AND 200),
  external_org_id text UNIQUE CHECK (length(btrim(external_org_id)) BETWEEN 1 AND 200),
  market text NOT NULL REFERENCES app.markets(code) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended','closed')),
  verification_status text NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending','verified','rejected','expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  CHECK (updated_at >= created_at),
  CHECK (status <> 'active' OR verification_status='verified')
);
CREATE TABLE partners.memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES partners.organizations(id) ON DELETE RESTRICT,
  provider_subject text NOT NULL CHECK (length(btrim(provider_subject)) BETWEEN 1 AND 200),
  role text NOT NULL CHECK (role IN ('owner','manager','analyst')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision>0),
  UNIQUE(org_id,id), UNIQUE(org_id,provider_subject), CHECK(updated_at>=created_at)
);
CREATE INDEX memberships_actor_idx ON partners.memberships(provider_subject,org_id) WHERE status='active';
CREATE TABLE partners.organization_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES partners.organizations(id) ON DELETE RESTRICT,
  asset_id uuid NOT NULL UNIQUE REFERENCES app.object_assets(id) ON DELETE RESTRICT,
  purpose text NOT NULL CHECK (purpose IN ('agreement','verification','coupon_pool','logo')),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','ready','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id,id), UNIQUE(org_id,asset_id), UNIQUE(org_id,asset_id,purpose)
);
CREATE TABLE partners.agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES partners.organizations(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK(kind IN ('pilot_terms','privacy','dpa')),
  version text NOT NULL CHECK(length(btrim(version)) BETWEEN 1 AND 100),
  asset_id uuid NOT NULL,
  asset_purpose text NOT NULL DEFAULT 'agreement' CHECK(asset_purpose='agreement'),
  accepted_by text NOT NULL CHECK(length(btrim(accepted_by)) BETWEEN 1 AND 200),
  accepted_at timestamptz NOT NULL,
  expires_at timestamptz,
  status text NOT NULL DEFAULT 'accepted' CHECK(status IN ('accepted','revoked')),
  billing_mode text NOT NULL DEFAULT 'noncharging' CHECK(billing_mode='noncharging'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id,id), UNIQUE(org_id,kind,version),
  FOREIGN KEY(org_id,accepted_by) REFERENCES partners.memberships(org_id,provider_subject) ON DELETE RESTRICT,
  FOREIGN KEY(org_id,asset_id,asset_purpose) REFERENCES partners.organization_assets(org_id,asset_id,purpose) ON DELETE RESTRICT,
  CHECK(accepted_at>=created_at AND (expires_at IS NULL OR expires_at>accepted_at))
);
CREATE INDEX agreements_current_idx ON partners.agreements(org_id,kind,status,expires_at);
CREATE INDEX agreements_asset_idx ON partners.agreements(org_id,asset_id,asset_purpose);
CREATE TABLE partners.verification_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES partners.organizations(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK(kind IN ('domain','registry','manual')),
  asset_id uuid NOT NULL,
  asset_purpose text NOT NULL DEFAULT 'verification' CHECK(asset_purpose='verification'),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified','rejected','expired')),
  reviewed_by uuid REFERENCES admin.staff_identities(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id,id),
  FOREIGN KEY(org_id,asset_id,asset_purpose) REFERENCES partners.organization_assets(org_id,asset_id,purpose) ON DELETE RESTRICT,
  CHECK(status='pending' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
  CHECK((reviewed_at IS NULL OR reviewed_at>=created_at) AND (expires_at IS NULL OR expires_at>created_at))
);
CREATE INDEX verification_expiry_idx ON partners.verification_records(org_id,status,expires_at,id);
CREATE INDEX verification_asset_idx ON partners.verification_records(org_id,asset_id,asset_purpose);
CREATE INDEX verification_reviewer_idx ON partners.verification_records(reviewed_by);
CREATE TABLE partners.locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES partners.organizations(id) ON DELETE RESTRICT,
  location_key text NOT NULL CHECK(length(btrim(location_key)) BETWEEN 1 AND 100),
  market text NOT NULL REFERENCES app.markets(code) ON DELETE RESTRICT,
  region_key text NOT NULL CHECK(length(btrim(region_key)) BETWEEN 1 AND 100),
  approved_address jsonb NOT NULL CHECK(jsonb_typeof(approved_address)='object' AND octet_length(approved_address::text)<=4096),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','suspended','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id,id), UNIQUE(org_id,location_key)
);
CREATE INDEX locations_market_idx ON partners.locations(market,region_key,org_id,id);
CREATE TABLE partners.organization_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES partners.organizations(id) ON DELETE RESTRICT,
  domain text NOT NULL CHECK(domain=lower(domain) AND domain ~ '^[a-z0-9][a-z0-9.-]{0,251}[a-z0-9]$' AND domain NOT LIKE '%..%'),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified','revoked')),
  reviewed_by uuid REFERENCES admin.staff_identities(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id,id), UNIQUE(org_id,domain),
  CHECK(status<>'verified' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND expires_at IS NOT NULL)),
  CHECK((reviewed_at IS NULL OR reviewed_at>=created_at) AND (expires_at IS NULL OR expires_at>created_at))
);
CREATE INDEX organization_domains_expiry_idx ON partners.organization_domains(org_id,status,expires_at);
CREATE INDEX organization_domains_reviewer_idx ON partners.organization_domains(reviewed_by);

CREATE FUNCTION partners.current_org() RETURNS uuid LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT nullif(current_setting('tt.p2_org',true),'')::uuid
$$;
CREATE FUNCTION partners.has_current_membership(organization uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT organization=partners.current_org() AND EXISTS (
    SELECT 1 FROM partners.memberships m WHERE m.org_id=organization
      AND m.provider_subject=nullif(current_setting('tt.p2_actor',true),'') AND m.status='active'
  )
$$;
CREATE FUNCTION partners.guard_asset_binding() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE expected text;
BEGIN
  IF TG_OP='UPDATE' AND (NEW.org_id,NEW.asset_id,NEW.purpose) IS DISTINCT FROM (OLD.org_id,OLD.asset_id,OLD.purpose) THEN
    RAISE EXCEPTION 'Organization asset identity is immutable' USING ERRCODE='23514';
  END IF;
  expected:=CASE NEW.purpose WHEN 'agreement' THEN 'agreement' WHEN 'verification' THEN 'import_evidence' WHEN 'coupon_pool' THEN 'import_source' WHEN 'logo' THEN 'cms_media' END;
  IF NOT EXISTS(SELECT 1 FROM app.object_assets a WHERE a.id=NEW.asset_id AND a.purpose=expected AND (NEW.state<>'ready' OR a.state='ready')) THEN
    RAISE EXCEPTION 'Wrong asset purpose or readiness' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER organization_asset_binding BEFORE INSERT OR UPDATE ON partners.organization_assets FOR EACH ROW EXECUTE FUNCTION partners.guard_asset_binding();

CREATE FUNCTION partners.guard_identity() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY TG_ARGV LOOP
    IF to_jsonb(NEW)->name IS DISTINCT FROM to_jsonb(OLD)->name THEN
      RAISE EXCEPTION 'Partner identity cannot be reassigned' USING ERRCODE='23514';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE FUNCTION partners.reject_update() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'Partner history is append-only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER organizations_identity BEFORE UPDATE ON partners.organizations FOR EACH ROW EXECUTE FUNCTION partners.guard_identity('id','market','created_at');
CREATE TRIGGER memberships_identity BEFORE UPDATE ON partners.memberships FOR EACH ROW EXECUTE FUNCTION partners.guard_identity('id','org_id','provider_subject','created_at');
CREATE TRIGGER agreements_identity BEFORE UPDATE ON partners.agreements FOR EACH ROW EXECUTE FUNCTION partners.guard_identity('id','org_id','kind','version','asset_id','asset_purpose','accepted_by','accepted_at','billing_mode','created_at');
CREATE TRIGGER verification_identity BEFORE UPDATE ON partners.verification_records FOR EACH ROW EXECUTE FUNCTION partners.guard_identity('id','org_id','asset_id','asset_purpose','created_at');
CREATE TRIGGER locations_identity BEFORE UPDATE ON partners.locations FOR EACH ROW EXECUTE FUNCTION partners.guard_identity('id','org_id','location_key','created_at');
CREATE TRIGGER domains_identity BEFORE UPDATE ON partners.organization_domains FOR EACH ROW EXECUTE FUNCTION partners.guard_identity('id','org_id','domain','created_at');

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA partners FROM PUBLIC;
GRANT EXECUTE ON FUNCTION partners.current_org(),partners.has_current_membership(uuid) TO tt_p2_partner_runtime,tt_p2_staff_runtime,tt_p2_worker_runtime;
GRANT SELECT(id,legal_name,market,status,verification_status,created_at) ON partners.organizations TO tt_p2_partner_runtime;
GRANT SELECT(id,org_id,provider_subject,role,status,created_at) ON partners.memberships TO tt_p2_partner_runtime;
GRANT SELECT(id,org_id,purpose,state,created_at) ON partners.organization_assets TO tt_p2_partner_runtime;
GRANT SELECT(id,org_id,kind,version,accepted_at,expires_at,status,billing_mode) ON partners.agreements TO tt_p2_partner_runtime;
GRANT SELECT(id,org_id,kind,status,reviewed_at,expires_at) ON partners.verification_records TO tt_p2_partner_runtime;
GRANT SELECT ON partners.locations,partners.organization_domains TO tt_p2_partner_runtime;
GRANT SELECT,INSERT,UPDATE ON partners.organizations,partners.memberships,partners.organization_assets,partners.agreements,partners.verification_records,partners.locations,partners.organization_domains TO tt_p2_staff_runtime;
GRANT SELECT(id,market,status,verification_status) ON partners.organizations TO tt_p2_worker_runtime;
GRANT SELECT ON partners.agreements,partners.locations,partners.organization_domains TO tt_p2_worker_runtime;

-- Forced local role policies. Generated from the reviewed fixed table inventory.
ALTER TABLE partners.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE partners.organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY organizations_owner ON partners.organizations TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY organizations_staff ON partners.organizations TO tt_p2_staff_runtime USING(true) WITH CHECK(true);
CREATE POLICY organizations_worker ON partners.organizations TO tt_p2_worker_runtime USING(true) WITH CHECK(true);
CREATE POLICY organizations_tenant ON partners.organizations FOR SELECT TO tt_p2_partner_runtime USING(id=partners.current_org() AND partners.has_current_membership(id));
ALTER TABLE partners.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE partners.memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY memberships_owner ON partners.memberships TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY memberships_staff ON partners.memberships TO tt_p2_staff_runtime USING(true) WITH CHECK(true);
CREATE POLICY memberships_worker ON partners.memberships TO tt_p2_worker_runtime USING(true) WITH CHECK(true);
CREATE POLICY memberships_tenant ON partners.memberships FOR SELECT TO tt_p2_partner_runtime USING(org_id=partners.current_org() AND provider_subject=nullif(current_setting('tt.p2_actor',true),'') AND status='active');
ALTER TABLE partners.organization_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE partners.organization_assets FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_assets_owner ON partners.organization_assets TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY organization_assets_staff ON partners.organization_assets TO tt_p2_staff_runtime USING(true) WITH CHECK(true);
CREATE POLICY organization_assets_worker ON partners.organization_assets TO tt_p2_worker_runtime USING(true) WITH CHECK(true);
CREATE POLICY organization_assets_tenant ON partners.organization_assets FOR SELECT TO tt_p2_partner_runtime USING(org_id=partners.current_org() AND partners.has_current_membership(org_id));
ALTER TABLE partners.agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE partners.agreements FORCE ROW LEVEL SECURITY;
CREATE POLICY agreements_owner ON partners.agreements TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY agreements_staff ON partners.agreements TO tt_p2_staff_runtime USING(true) WITH CHECK(true);
CREATE POLICY agreements_worker ON partners.agreements TO tt_p2_worker_runtime USING(true) WITH CHECK(true);
CREATE POLICY agreements_tenant ON partners.agreements FOR SELECT TO tt_p2_partner_runtime USING(org_id=partners.current_org() AND partners.has_current_membership(org_id));
ALTER TABLE partners.verification_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE partners.verification_records FORCE ROW LEVEL SECURITY;
CREATE POLICY verification_records_owner ON partners.verification_records TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY verification_records_staff ON partners.verification_records TO tt_p2_staff_runtime USING(true) WITH CHECK(true);
CREATE POLICY verification_records_worker ON partners.verification_records TO tt_p2_worker_runtime USING(true) WITH CHECK(true);
CREATE POLICY verification_records_tenant ON partners.verification_records FOR SELECT TO tt_p2_partner_runtime USING(org_id=partners.current_org() AND partners.has_current_membership(org_id));
ALTER TABLE partners.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE partners.locations FORCE ROW LEVEL SECURITY;
CREATE POLICY locations_owner ON partners.locations TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY locations_staff ON partners.locations TO tt_p2_staff_runtime USING(true) WITH CHECK(true);
CREATE POLICY locations_worker ON partners.locations TO tt_p2_worker_runtime USING(true) WITH CHECK(true);
CREATE POLICY locations_tenant ON partners.locations FOR SELECT TO tt_p2_partner_runtime USING(org_id=partners.current_org() AND partners.has_current_membership(org_id));
ALTER TABLE partners.organization_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE partners.organization_domains FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_domains_owner ON partners.organization_domains TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY organization_domains_staff ON partners.organization_domains TO tt_p2_staff_runtime USING(true) WITH CHECK(true);
CREATE POLICY organization_domains_worker ON partners.organization_domains TO tt_p2_worker_runtime USING(true) WITH CHECK(true);
CREATE POLICY organization_domains_tenant ON partners.organization_domains FOR SELECT TO tt_p2_partner_runtime USING(org_id=partners.current_org() AND partners.has_current_membership(org_id));
