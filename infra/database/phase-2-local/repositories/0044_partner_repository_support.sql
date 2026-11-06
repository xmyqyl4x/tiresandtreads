-- Opt-in local S2 support only. All identities are supplied by disposable test support.
GRANT USAGE ON SCHEMA partners TO tt_p2_identity_writer;
GRANT SELECT,INSERT ON partners.organizations,partners.memberships TO tt_p2_identity_writer;
GRANT UPDATE(legal_name,status,verification_status,revision,updated_at) ON partners.organizations TO tt_p2_identity_writer;
GRANT UPDATE(role,status,revision,updated_at) ON partners.memberships TO tt_p2_identity_writer;
CREATE POLICY organizations_identity_writer ON partners.organizations TO tt_p2_identity_writer USING(true) WITH CHECK(true);
CREATE POLICY memberships_identity_writer ON partners.memberships TO tt_p2_identity_writer USING(true) WITH CHECK(true);
CREATE TABLE partners.allocation_receipts (
 org_id uuid NOT NULL REFERENCES partners.organizations(id),
 request_key text NOT NULL CHECK(length(btrim(request_key)) BETWEEN 1 AND 200),
 request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),
 reservation_id uuid NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(org_id,request_key),
 FOREIGN KEY(org_id,reservation_id) REFERENCES partners.coupon_reservations(org_id,id)
);
ALTER TABLE partners.allocation_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE partners.allocation_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY allocation_receipts_owner ON partners.allocation_receipts TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY allocation_receipts_writer ON partners.allocation_receipts TO tt_p2_allocation_runtime USING(true) WITH CHECK(true);
CREATE TRIGGER allocation_receipts_immutable BEFORE UPDATE ON partners.allocation_receipts FOR EACH ROW EXECUTE FUNCTION partners.reject_update();
REVOKE ALL ON partners.allocation_receipts FROM PUBLIC;

GRANT USAGE ON SCHEMA partners TO tt_p2_offer_writer,tt_p2_allocation_runtime,tt_p2_pilot_reader;
GRANT EXECUTE ON FUNCTION partners.current_org(),partners.has_current_membership(uuid) TO tt_p2_pilot_reader;
GRANT SELECT(id,legal_name,market,status,verification_status,revision) ON partners.organizations TO tt_p2_pilot_reader;
GRANT SELECT(org_id,provider_subject,role,status,revision) ON partners.memberships TO tt_p2_pilot_reader;
GRANT SELECT(id,org_id,market,region_key,status) ON partners.locations TO tt_p2_pilot_reader;
GRANT SELECT(org_id,kind,status,accepted_at,expires_at) ON partners.agreements TO tt_p2_pilot_reader;
GRANT SELECT(id,org_id,status) ON partners.offers TO tt_p2_pilot_reader;
GRANT SELECT ON partners.offer_versions,partners.partner_daily_metrics TO tt_p2_pilot_reader;
GRANT SELECT(id,org_id,reason_code,state,created_at,closed_at) ON partners.disputes TO tt_p2_pilot_reader;
GRANT SELECT(org_id,revision,state) ON partners.insight_heads TO tt_p2_pilot_reader;
CREATE POLICY organizations_pilot ON partners.organizations FOR SELECT TO tt_p2_pilot_reader USING(id=partners.current_org() AND partners.has_current_membership(id));
CREATE POLICY memberships_pilot ON partners.memberships FOR SELECT TO tt_p2_pilot_reader USING(org_id=partners.current_org() AND provider_subject=nullif(current_setting('tt.p2_actor',true),'') AND status='active');
CREATE POLICY locations_pilot ON partners.locations FOR SELECT TO tt_p2_pilot_reader USING(org_id=partners.current_org() AND partners.has_current_membership(org_id));
CREATE POLICY agreements_pilot ON partners.agreements FOR SELECT TO tt_p2_pilot_reader USING(org_id=partners.current_org() AND partners.has_current_membership(org_id));
CREATE POLICY offers_pilot ON partners.offers FOR SELECT TO tt_p2_pilot_reader USING(org_id=partners.current_org() AND partners.has_current_membership(org_id));
CREATE POLICY versions_pilot ON partners.offer_versions FOR SELECT TO tt_p2_pilot_reader USING(org_id=partners.current_org() AND partners.has_current_membership(org_id));
CREATE POLICY disputes_pilot ON partners.disputes FOR SELECT TO tt_p2_pilot_reader USING(org_id=partners.current_org() AND partners.has_current_membership(org_id));
CREATE POLICY insight_heads_pilot ON partners.insight_heads FOR SELECT TO tt_p2_pilot_reader USING(org_id=partners.current_org() AND partners.has_current_membership(org_id));

GRANT SELECT,INSERT ON partners.offers,partners.offer_versions TO tt_p2_offer_writer;
GRANT UPDATE(status,current_version) ON partners.offers TO tt_p2_offer_writer;
GRANT UPDATE(status,reviewed_by,reviewed_at) ON partners.offer_versions TO tt_p2_offer_writer;
GRANT SELECT,INSERT ON partners.offer_targets TO tt_p2_offer_writer;
GRANT SELECT ON partners.eligible_offer_versions TO tt_p2_offer_writer;
CREATE POLICY offers_repository_writer ON partners.offers TO tt_p2_offer_writer USING(true) WITH CHECK(true);
CREATE POLICY versions_repository_writer ON partners.offer_versions TO tt_p2_offer_writer USING(true) WITH CHECK(true);
CREATE POLICY targets_repository_writer ON partners.offer_targets TO tt_p2_offer_writer USING(true) WITH CHECK(true);

GRANT SELECT ON partners.coupon_pools,partners.coupon_codes,partners.coupon_reservations,
 partners.frequency_guards,partners.frequency_reservations,partners.offer_cap_windows,partners.cap_reservations,
 partners.offer_decisions,partners.allocation_receipts,partners.redemption_events TO tt_p2_allocation_runtime;
GRANT INSERT ON partners.coupon_reservations,partners.frequency_guards,partners.frequency_reservations,
 partners.cap_reservations,partners.offer_decisions,partners.allocation_receipts,partners.redemption_events TO tt_p2_allocation_runtime;
GRANT UPDATE(state) ON partners.coupon_codes,partners.cap_reservations TO tt_p2_allocation_runtime;
GRANT UPDATE(scope_key) ON partners.frequency_guards TO tt_p2_allocation_runtime;
GRANT UPDATE(consumed_units) ON partners.offer_cap_windows TO tt_p2_allocation_runtime;
GRANT UPDATE(state,released_at,release_evidence_id) ON partners.frequency_reservations TO tt_p2_allocation_runtime;
GRANT UPDATE(state,released_at,release_reason,release_evidence_id) ON partners.coupon_reservations TO tt_p2_allocation_runtime;
CREATE POLICY pools_allocation ON partners.coupon_pools TO tt_p2_allocation_runtime USING(true) WITH CHECK(true);
CREATE POLICY codes_allocation ON partners.coupon_codes TO tt_p2_allocation_runtime USING(true) WITH CHECK(true);
CREATE POLICY reservations_allocation ON partners.coupon_reservations TO tt_p2_allocation_runtime USING(true) WITH CHECK(true);
CREATE POLICY frequency_guards_allocation ON partners.frequency_guards TO tt_p2_allocation_runtime USING(true) WITH CHECK(true);
CREATE POLICY frequency_reservations_allocation ON partners.frequency_reservations TO tt_p2_allocation_runtime USING(true) WITH CHECK(true);
CREATE POLICY cap_windows_allocation ON partners.offer_cap_windows TO tt_p2_allocation_runtime USING(true) WITH CHECK(true);
CREATE POLICY cap_reservations_allocation ON partners.cap_reservations TO tt_p2_allocation_runtime USING(true) WITH CHECK(true);
CREATE POLICY decisions_allocation ON partners.offer_decisions TO tt_p2_allocation_runtime USING(true) WITH CHECK(true);
CREATE POLICY redemption_allocation ON partners.redemption_events TO tt_p2_allocation_runtime USING(true) WITH CHECK(true);

-- Fixed, narrow lock bridges; the allocator receives no direct subject/contact/send grants.
CREATE FUNCTION partners.lock_allocation_root(subject uuid,send uuid,require_open boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE person app.subjects%ROWTYPE; message email.email_sends%ROWTYPE;
BEGIN
 SELECT * INTO person FROM app.subjects WHERE id=subject FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Allocation root unavailable' USING ERRCODE='23514'; END IF;
 SELECT * INTO message FROM email.email_sends WHERE id=send FOR UPDATE;
 IF NOT FOUND OR message.owner_subject_id IS DISTINCT FROM subject THEN
  RAISE EXCEPTION 'Allocation root unavailable' USING ERRCODE='23514'; END IF;
 IF require_open AND (person.status<>'active' OR (person.expires_at IS NOT NULL AND person.expires_at<=clock_timestamp())
  OR message.dispatch_state NOT IN ('scheduled','dispatching') OR message.anonymized_at IS NOT NULL OR message.payload_asset_id IS NOT NULL OR message.payload_hash IS NOT NULL
  OR NOT(message.requested_purposes ? 'offers')) THEN
  RAISE EXCEPTION 'Allocation root unavailable' USING ERRCODE='23514'; END IF;
END $$;
CREATE FUNCTION partners.lock_allocation_offer(organization uuid,offer uuid,version_number integer,pool uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE phase text; selected integer; mode text;
BEGIN
 PERFORM 1 FROM partners.organizations WHERE id=organization FOR SHARE;
 SELECT current_version INTO selected FROM partners.offers WHERE org_id=organization AND id=offer FOR SHARE;
 IF NOT FOUND OR selected IS DISTINCT FROM version_number THEN RAISE EXCEPTION 'Allocation version changed' USING ERRCODE='23514'; END IF;
 SELECT status INTO phase FROM partners.offer_versions WHERE org_id=organization AND offer_id=offer AND version=version_number FOR SHARE;
 IF phase IS DISTINCT FROM 'published' OR NOT EXISTS(SELECT 1 FROM partners.eligible_offer_versions WHERE org_id=organization AND offer_id=offer AND version=version_number) THEN
  RAISE EXCEPTION 'Allocation version unavailable' USING ERRCODE='23514'; END IF;
 SELECT p.mode INTO mode FROM partners.coupon_pools p WHERE p.org_id=organization AND p.id=pool AND p.offer_id=offer AND p.offer_version=version_number AND p.state='ready' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Allocation pool unavailable' USING ERRCODE='23514'; END IF;
 RETURN mode;
END $$;
REVOKE ALL ON FUNCTION partners.lock_allocation_root(uuid,uuid,boolean),partners.lock_allocation_offer(uuid,uuid,integer,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION partners.lock_allocation_root(uuid,uuid,boolean),partners.lock_allocation_offer(uuid,uuid,integer,uuid) TO tt_p2_allocation_runtime;

CREATE FUNCTION partners.lock_offer_write(organization uuid,offer uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM 1 FROM partners.organizations WHERE id=organization FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Offer organization unavailable' USING ERRCODE='23503'; END IF;
 -- Also serializes first creation, before a lockable offer row exists.
 PERFORM pg_advisory_xact_lock(hashtextextended('partner-offer:'||offer::text,0));
 PERFORM 1 FROM partners.offers WHERE org_id=organization AND id=offer FOR UPDATE;
END $$;
REVOKE ALL ON FUNCTION partners.lock_offer_write(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION partners.lock_offer_write(uuid,uuid) TO tt_p2_offer_writer;
