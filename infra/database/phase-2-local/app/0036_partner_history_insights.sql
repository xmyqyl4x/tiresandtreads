CREATE TABLE partners.redemption_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES partners.organizations(id) ON DELETE RESTRICT,
  reservation_id uuid NOT NULL,
  offer_id uuid NOT NULL,
  offer_version integer NOT NULL,
  external_event_key text NOT NULL CHECK(length(btrim(external_event_key)) BETWEEN 1 AND 200),
  kind text NOT NULL CHECK(kind IN ('reported','correction','reversal')),
  quantity_delta smallint NOT NULL CHECK(quantity_delta BETWEEN -4 AND 4 AND quantity_delta<>0),
  reverses_event_id uuid,
  verified_sale boolean NOT NULL DEFAULT false CHECK(NOT verified_sale),
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id,id), UNIQUE(org_id,reservation_id,id), UNIQUE(org_id,external_event_key),
  FOREIGN KEY(org_id,reservation_id,offer_id,offer_version) REFERENCES partners.coupon_reservations(org_id,id,offer_id,offer_version) ON DELETE RESTRICT,
  FOREIGN KEY(org_id,reservation_id,reverses_event_id) REFERENCES partners.redemption_events(org_id,reservation_id,id) ON DELETE RESTRICT,
  CHECK((kind='reported' AND reverses_event_id IS NULL AND quantity_delta>0) OR (kind IN ('correction','reversal') AND reverses_event_id IS NOT NULL)),
  CHECK(kind<>'reversal' OR quantity_delta<0), CHECK(reverses_event_id IS NULL OR reverses_event_id<>id)
);
CREATE UNIQUE INDEX redemption_events_one_correction_uq ON partners.redemption_events(reverses_event_id) WHERE reverses_event_id IS NOT NULL;
CREATE INDEX redemption_events_offer_idx ON partners.redemption_events(org_id,offer_id,offer_version,occurred_at,id);
CREATE TRIGGER redemption_events_immutable BEFORE UPDATE ON partners.redemption_events FOR EACH ROW EXECUTE FUNCTION partners.reject_update();
CREATE FUNCTION partners.guard_redemption() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE mode text; previous smallint;
BEGIN
  SELECT pool_mode INTO mode FROM partners.coupon_reservations WHERE org_id=NEW.org_id AND id=NEW.reservation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Redemption reservation must already exist' USING ERRCODE='23503'; END IF;
  IF mode='shared' THEN RAISE EXCEPTION 'Shared code cannot attribute a reported redemption' USING ERRCODE='23514'; END IF;
  IF NEW.reverses_event_id IS NOT NULL THEN
    SELECT quantity_delta INTO previous FROM partners.redemption_events
      WHERE org_id=NEW.org_id AND reservation_id=NEW.reservation_id AND id=NEW.reverses_event_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Correction parent must already exist in the same assignment' USING ERRCODE='23503';
    END IF;
    IF NEW.kind='reversal' AND NEW.quantity_delta<>-previous THEN
      RAISE EXCEPTION 'Reversal quantity must negate the referenced event' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER redemption_events_consistency BEFORE INSERT ON partners.redemption_events FOR EACH ROW EXECUTE FUNCTION partners.guard_redemption();
CREATE TABLE partners.disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES partners.organizations(id) ON DELETE RESTRICT,
  reservation_id uuid NOT NULL,
  reason_code text NOT NULL CHECK(reason_code IN ('terms','not_honored','redemption','error','other')),
  state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','reviewing','closed')),
  encrypted_details bytea NOT NULL CHECK(octet_length(encrypted_details) BETWEEN 32 AND 8192),
  key_version text NOT NULL CHECK(length(btrim(key_version)) BETWEEN 1 AND 100),
  resolution_event_id uuid,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id,id),
  FOREIGN KEY(org_id,reservation_id) REFERENCES partners.coupon_reservations(org_id,id) ON DELETE RESTRICT,
  CHECK((state='closed' AND closed_at IS NOT NULL AND resolution_event_id IS NOT NULL)
    OR (state<>'closed' AND closed_at IS NULL AND resolution_event_id IS NULL)),
  CHECK(closed_at IS NULL OR closed_at>=created_at)
);
CREATE INDEX disputes_assignment_idx ON partners.disputes(org_id,reservation_id);
CREATE INDEX disputes_queue_idx ON partners.disputes(org_id,state,created_at,id);
CREATE TABLE partners.dispute_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES partners.organizations(id) ON DELETE RESTRICT,
  dispute_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('opened','evidence','correction','resolved','reopened')),
  reverses_event_id uuid,
  encrypted_details bytea NOT NULL CHECK(octet_length(encrypted_details) BETWEEN 32 AND 8192),
  key_version text NOT NULL CHECK(length(btrim(key_version)) BETWEEN 1 AND 100),
  actor_staff_id uuid REFERENCES admin.staff_identities(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id,id), UNIQUE(org_id,dispute_id,id),
  FOREIGN KEY(org_id,dispute_id) REFERENCES partners.disputes(org_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(org_id,dispute_id,reverses_event_id) REFERENCES partners.dispute_events(org_id,dispute_id,id) ON DELETE RESTRICT,
  CHECK((kind='correction')=(reverses_event_id IS NOT NULL)), CHECK(reverses_event_id IS NULL OR reverses_event_id<>id)
);
CREATE INDEX dispute_events_actor_idx ON partners.dispute_events(actor_staff_id);
CREATE INDEX dispute_events_parent_idx ON partners.dispute_events(org_id,dispute_id,occurred_at,id);
ALTER TABLE partners.disputes ADD CONSTRAINT disputes_resolution_fk FOREIGN KEY(org_id,id,resolution_event_id)
  REFERENCES partners.dispute_events(org_id,dispute_id,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX disputes_resolution_idx ON partners.disputes(org_id,id,resolution_event_id);
CREATE TRIGGER dispute_events_immutable BEFORE UPDATE ON partners.dispute_events FOR EACH ROW EXECUTE FUNCTION partners.reject_update();
CREATE TRIGGER disputes_identity BEFORE UPDATE ON partners.disputes FOR EACH ROW EXECUTE FUNCTION partners.guard_identity('id','org_id','reservation_id','created_at');

CREATE TABLE partners.insight_heads (
  org_id uuid PRIMARY KEY REFERENCES partners.organizations(id) ON DELETE RESTRICT,
  revision bigint NOT NULL CHECK(revision>0),
  state text NOT NULL DEFAULT 'dirty' CHECK(state IN ('dirty','ready')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE partners.daily_metrics (
  org_id uuid NOT NULL REFERENCES partners.organizations(id) ON DELETE RESTRICT,
  generation bigint NOT NULL CHECK(generation>0),
  day date NOT NULL,
  metric text NOT NULL CHECK(metric IN ('included','clicks','codes_issued','reported_redemptions','complaints')),
  market text NOT NULL REFERENCES app.markets(code) ON DELETE RESTRICT,
  total_count bigint NOT NULL CHECK(total_count>=0),
  sample_size bigint NOT NULL CHECK(sample_size>=0),
  minimum_cohort integer NOT NULL CHECK(minimum_cohort>=10),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','reviewed','invalidated')),
  reviewed_by uuid REFERENCES admin.staff_identities(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(org_id,generation,day,metric,market),
  CHECK(status<>'reviewed' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
  CHECK(reviewed_at IS NULL OR reviewed_at>=created_at)
);
CREATE INDEX daily_metrics_review_idx ON partners.daily_metrics(reviewed_by);
CREATE FUNCTION partners.guard_insight_head() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.org_id<>OLD.org_id OR NEW.revision<OLD.revision OR (OLD.state='dirty' AND NEW.state='ready' AND NEW.revision<=OLD.revision) THEN
    RAISE EXCEPTION 'Insight generation must advance before republishing' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER insight_generation BEFORE UPDATE ON partners.insight_heads FOR EACH ROW EXECUTE FUNCTION partners.guard_insight_head();
CREATE VIEW partners.partner_daily_metrics WITH (security_barrier=true) AS
SELECT m.org_id,m.day,m.metric,m.market,m.total_count
FROM partners.daily_metrics m JOIN partners.insight_heads h ON h.org_id=m.org_id AND h.revision=m.generation
WHERE m.org_id=partners.current_org() AND partners.has_current_membership(m.org_id)
  AND h.state='ready' AND m.status='reviewed' AND m.reviewed_by IS NOT NULL AND m.reviewed_at IS NOT NULL
  AND m.sample_size>=m.minimum_cohort AND m.minimum_cohort>=10;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA partners FROM PUBLIC;
GRANT SELECT(id,org_id,reason_code,state,closed_at,created_at) ON partners.disputes TO tt_p2_partner_runtime;
GRANT SELECT ON partners.partner_daily_metrics TO tt_p2_partner_runtime;
GRANT SELECT,INSERT,UPDATE ON partners.disputes TO tt_p2_staff_runtime;
GRANT SELECT,INSERT ON partners.dispute_events TO tt_p2_staff_runtime;
GRANT SELECT ON partners.redemption_events TO tt_p2_staff_runtime;
GRANT SELECT,INSERT ON partners.redemption_events,partners.dispute_events TO tt_p2_worker_runtime;
GRANT SELECT,INSERT,UPDATE ON partners.disputes,partners.insight_heads,partners.daily_metrics TO tt_p2_worker_runtime;

-- Forced local role policies. Generated from the reviewed fixed table inventory.
ALTER TABLE partners.redemption_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE partners.redemption_events FORCE ROW LEVEL SECURITY;
CREATE POLICY redemption_events_owner ON partners.redemption_events TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY redemption_events_staff ON partners.redemption_events TO tt_p2_staff_runtime USING(true) WITH CHECK(true);
CREATE POLICY redemption_events_worker ON partners.redemption_events TO tt_p2_worker_runtime USING(true) WITH CHECK(true);
ALTER TABLE partners.disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE partners.disputes FORCE ROW LEVEL SECURITY;
CREATE POLICY disputes_owner ON partners.disputes TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY disputes_staff ON partners.disputes TO tt_p2_staff_runtime USING(true) WITH CHECK(true);
CREATE POLICY disputes_worker ON partners.disputes TO tt_p2_worker_runtime USING(true) WITH CHECK(true);
CREATE POLICY disputes_tenant ON partners.disputes FOR SELECT TO tt_p2_partner_runtime USING(org_id=partners.current_org() AND partners.has_current_membership(org_id));
ALTER TABLE partners.dispute_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE partners.dispute_events FORCE ROW LEVEL SECURITY;
CREATE POLICY dispute_events_owner ON partners.dispute_events TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY dispute_events_staff ON partners.dispute_events TO tt_p2_staff_runtime USING(true) WITH CHECK(true);
CREATE POLICY dispute_events_worker ON partners.dispute_events TO tt_p2_worker_runtime USING(true) WITH CHECK(true);
ALTER TABLE partners.insight_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE partners.insight_heads FORCE ROW LEVEL SECURITY;
CREATE POLICY insight_heads_owner ON partners.insight_heads TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY insight_heads_staff ON partners.insight_heads TO tt_p2_staff_runtime USING(true) WITH CHECK(true);
CREATE POLICY insight_heads_worker ON partners.insight_heads TO tt_p2_worker_runtime USING(true) WITH CHECK(true);
ALTER TABLE partners.daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE partners.daily_metrics FORCE ROW LEVEL SECURITY;
CREATE POLICY daily_metrics_owner ON partners.daily_metrics TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY daily_metrics_staff ON partners.daily_metrics TO tt_p2_staff_runtime USING(true) WITH CHECK(true);
CREATE POLICY daily_metrics_worker ON partners.daily_metrics TO tt_p2_worker_runtime USING(true) WITH CHECK(true);
