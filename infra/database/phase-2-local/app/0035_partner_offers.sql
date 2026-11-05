-- Same-owner send key is additive; no original row, grant or migration is rewritten.
ALTER TABLE email.email_sends ADD CONSTRAINT p2_send_owner_uq UNIQUE(id,owner_subject_id);

CREATE TABLE partners.offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES partners.organizations(id) ON DELETE RESTRICT,
  current_version integer,
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pending_review','active','paused','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id,id), CHECK(current_version IS NULL OR current_version>0),
  CHECK(status<>'active' OR current_version IS NOT NULL)
);
CREATE TABLE partners.offer_versions (
  org_id uuid NOT NULL REFERENCES partners.organizations(id) ON DELETE RESTRICT,
  offer_id uuid NOT NULL,
  version integer NOT NULL CHECK(version>0),
  supersedes_version integer,
  title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 200),
  description text NOT NULL CHECK(length(btrim(description)) BETWEEN 1 AND 2000),
  terms jsonb NOT NULL CHECK(jsonb_typeof(terms)='object' AND octet_length(terms::text)<=16384),
  discount_type text NOT NULL CHECK(discount_type IN ('percent_off','amount_off','set_of_four_off','buy_three_get_one','free_service','mail_in_rebate','price_match')),
  amount_minor bigint CHECK(amount_minor>0),
  currency_code text REFERENCES app.currencies(code) ON DELETE RESTRICT,
  percent_basis_points integer CHECK(percent_basis_points BETWEEN 1 AND 10000),
  service_code text CHECK(service_code IN ('fitting','alignment','tpms')),
  minimum_tires smallint NOT NULL DEFAULT 1 CHECK(minimum_tires BETWEEN 1 AND 4),
  minimum_purchase_minor bigint CHECK(minimum_purchase_minor>=0),
  minimum_purchase_currency text REFERENCES app.currencies(code) ON DELETE RESTRICT,
  redemption_method text NOT NULL CHECK(redemption_method IN ('online_code','in_store_code','link')),
  redemption_domain text,
  redemption_url text CHECK(length(redemption_url)<=2048 AND redemption_url ~ '^https://[^[:space:]@]+$'),
  logo_asset_id uuid,
  logo_purpose text NOT NULL DEFAULT 'logo' CHECK(logo_purpose='logo'),
  logo_rights_warranted boolean NOT NULL DEFAULT false,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pending_review','reviewed','published','retired')),
  created_by uuid NOT NULL REFERENCES admin.staff_identities(id) ON DELETE RESTRICT,
  reviewed_by uuid REFERENCES admin.staff_identities(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(org_id,offer_id,version),
  FOREIGN KEY(org_id,offer_id) REFERENCES partners.offers(org_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(org_id,offer_id,supersedes_version) REFERENCES partners.offer_versions(org_id,offer_id,version) ON DELETE RESTRICT,
  FOREIGN KEY(org_id,redemption_domain) REFERENCES partners.organization_domains(org_id,domain) ON DELETE RESTRICT,
  FOREIGN KEY(org_id,logo_asset_id,logo_purpose) REFERENCES partners.organization_assets(org_id,asset_id,purpose) ON DELETE RESTRICT,
  CHECK(supersedes_version IS NULL OR supersedes_version<version),
  CHECK(valid_until>=valid_from+interval '3 days'),
  CHECK(status NOT IN ('reviewed','published','retired') OR (reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL AND reviewed_by<>created_by)),
  CHECK(reviewed_at IS NULL OR reviewed_at>=created_at),
  CHECK((redemption_url IS NULL)=(redemption_domain IS NULL)),
  CHECK(redemption_method<>'link' OR redemption_url IS NOT NULL),
  CHECK(redemption_url IS NULL OR (position(chr(92) in redemption_url)=0
    AND COALESCE(lower(substring(redemption_url FROM '^https://([^/:?#]+)(:443)?([/?#]|$)'))=redemption_domain,false))),
  CHECK(logo_asset_id IS NULL OR logo_rights_warranted),
  CHECK((discount_type='percent_off')=(percent_basis_points IS NOT NULL)),
  CHECK((discount_type IN ('amount_off','set_of_four_off','mail_in_rebate'))=(amount_minor IS NOT NULL)),
  CHECK((amount_minor IS NULL)=(currency_code IS NULL)),
  CHECK((minimum_purchase_minor IS NULL)=(minimum_purchase_currency IS NULL)),
  CHECK((discount_type='free_service')=(service_code IS NOT NULL)),
  CHECK(discount_type NOT IN ('set_of_four_off','buy_three_get_one') OR minimum_tires=4)
);
ALTER TABLE partners.offers ADD CONSTRAINT offers_current_version_fk FOREIGN KEY(org_id,id,current_version)
  REFERENCES partners.offer_versions(org_id,offer_id,version) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX offer_versions_expiry_idx ON partners.offer_versions(org_id,status,valid_until,offer_id);
CREATE INDEX offer_versions_creator_idx ON partners.offer_versions(created_by);
CREATE INDEX offer_versions_reviewer_idx ON partners.offer_versions(reviewed_by);
CREATE INDEX offer_versions_domain_idx ON partners.offer_versions(org_id,redemption_domain);
CREATE INDEX offer_versions_logo_idx ON partners.offer_versions(org_id,logo_asset_id,logo_purpose);
CREATE TABLE partners.offer_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES partners.organizations(id) ON DELETE RESTRICT,
  offer_id uuid NOT NULL,
  offer_version integer NOT NULL,
  market text NOT NULL REFERENCES app.markets(code) ON DELETE RESTRICT,
  strategy text NOT NULL CHECK(strategy IN ('store_wide','sku','model','brand','category','rim','size','vehicle_type','tier','region','postal','radius')),
  sku_id uuid REFERENCES app.tire_skus(id) ON DELETE RESTRICT,
  model_id uuid REFERENCES app.tire_models(id) ON DELETE RESTRICT,
  brand_entity_id uuid REFERENCES app.domain_entities(id) ON DELETE RESTRICT,
  location_id uuid,
  value_text text CHECK(length(btrim(value_text)) BETWEEN 1 AND 100),
  rim_inches numeric(4,1) CHECK(rim_inches>0 AND rim_inches<=100),
  radius_km numeric(8,2) CHECK(radius_km>0 AND radius_km<=5000),
  rule jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(rule)='object' AND octet_length(rule::text)<=4096),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id,id),
  FOREIGN KEY(org_id,offer_id,offer_version) REFERENCES partners.offer_versions(org_id,offer_id,version) ON DELETE RESTRICT,
  FOREIGN KEY(org_id,location_id) REFERENCES partners.locations(org_id,id) ON DELETE RESTRICT,
  CHECK((strategy='store_wide' AND num_nonnulls(sku_id,model_id,brand_entity_id,value_text,rim_inches,radius_km)=0)
    OR (strategy='sku' AND sku_id IS NOT NULL AND num_nonnulls(sku_id,model_id,brand_entity_id,value_text,rim_inches,radius_km)=1)
    OR (strategy='model' AND model_id IS NOT NULL AND num_nonnulls(sku_id,model_id,brand_entity_id,value_text,rim_inches,radius_km)=1)
    OR (strategy='brand' AND brand_entity_id IS NOT NULL AND num_nonnulls(sku_id,model_id,brand_entity_id,value_text,rim_inches,radius_km)=1)
    OR (strategy IN ('category','size','vehicle_type','tier','region','postal') AND value_text IS NOT NULL AND num_nonnulls(sku_id,model_id,brand_entity_id,value_text,rim_inches,radius_km)=1)
    OR (strategy='rim' AND rim_inches IS NOT NULL AND num_nonnulls(sku_id,model_id,brand_entity_id,value_text,rim_inches,radius_km)=1)
    OR (strategy='radius' AND location_id IS NOT NULL AND radius_km IS NOT NULL AND num_nonnulls(sku_id,model_id,brand_entity_id,value_text,rim_inches,radius_km)=1))
);
CREATE INDEX offer_targets_version_idx ON partners.offer_targets(org_id,offer_id,offer_version,id);
CREATE INDEX offer_targets_location_idx ON partners.offer_targets(org_id,location_id);
CREATE INDEX offer_targets_sku_idx ON partners.offer_targets(sku_id) WHERE sku_id IS NOT NULL;
CREATE INDEX offer_targets_model_idx ON partners.offer_targets(model_id) WHERE model_id IS NOT NULL;
CREATE INDEX offer_targets_brand_idx ON partners.offer_targets(brand_entity_id) WHERE brand_entity_id IS NOT NULL;

CREATE TABLE partners.coupon_pools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES partners.organizations(id) ON DELETE RESTRICT,
  offer_id uuid NOT NULL,
  offer_version integer NOT NULL,
  mode text NOT NULL CHECK(mode IN ('shared','generated','unique')),
  asset_id uuid,
  asset_purpose text NOT NULL DEFAULT 'coupon_pool' CHECK(asset_purpose='coupon_pool'),
  state text NOT NULL DEFAULT 'quarantined' CHECK(state IN ('quarantined','ready','exhausted','closed')),
  generated_prefix text CHECK(generated_prefix ~ '^[A-Za-z0-9_-]{1,32}$'),
  shared_code_hmac bytea CHECK(octet_length(shared_code_hmac)=32),
  encrypted_shared_code bytea CHECK(octet_length(encrypted_shared_code) BETWEEN 32 AND 4096),
  key_version text CHECK(length(btrim(key_version)) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id,id), UNIQUE(org_id,id,mode), UNIQUE(org_id,id,offer_id,offer_version),
  FOREIGN KEY(org_id,offer_id,offer_version) REFERENCES partners.offer_versions(org_id,offer_id,version) ON DELETE RESTRICT,
  FOREIGN KEY(org_id,asset_id,asset_purpose) REFERENCES partners.organization_assets(org_id,asset_id,purpose) ON DELETE RESTRICT,
  CHECK((mode='shared' AND shared_code_hmac IS NOT NULL AND encrypted_shared_code IS NOT NULL AND key_version IS NOT NULL)
    OR (mode<>'shared' AND shared_code_hmac IS NULL AND encrypted_shared_code IS NULL AND key_version IS NULL)),
  CHECK(mode='generated' OR generated_prefix IS NULL)
);
CREATE INDEX coupon_pools_version_idx ON partners.coupon_pools(org_id,offer_id,offer_version,state,id);
CREATE INDEX coupon_pools_asset_idx ON partners.coupon_pools(org_id,asset_id,asset_purpose);
CREATE TABLE partners.coupon_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES partners.organizations(id) ON DELETE RESTRICT,
  pool_id uuid NOT NULL,
  pool_mode text NOT NULL CHECK(pool_mode IN ('generated','unique')),
  code_hmac bytea NOT NULL CHECK(octet_length(code_hmac)=32),
  encrypted_code bytea NOT NULL CHECK(octet_length(encrypted_code) BETWEEN 32 AND 4096),
  key_version text NOT NULL CHECK(length(btrim(key_version)) BETWEEN 1 AND 100),
  state text NOT NULL DEFAULT 'quarantined' CHECK(state IN ('available','reserved','quarantined','issued','redeemed','expired','void')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id,id), UNIQUE(org_id,pool_id,id), UNIQUE(pool_id,code_hmac),
  FOREIGN KEY(org_id,pool_id,pool_mode) REFERENCES partners.coupon_pools(org_id,id,mode) ON DELETE RESTRICT,
  CHECK(expires_at>created_at)
);
CREATE INDEX coupon_codes_available_idx ON partners.coupon_codes(org_id,pool_id,expires_at,id) WHERE state='available';

CREATE TABLE partners.coupon_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES partners.organizations(id) ON DELETE RESTRICT,
  send_id uuid NOT NULL,
  owner_subject_id uuid NOT NULL,
  offer_id uuid NOT NULL,
  offer_version integer NOT NULL,
  pool_id uuid NOT NULL,
  pool_mode text NOT NULL CHECK(pool_mode IN ('shared','generated','unique')),
  code_id uuid,
  slot smallint NOT NULL CHECK(slot BETWEEN 1 AND 3),
  state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','issued','uncertain','quarantined','redeemed','released')),
  policy_version text NOT NULL CHECK(length(btrim(policy_version)) BETWEEN 1 AND 100),
  reserved_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  release_reason text CHECK(release_reason IN ('cancelled_before_dispatch','definitively_not_sent','expired_unstarted')),
  release_evidence_id uuid REFERENCES admin.audit_events(id) ON DELETE RESTRICT,
  UNIQUE(org_id,id), UNIQUE(org_id,id,offer_id,offer_version),
  FOREIGN KEY(send_id,owner_subject_id) REFERENCES email.email_sends(id,owner_subject_id) ON DELETE RESTRICT,
  FOREIGN KEY(org_id,pool_id,offer_id,offer_version) REFERENCES partners.coupon_pools(org_id,id,offer_id,offer_version) ON DELETE RESTRICT,
  FOREIGN KEY(org_id,pool_id,pool_mode) REFERENCES partners.coupon_pools(org_id,id,mode) ON DELETE RESTRICT,
  FOREIGN KEY(org_id,pool_id,code_id) REFERENCES partners.coupon_codes(org_id,pool_id,id) ON DELETE RESTRICT,
  CHECK((pool_mode='shared')=(code_id IS NULL)),
  CHECK((state='released' AND released_at IS NOT NULL AND release_reason IS NOT NULL AND release_evidence_id IS NOT NULL)
    OR (state<>'released' AND released_at IS NULL AND release_reason IS NULL AND release_evidence_id IS NULL)),
  CHECK(released_at IS NULL OR released_at>=reserved_at)
);
CREATE UNIQUE INDEX coupon_reservations_live_code_uq ON partners.coupon_reservations(code_id) WHERE state<>'released' AND code_id IS NOT NULL;
CREATE UNIQUE INDEX coupon_reservations_live_org_uq ON partners.coupon_reservations(send_id,org_id) WHERE state<>'released';
CREATE UNIQUE INDEX coupon_reservations_live_slot_uq ON partners.coupon_reservations(send_id,slot) WHERE state<>'released';
CREATE INDEX coupon_reservations_subject_idx ON partners.coupon_reservations(owner_subject_id,reserved_at,id);
CREATE INDEX coupon_reservations_version_idx ON partners.coupon_reservations(org_id,offer_id,offer_version,id);
CREATE INDEX coupon_reservations_evidence_idx ON partners.coupon_reservations(release_evidence_id);
CREATE TABLE partners.offer_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES partners.organizations(id) ON DELETE RESTRICT,
  send_id uuid NOT NULL,
  owner_subject_id uuid NOT NULL,
  offer_id uuid NOT NULL,
  offer_version integer NOT NULL,
  policy_version text NOT NULL CHECK(length(btrim(policy_version)) BETWEEN 1 AND 100),
  outcome text NOT NULL CHECK(outcome IN ('eligible','selected','excluded','unavailable')),
  reason_codes jsonb NOT NULL CHECK(CASE WHEN jsonb_typeof(reason_codes)='array' THEN jsonb_array_length(reason_codes)<=32 AND NOT jsonb_path_exists(reason_codes,'$[*] ? (@.type() != "string")') AND octet_length(reason_codes::text)<=8192 ELSE false END),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id,id), UNIQUE(org_id,send_id,offer_id,offer_version,policy_version),
  FOREIGN KEY(send_id,owner_subject_id) REFERENCES email.email_sends(id,owner_subject_id) ON DELETE RESTRICT,
  FOREIGN KEY(org_id,offer_id,offer_version) REFERENCES partners.offer_versions(org_id,offer_id,version) ON DELETE RESTRICT,
  CHECK(expires_at>created_at)
);
CREATE INDEX offer_decisions_subject_idx ON partners.offer_decisions(owner_subject_id,id);
CREATE INDEX offer_decisions_version_idx ON partners.offer_decisions(org_id,offer_id,offer_version,id);

CREATE TABLE partners.frequency_guards (
  subject_id uuid NOT NULL REFERENCES app.subjects(id) ON DELETE RESTRICT,
  scope_key text NOT NULL CHECK(scope_key='overall_marketing' OR scope_key ~ '^offer:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  policy_version text NOT NULL CHECK(length(btrim(policy_version)) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(subject_id,scope_key)
);
CREATE TABLE partners.frequency_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL,
  scope_key text NOT NULL,
  send_id uuid NOT NULL,
  reserved_at timestamptz NOT NULL DEFAULT now(),
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  window_kind text NOT NULL CHECK(window_kind IN ('rolling_30_days','calendar_month')),
  calendar_time_zone text CHECK(length(btrim(calendar_time_zone)) BETWEEN 1 AND 100),
  policy_version text NOT NULL CHECK(length(btrim(policy_version)) BETWEEN 1 AND 100),
  state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','issued','uncertain','released')),
  released_at timestamptz,
  release_evidence_id uuid REFERENCES admin.audit_events(id) ON DELETE RESTRICT,
  UNIQUE(send_id,scope_key),
  FOREIGN KEY(subject_id,scope_key) REFERENCES partners.frequency_guards(subject_id,scope_key) ON DELETE RESTRICT,
  FOREIGN KEY(send_id,subject_id) REFERENCES email.email_sends(id,owner_subject_id) ON DELETE RESTRICT,
  CHECK(window_end>window_start AND reserved_at>=window_start AND reserved_at<window_end),
  CHECK((window_kind='calendar_month')=(calendar_time_zone IS NOT NULL)),
  CHECK(window_kind<>'rolling_30_days' OR window_end=window_start+interval '30 days'),
  CHECK((scope_key='overall_marketing')=(window_kind='calendar_month')),
  CHECK((state='released' AND released_at IS NOT NULL AND release_evidence_id IS NOT NULL)
    OR (state<>'released' AND released_at IS NULL AND release_evidence_id IS NULL)),
  CHECK(released_at IS NULL OR released_at>=reserved_at)
);
CREATE INDEX frequency_reservations_window_idx ON partners.frequency_reservations(subject_id,scope_key,reserved_at DESC);
CREATE INDEX frequency_reservations_evidence_idx ON partners.frequency_reservations(release_evidence_id);
CREATE TABLE partners.offer_cap_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES partners.organizations(id) ON DELETE RESTRICT,
  offer_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('total','day','budget')),
  policy_version text NOT NULL CHECK(length(btrim(policy_version)) BETWEEN 1 AND 100),
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  limit_units bigint NOT NULL CHECK(limit_units>=0),
  consumed_units bigint NOT NULL DEFAULT 0 CHECK(consumed_units>=0 AND consumed_units<=limit_units),
  currency_code text REFERENCES app.currencies(code) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id,id), UNIQUE(org_id,id,offer_id), UNIQUE(org_id,offer_id,kind,window_start,policy_version),
  FOREIGN KEY(org_id,offer_id) REFERENCES partners.offers(org_id,id) ON DELETE RESTRICT,
  CHECK(window_end>window_start), CHECK((kind='budget')=(currency_code IS NOT NULL))
);
CREATE TABLE partners.cap_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES partners.organizations(id) ON DELETE RESTRICT,
  cap_id uuid NOT NULL,
  reservation_id uuid NOT NULL,
  offer_id uuid NOT NULL,
  offer_version integer NOT NULL,
  units bigint NOT NULL CHECK(units>0),
  state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','issued','uncertain','released')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id,id), UNIQUE(org_id,cap_id,reservation_id),
  FOREIGN KEY(org_id,cap_id,offer_id) REFERENCES partners.offer_cap_windows(org_id,id,offer_id) ON DELETE RESTRICT,
  FOREIGN KEY(org_id,reservation_id,offer_id,offer_version) REFERENCES partners.coupon_reservations(org_id,id,offer_id,offer_version) ON DELETE RESTRICT
);
CREATE INDEX cap_reservations_assignment_idx ON partners.cap_reservations(org_id,reservation_id);

CREATE FUNCTION partners.guard_offer_version() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF OLD.status IN ('reviewed','published','retired') THEN
    IF (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status')
      OR NOT (NEW.status=OLD.status OR (OLD.status='reviewed' AND NEW.status IN ('published','retired')) OR (OLD.status='published' AND NEW.status='retired')) THEN
      RAISE EXCEPTION 'Reviewed offer version is immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER offer_versions_identity BEFORE UPDATE ON partners.offer_versions FOR EACH ROW EXECUTE FUNCTION partners.guard_identity('org_id','offer_id','version','created_at');
CREATE TRIGGER offer_versions_immutable BEFORE UPDATE ON partners.offer_versions FOR EACH ROW EXECUTE FUNCTION partners.guard_offer_version();
CREATE FUNCTION partners.guard_offer_target() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE phase text;
BEGIN
  IF TG_OP='UPDATE' AND (NEW.org_id,NEW.offer_id,NEW.offer_version,NEW.id) IS DISTINCT FROM (OLD.org_id,OLD.offer_id,OLD.offer_version,OLD.id) THEN
    RAISE EXCEPTION 'Target identity is immutable' USING ERRCODE='23514';
  END IF;
  SELECT status INTO phase FROM partners.offer_versions
    WHERE org_id=NEW.org_id AND offer_id=NEW.offer_id AND version=NEW.offer_version FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Target parent must already exist' USING ERRCODE='23503'; END IF;
  IF phase IN ('reviewed','published','retired') THEN
    RAISE EXCEPTION 'Reviewed offer targets are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER offer_targets_immutable BEFORE INSERT OR UPDATE ON partners.offer_targets FOR EACH ROW EXECUTE FUNCTION partners.guard_offer_target();
CREATE TRIGGER offers_identity BEFORE UPDATE ON partners.offers FOR EACH ROW EXECUTE FUNCTION partners.guard_identity('id','org_id','created_at');
CREATE TRIGGER coupon_pools_identity BEFORE UPDATE ON partners.coupon_pools FOR EACH ROW EXECUTE FUNCTION partners.guard_identity('id','org_id','offer_id','offer_version','mode','asset_id','asset_purpose','generated_prefix','shared_code_hmac','created_at');
CREATE TRIGGER coupon_codes_identity BEFORE UPDATE ON partners.coupon_codes FOR EACH ROW EXECUTE FUNCTION partners.guard_identity('id','org_id','pool_id','pool_mode','code_hmac','created_at');
CREATE TRIGGER offer_decisions_immutable BEFORE UPDATE ON partners.offer_decisions FOR EACH ROW EXECUTE FUNCTION partners.reject_update();
CREATE TRIGGER frequency_guard_identity BEFORE UPDATE ON partners.frequency_guards FOR EACH ROW EXECUTE FUNCTION partners.guard_identity('subject_id','scope_key','created_at');
CREATE TRIGGER frequency_reservation_identity BEFORE UPDATE ON partners.frequency_reservations FOR EACH ROW EXECUTE FUNCTION partners.guard_identity('id','subject_id','scope_key','send_id','reserved_at','window_start','window_end','window_kind','calendar_time_zone','policy_version');
CREATE TRIGGER cap_window_identity BEFORE UPDATE ON partners.offer_cap_windows FOR EACH ROW EXECUTE FUNCTION partners.guard_identity('id','org_id','offer_id','kind','policy_version','window_start','window_end','currency_code','limit_units','created_at');
CREATE TRIGGER cap_reservation_identity BEFORE UPDATE ON partners.cap_reservations FOR EACH ROW EXECUTE FUNCTION partners.guard_identity('id','org_id','cap_id','reservation_id','offer_id','offer_version','units','created_at');

CREATE FUNCTION partners.guard_coupon_reservation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF OLD.state='released' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Released assignment history is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.state<>NEW.state AND NOT (
    (OLD.state='reserved' AND NEW.state IN ('issued','uncertain','quarantined','released')) OR
    (OLD.state='issued' AND NEW.state IN ('redeemed','uncertain','quarantined')) OR
    (OLD.state IN ('uncertain','quarantined') AND NEW.state IN ('issued','uncertain','quarantined','released'))
  ) THEN RAISE EXCEPTION 'Invalid assignment transition' USING ERRCODE='23514'; END IF;
  IF OLD.state IN ('uncertain','quarantined') AND NEW.state='released' AND NEW.release_reason<>'definitively_not_sent' THEN
    RAISE EXCEPTION 'Uncertain assignment needs definitive non-use evidence' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER coupon_reservations_identity BEFORE UPDATE ON partners.coupon_reservations FOR EACH ROW EXECUTE FUNCTION partners.guard_identity('id','org_id','send_id','owner_subject_id','offer_id','offer_version','pool_id','pool_mode','code_id','slot','policy_version','reserved_at');
CREATE TRIGGER coupon_reservations_transition BEFORE UPDATE ON partners.coupon_reservations FOR EACH ROW EXECUTE FUNCTION partners.guard_coupon_reservation();
CREATE FUNCTION partners.guard_frequency_release() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF OLD.state='released' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Released frequency history is immutable' USING ERRCODE='23514'; END IF;
  IF OLD.state<>NEW.state AND NOT (
    (OLD.state='reserved' AND NEW.state IN ('issued','uncertain','released')) OR
    (OLD.state='uncertain' AND NEW.state IN ('issued','released'))
  ) THEN RAISE EXCEPTION 'Invalid frequency usage transition' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER frequency_release BEFORE UPDATE ON partners.frequency_reservations FOR EACH ROW EXECUTE FUNCTION partners.guard_frequency_release();
CREATE FUNCTION partners.guard_frequency_policy() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE evaluated text;
BEGIN
  SELECT policy_version INTO evaluated FROM partners.frequency_guards
    WHERE subject_id=NEW.subject_id AND scope_key=NEW.scope_key FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Evaluated frequency guard must already exist' USING ERRCODE='23503'; END IF;
  IF NEW.policy_version IS DISTINCT FROM evaluated THEN
    RAISE EXCEPTION 'Frequency reservation requires the current evaluated policy' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER frequency_policy BEFORE INSERT ON partners.frequency_reservations FOR EACH ROW EXECUTE FUNCTION partners.guard_frequency_policy();

CREATE VIEW partners.eligible_offer_versions WITH (security_barrier=true) AS
SELECT o.org_id,o.id AS offer_id,v.version,v.valid_from,v.valid_until,v.title,v.discount_type
FROM partners.offers o JOIN partners.organizations company ON company.id=o.org_id
JOIN partners.offer_versions v ON v.org_id=o.org_id AND v.offer_id=o.id AND v.version=o.current_version
WHERE o.status='active' AND company.status='active' AND company.verification_status='verified'
  AND v.status='published' AND v.valid_from<=statement_timestamp() AND v.valid_until>statement_timestamp()
  AND EXISTS(SELECT 1 FROM partners.offer_targets t WHERE t.org_id=o.org_id AND t.offer_id=o.id AND t.offer_version=v.version AND t.market=company.market)
  AND (SELECT count(DISTINCT a.kind) FROM partners.agreements a
    JOIN partners.organization_assets b ON b.org_id=a.org_id AND b.asset_id=a.asset_id
    JOIN app.object_assets physical ON physical.id=b.asset_id
    WHERE a.org_id=o.org_id AND a.status='accepted' AND a.accepted_at<=statement_timestamp()
      AND (a.expires_at IS NULL OR a.expires_at>statement_timestamp()) AND b.state='ready' AND physical.state='ready')=3
  AND (v.redemption_domain IS NULL OR EXISTS(SELECT 1 FROM partners.organization_domains d
    WHERE d.org_id=o.org_id AND d.domain=v.redemption_domain AND d.status='verified' AND d.expires_at>statement_timestamp()))
  AND (v.logo_asset_id IS NULL OR EXISTS(SELECT 1 FROM partners.organization_assets b
    JOIN app.object_assets physical ON physical.id=b.asset_id
    WHERE b.org_id=o.org_id AND b.asset_id=v.logo_asset_id AND b.purpose='logo' AND b.state='ready' AND physical.state='ready'));
CREATE FUNCTION partners.guard_offer_pointer() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE current_offer partners.offers%ROWTYPE; phase text;
BEGIN
  SELECT * INTO current_offer FROM partners.offers WHERE id=NEW.id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF current_offer.current_version IS NOT NULL THEN
    SELECT v.status INTO phase FROM partners.offer_versions v
      WHERE v.org_id=current_offer.org_id AND v.offer_id=current_offer.id AND v.version=current_offer.current_version FOR SHARE;
    IF NOT FOUND OR phase IS DISTINCT FROM 'published' THEN
      RAISE EXCEPTION 'Current offer pointer needs its own published version' USING ERRCODE='23514';
    END IF;
  END IF;
  IF current_offer.status='active' AND NOT EXISTS(SELECT 1 FROM partners.eligible_offer_versions e WHERE e.org_id=current_offer.org_id AND e.offer_id=current_offer.id) THEN
    RAISE EXCEPTION 'Active offer needs verified current organization, terms, domain and version' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER offers_current_guard AFTER INSERT OR UPDATE ON partners.offers
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION partners.guard_offer_pointer();
CREATE FUNCTION partners.guard_current_version_status() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM partners.offers o JOIN partners.offer_versions v
    ON v.org_id=o.org_id AND v.offer_id=o.id AND v.version=o.current_version
    WHERE o.org_id=NEW.org_id AND o.id=NEW.offer_id AND v.status<>'published') THEN
    RAISE EXCEPTION 'Current pointer cannot retain an unpublished version' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER offer_current_status AFTER UPDATE ON partners.offer_versions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION partners.guard_current_version_status();

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA partners FROM PUBLIC;
GRANT SELECT ON partners.offers,partners.offer_versions,partners.offer_targets TO tt_p2_partner_runtime;
GRANT SELECT(id,org_id,offer_id,offer_version,mode,state,generated_prefix,created_at) ON partners.coupon_pools TO tt_p2_partner_runtime;
GRANT SELECT,INSERT,UPDATE ON partners.offers,partners.offer_versions,partners.offer_targets TO tt_p2_staff_runtime;
GRANT SELECT(id,org_id,offer_id,offer_version,mode,state,generated_prefix,created_at) ON partners.coupon_pools TO tt_p2_staff_runtime;
GRANT SELECT ON partners.offers,partners.offer_versions,partners.offer_targets TO tt_p2_worker_runtime;
GRANT SELECT,INSERT,UPDATE ON partners.coupon_pools,partners.coupon_codes,partners.coupon_reservations,
  partners.frequency_guards,partners.frequency_reservations,partners.offer_cap_windows,partners.cap_reservations TO tt_p2_worker_runtime;
GRANT SELECT,INSERT ON partners.offer_decisions TO tt_p2_worker_runtime;
GRANT SELECT ON partners.eligible_offer_versions TO tt_p2_worker_runtime,tt_p2_staff_runtime;

-- Forced local role policies. Generated from the reviewed fixed table inventory.
ALTER TABLE partners.offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE partners.offers FORCE ROW LEVEL SECURITY;
CREATE POLICY offers_owner ON partners.offers TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY offers_staff ON partners.offers TO tt_p2_staff_runtime USING(true) WITH CHECK(true);
CREATE POLICY offers_worker ON partners.offers TO tt_p2_worker_runtime USING(true) WITH CHECK(true);
CREATE POLICY offers_tenant ON partners.offers FOR SELECT TO tt_p2_partner_runtime USING(org_id=partners.current_org() AND partners.has_current_membership(org_id));
ALTER TABLE partners.offer_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE partners.offer_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY offer_versions_owner ON partners.offer_versions TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY offer_versions_staff ON partners.offer_versions TO tt_p2_staff_runtime USING(true) WITH CHECK(true);
CREATE POLICY offer_versions_worker ON partners.offer_versions TO tt_p2_worker_runtime USING(true) WITH CHECK(true);
CREATE POLICY offer_versions_tenant ON partners.offer_versions FOR SELECT TO tt_p2_partner_runtime USING(org_id=partners.current_org() AND partners.has_current_membership(org_id));
ALTER TABLE partners.offer_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE partners.offer_targets FORCE ROW LEVEL SECURITY;
CREATE POLICY offer_targets_owner ON partners.offer_targets TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY offer_targets_staff ON partners.offer_targets TO tt_p2_staff_runtime USING(true) WITH CHECK(true);
CREATE POLICY offer_targets_worker ON partners.offer_targets TO tt_p2_worker_runtime USING(true) WITH CHECK(true);
CREATE POLICY offer_targets_tenant ON partners.offer_targets FOR SELECT TO tt_p2_partner_runtime USING(org_id=partners.current_org() AND partners.has_current_membership(org_id));
ALTER TABLE partners.coupon_pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE partners.coupon_pools FORCE ROW LEVEL SECURITY;
CREATE POLICY coupon_pools_owner ON partners.coupon_pools TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY coupon_pools_staff ON partners.coupon_pools TO tt_p2_staff_runtime USING(true) WITH CHECK(true);
CREATE POLICY coupon_pools_worker ON partners.coupon_pools TO tt_p2_worker_runtime USING(true) WITH CHECK(true);
CREATE POLICY coupon_pools_tenant ON partners.coupon_pools FOR SELECT TO tt_p2_partner_runtime USING(org_id=partners.current_org() AND partners.has_current_membership(org_id));
ALTER TABLE partners.coupon_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE partners.coupon_codes FORCE ROW LEVEL SECURITY;
CREATE POLICY coupon_codes_owner ON partners.coupon_codes TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY coupon_codes_staff ON partners.coupon_codes TO tt_p2_staff_runtime USING(true) WITH CHECK(true);
CREATE POLICY coupon_codes_worker ON partners.coupon_codes TO tt_p2_worker_runtime USING(true) WITH CHECK(true);
ALTER TABLE partners.coupon_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE partners.coupon_reservations FORCE ROW LEVEL SECURITY;
CREATE POLICY coupon_reservations_owner ON partners.coupon_reservations TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY coupon_reservations_staff ON partners.coupon_reservations TO tt_p2_staff_runtime USING(true) WITH CHECK(true);
CREATE POLICY coupon_reservations_worker ON partners.coupon_reservations TO tt_p2_worker_runtime USING(true) WITH CHECK(true);
ALTER TABLE partners.offer_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE partners.offer_decisions FORCE ROW LEVEL SECURITY;
CREATE POLICY offer_decisions_owner ON partners.offer_decisions TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY offer_decisions_staff ON partners.offer_decisions TO tt_p2_staff_runtime USING(true) WITH CHECK(true);
CREATE POLICY offer_decisions_worker ON partners.offer_decisions TO tt_p2_worker_runtime USING(true) WITH CHECK(true);
ALTER TABLE partners.frequency_guards ENABLE ROW LEVEL SECURITY;
ALTER TABLE partners.frequency_guards FORCE ROW LEVEL SECURITY;
CREATE POLICY frequency_guards_owner ON partners.frequency_guards TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY frequency_guards_staff ON partners.frequency_guards TO tt_p2_staff_runtime USING(true) WITH CHECK(true);
CREATE POLICY frequency_guards_worker ON partners.frequency_guards TO tt_p2_worker_runtime USING(true) WITH CHECK(true);
ALTER TABLE partners.frequency_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE partners.frequency_reservations FORCE ROW LEVEL SECURITY;
CREATE POLICY frequency_reservations_owner ON partners.frequency_reservations TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY frequency_reservations_staff ON partners.frequency_reservations TO tt_p2_staff_runtime USING(true) WITH CHECK(true);
CREATE POLICY frequency_reservations_worker ON partners.frequency_reservations TO tt_p2_worker_runtime USING(true) WITH CHECK(true);
ALTER TABLE partners.offer_cap_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE partners.offer_cap_windows FORCE ROW LEVEL SECURITY;
CREATE POLICY offer_cap_windows_owner ON partners.offer_cap_windows TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY offer_cap_windows_staff ON partners.offer_cap_windows TO tt_p2_staff_runtime USING(true) WITH CHECK(true);
CREATE POLICY offer_cap_windows_worker ON partners.offer_cap_windows TO tt_p2_worker_runtime USING(true) WITH CHECK(true);
ALTER TABLE partners.cap_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE partners.cap_reservations FORCE ROW LEVEL SECURITY;
CREATE POLICY cap_reservations_owner ON partners.cap_reservations TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY cap_reservations_staff ON partners.cap_reservations TO tt_p2_staff_runtime USING(true) WITH CHECK(true);
CREATE POLICY cap_reservations_worker ON partners.cap_reservations TO tt_p2_worker_runtime USING(true) WITH CHECK(true);
