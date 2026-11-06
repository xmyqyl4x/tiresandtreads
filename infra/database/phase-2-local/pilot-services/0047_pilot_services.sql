-- Disposable opt-in service support. No default manifest, hosted role or activation change.
CREATE TABLE partners.pilot_requests(
 send_id uuid PRIMARY KEY REFERENCES email.email_sends(id),item_key text NOT NULL CHECK(length(item_key) BETWEEN 1 AND 200),
 adult boolean NOT NULL,quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 4),geo jsonb NOT NULL CHECK(jsonb_typeof(geo)='object' AND octet_length(geo::text)<=4096 AND geo ?& ARRAY['box','digest','includeOffers'] AND NOT(geo ?| ARRAY['region','postal','latitude','longitude']) AND geo->>'digest' ~ '^[a-f0-9]{64}$'),
 body_hash text NOT NULL CHECK(body_hash ~ '^[a-f0-9]{64}$'),policy_version text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '30 days'
);
CREATE TABLE partners.pilot_work(
 send_id uuid PRIMARY KEY REFERENCES partners.pilot_requests(send_id),
 state text NOT NULL DEFAULT 'queued' CHECK(state IN('queued','reserved','dispatching','accepted','failed','uncertain','cancelled','suppressed')),
 lease_token uuid,lease_generation bigint NOT NULL DEFAULT 0 CHECK(lease_generation>=0),lease_until timestamptz,
 payload bytea,payload_key_version text,payload_hash text CHECK(payload_hash ~ '^[a-f0-9]{64}$'),payload_asset_id uuid REFERENCES app.object_assets(id),payload_object_hash text,provider_started_at timestamptz,attempt_id uuid REFERENCES email.send_attempts(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(num_nonnulls(payload,payload_key_version,payload_hash) IN(0,3)),CHECK(payload IS NULL OR octet_length(payload) BETWEEN 32 AND 8388608)
);
CREATE INDEX pilot_work_ready_idx ON partners.pilot_work(state,lease_until,send_id);
CREATE TABLE partners.pilot_considerations(
 send_id uuid NOT NULL REFERENCES partners.pilot_requests(send_id),generation bigint NOT NULL,org_id uuid NOT NULL,offer_id uuid NOT NULL,offer_version integer NOT NULL,
 score integer NOT NULL CHECK(score BETWEEN 0 AND 10000),eligible boolean NOT NULL,selected boolean NOT NULL,reasons jsonb NOT NULL CHECK(jsonb_typeof(reasons)='array' AND octet_length(reasons::text)<=8192),
 factors jsonb NOT NULL CHECK(jsonb_typeof(factors)='object' AND octet_length(factors::text)<=4096),
 created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '30 days',
 PRIMARY KEY(send_id,generation,offer_id),FOREIGN KEY(org_id,offer_id,offer_version) REFERENCES partners.offer_versions(org_id,offer_id,version)
);
CREATE TABLE partners.pilot_usage(
 send_id uuid PRIMARY KEY REFERENCES partners.pilot_requests(send_id),recipient_subject_id uuid NOT NULL REFERENCES app.subjects(id),
 state text NOT NULL DEFAULT 'reserved' CHECK(state IN('reserved','issued','uncertain','released')),reserved_at timestamptz NOT NULL DEFAULT clock_timestamp(),time_zone text NOT NULL
);
CREATE TABLE partners.pilot_payload_refs(send_id uuid NOT NULL REFERENCES partners.pilot_requests(send_id),asset_id uuid NOT NULL UNIQUE,generation bigint NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(send_id,asset_id));
CREATE INDEX pilot_usage_recipient_idx ON partners.pilot_usage(recipient_subject_id,reserved_at,send_id) WHERE state<>'released';
CREATE TRIGGER pilot_payload_ref_immutable BEFORE UPDATE ON partners.pilot_payload_refs FOR EACH ROW EXECUTE FUNCTION partners.reject_update();
CREATE TRIGGER pilot_request_immutable BEFORE UPDATE ON partners.pilot_requests FOR EACH ROW EXECUTE FUNCTION partners.reject_update();
CREATE TRIGGER pilot_consideration_immutable BEFORE UPDATE ON partners.pilot_considerations FOR EACH ROW EXECUTE FUNCTION partners.reject_update();
CREATE FUNCTION partners.guard_pilot_work() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.send_id<>OLD.send_id OR NEW.lease_generation<OLD.lease_generation OR (OLD.provider_started_at IS NOT NULL AND
 (NEW.payload,NEW.payload_key_version,NEW.payload_hash,NEW.payload_asset_id,NEW.payload_object_hash,NEW.provider_started_at,NEW.attempt_id) IS DISTINCT FROM (OLD.payload,OLD.payload_key_version,OLD.payload_hash,OLD.payload_asset_id,OLD.payload_object_hash,OLD.provider_started_at,OLD.attempt_id)) THEN
 RAISE EXCEPTION 'Pilot attempted identity and bytes are immutable' USING ERRCODE='23514';END IF;
 IF OLD.state IN('accepted','failed','uncertain','cancelled','suppressed') AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Terminal pilot work is immutable' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pilot_work_identity BEFORE UPDATE ON partners.pilot_work FOR EACH ROW EXECUTE FUNCTION partners.guard_pilot_work();
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['pilot_requests','pilot_work','pilot_considerations','pilot_usage','pilot_payload_refs'] LOOP
 EXECUTE format('ALTER TABLE partners.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE partners.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY pilot_owner ON partners.%I TO tt_app_migrator USING(true) WITH CHECK(true)',t);
 EXECUTE format('CREATE POLICY pilot_worker ON partners.%I TO tt_p2_pilot_service USING(true) WITH CHECK(true)',t);
 END LOOP;
END $$;
GRANT USAGE ON SCHEMA partners TO tt_p2_pilot_service;
GRANT SELECT,INSERT ON partners.pilot_requests,partners.pilot_considerations TO tt_p2_pilot_service;
GRANT SELECT,INSERT ON partners.pilot_payload_refs TO tt_p2_pilot_service;
GRANT SELECT,INSERT,UPDATE ON partners.pilot_work,partners.pilot_usage TO tt_p2_pilot_service;
-- Fixed lock order matches P1: all relevant subjects sorted, then send and owned work.
CREATE FUNCTION partners.pilot_root(message uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ids uuid[];BEGIN
 SELECT ARRAY[s.owner_subject_id,c.subject_id] INTO ids FROM email.email_sends s JOIN privacy.contacts c ON c.id=s.recipient_contact_id WHERE s.id=message;
 IF ids IS NULL THEN RAISE EXCEPTION 'Pilot root unavailable' USING ERRCODE='23514';END IF;
 PERFORM 1 FROM app.subjects WHERE id=ANY(ids) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM email.email_sends WHERE id=message FOR UPDATE;
 PERFORM 1 FROM partners.pilot_work WHERE send_id=message FOR UPDATE;
END $$;
CREATE FUNCTION partners.pilot_blocked(person uuid,scopes text[]) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM privacy.suppressions s WHERE s.subject_id=person AND s.scope_key=ANY(scopes) AND s.lifted_at IS NULL AND s.effective_at<=statement_timestamp() AND (s.expires_at IS NULL OR s.expires_at>statement_timestamp()))
 OR EXISTS(SELECT 1 FROM privacy.contact_lookups l JOIN privacy.suppression_tombstones t ON t.key_version=l.key_version AND t.lookup_hmac=l.email_hmac JOIN privacy.contacts c ON c.id=l.contact_id
 WHERE c.subject_id=person AND t.scope_key=ANY(scopes) AND t.effective_at<=statement_timestamp() AND (t.expires_at IS NULL OR t.expires_at>statement_timestamp()));
$$;
CREATE FUNCTION partners.pilot_owner_authorize(message uuid,keys jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM partners.pilot_root(message);
 IF NOT EXISTS(SELECT 1 FROM email.email_sends s JOIN app.owner_sessions o ON o.subject_id=s.owner_subject_id JOIN app.subjects person ON person.id=o.subject_id JOIN jsonb_to_recordset(keys) k(key_version text,digest text) ON o.key_version=k.key_version AND o.token_hash=decode(k.digest,'hex')
 WHERE s.id=message AND s.anonymized_at IS NULL AND o.revoked_at IS NULL AND o.expires_at>clock_timestamp() AND person.status='active' AND (person.expires_at IS NULL OR person.expires_at>clock_timestamp())) THEN RAISE EXCEPTION 'Pilot owner unavailable' USING ERRCODE='23514';END IF;
END $$;
REVOKE ALL ON FUNCTION partners.pilot_owner_authorize(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION partners.pilot_owner_authorize(uuid,jsonb) TO tt_p2_pilot_service;
CREATE FUNCTION partners.pilot_capture(message uuid,keys jsonb,item text,adult boolean,quantity integer,geo jsonb,body text,policy text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s email.email_sends%ROWTYPE;old partners.pilot_requests%ROWTYPE;
BEGIN
 PERFORM partners.pilot_owner_authorize(message,keys);
 SELECT * INTO s FROM email.email_sends WHERE id=message;
 IF NOT EXISTS(SELECT 1 FROM app.owner_sessions o JOIN app.subjects person ON person.id=o.subject_id JOIN jsonb_to_recordset(keys) k(key_version text,digest text) ON o.key_version=k.key_version AND o.token_hash=decode(k.digest,'hex')
 WHERE o.subject_id=s.owner_subject_id AND o.revoked_at IS NULL AND o.expires_at>clock_timestamp() AND person.status='active' AND (person.expires_at IS NULL OR person.expires_at>clock_timestamp())) THEN RAISE EXCEPTION 'Pilot owner unavailable' USING ERRCODE='23514';END IF;
 SELECT * INTO old FROM partners.pilot_requests WHERE send_id=message;
 IF FOUND THEN IF old.body_hash<>body OR old.policy_version<>policy THEN RAISE EXCEPTION 'Pilot request conflict' USING ERRCODE='23505';END IF;RETURN;END IF;
 IF s.dispatch_state<>'scheduled' OR s.anonymized_at IS NOT NULL OR s.payload_asset_id IS NOT NULL OR s.kind NOT IN('report','offers') OR s.report_id IS NULL
 OR NOT EXISTS(SELECT 1 FROM app.report_items WHERE report_id=s.report_id AND report_version=s.report_version AND item_key=item AND kind='picked')
 OR NOT EXISTS(SELECT 1 FROM email.delivery_snapshots WHERE send_id=message) THEN RAISE EXCEPTION 'Explicit pilot handoff required' USING ERRCODE='23514';END IF;
 PERFORM 1 FROM email.delivery_work WHERE send_id=message FOR UPDATE;
 IF EXISTS(SELECT 1 FROM email.delivery_work WHERE send_id=message AND (lease_until IS NOT NULL OR first_attempt_at IS NOT NULL OR payload_asset_id IS NOT NULL))
 OR EXISTS(SELECT 1 FROM email.delivery_asset_reservations reservation JOIN app.object_assets asset ON asset.id=reservation.asset_id WHERE reservation.send_id=message) THEN RAISE EXCEPTION 'P1 work is already owned or rendered' USING ERRCODE='23514';END IF;
 DELETE FROM email.delivery_work WHERE send_id=message;
 DELETE FROM email.delivery_asset_reservations WHERE send_id=message;
 IF geo->'includeOffers' IS NULL OR jsonb_typeof(geo->'includeOffers')<>'boolean' THEN RAISE EXCEPTION 'Explicit offers choice required' USING ERRCODE='23514';END IF;
 UPDATE email.email_sends SET requested_purposes=CASE WHEN (geo->>'includeOffers')::boolean THEN CASE WHEN requested_purposes ? 'offers' THEN requested_purposes ELSE requested_purposes||'"offers"'::jsonb END ELSE requested_purposes-'offers' END WHERE id=message;
 INSERT INTO partners.pilot_requests(send_id,item_key,adult,quantity,geo,body_hash,policy_version) VALUES(message,item,adult,quantity,geo,body,policy);
 INSERT INTO partners.pilot_work(send_id) VALUES(message);
END $$;
-- Current source rights are read again at reservation and claim, never inferred from a historic report.
CREATE FUNCTION partners.pilot_dataset_live(dataset uuid,bundle uuid,market_code text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.bundle_members b JOIN app.dataset_versions d ON d.id=b.dataset_version_id JOIN app.data_providers p ON p.id=d.provider_id JOIN app.data_licenses l ON l.id=d.license_id
 WHERE b.bundle_id=bundle AND b.dataset_version_id=dataset AND d.status='published' AND d.effective_at<=statement_timestamp() AND p.status='active' AND l.market=market_code AND l.reviewed_at<=statement_timestamp()
 AND l.effective_at<=statement_timestamp() AND (l.expires_at IS NULL OR l.expires_at>statement_timestamp()) AND l.rights @> '{"display":true,"derived":true,"snapshot":true}');
$$;
CREATE FUNCTION partners.pilot_product(sku uuid,bundle uuid,market_code text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('skuId',s.id,'modelId',s.model_id,'brandId',(SELECT l.brand_entity_id FROM app.tire_model_reference_links l WHERE l.tire_model_id=s.model_id AND l.match_status='reviewed' AND partners.pilot_dataset_live(l.dataset_version_id,bundle,market_code) ORDER BY l.id LIMIT 1),
 'size',s.size_code,'rim',s.rim_inches::text,'category',m.category,'vehicleType',NULL,'tier',NULL)
 FROM app.tire_skus s JOIN app.tire_models m ON m.id=s.model_id
 WHERE s.id=sku AND s.status='active' AND partners.pilot_dataset_live(s.dataset_version_id,bundle,market_code) AND partners.pilot_dataset_live(m.dataset_version_id,bundle,market_code);
$$;
CREATE FUNCTION partners.pilot_context(message uuid,token uuid,generation bigint,notice uuid,report_notice uuid,policy text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s email.email_sends%ROWTYPE;c privacy.contacts%ROWTYPE;person app.subjects%ROWTYPE;r app.reports%ROWTYPE;request partners.pilot_requests%ROWTYPE;
 output jsonb;plan jsonb;products jsonb;doc jsonb;live boolean;offers boolean;report boolean;report_scope text;sub_total text;source_quantity integer;
BEGIN
 PERFORM partners.pilot_root(message);
 IF NOT EXISTS(SELECT 1 FROM partners.pilot_work w WHERE w.send_id=message AND w.lease_token=token AND w.lease_generation=generation AND w.lease_until>clock_timestamp() AND w.state IN('queued','reserved','dispatching')) THEN RAISE EXCEPTION 'Pilot lease unavailable' USING ERRCODE='23514';END IF;
 SELECT * INTO s FROM email.email_sends WHERE id=message;SELECT * INTO c FROM privacy.contacts WHERE id=s.recipient_contact_id;SELECT * INTO person FROM app.subjects WHERE id=c.subject_id;
 SELECT * INTO r FROM app.reports WHERE id=s.report_id;SELECT * INTO request FROM partners.pilot_requests WHERE send_id=message;
 SELECT v.output_snapshot INTO output FROM app.report_versions v WHERE v.report_id=s.report_id AND v.version=s.report_version;
 SELECT p INTO plan FROM jsonb_array_elements(coalesce(output#>'{evidence,plans}','[]')) p WHERE p->>'id'=request.item_key;
 -- An absent optional rear axle is different from a selected axle whose current source facts cannot resolve.
 SELECT CASE WHEN jsonb_typeof(plan->'front')='object' AND bool_and(p IS NOT NULL) THEN coalesce(jsonb_agg(p),'[]') ELSE '[]'::jsonb END INTO products
 FROM (SELECT DISTINCT partners.pilot_product((x->>'id')::uuid,(SELECT bundle_id FROM app.report_versions WHERE report_id=s.report_id AND version=s.report_version),r.market) p
 FROM (VALUES(plan->'front'),(plan->'rear')) v(x) WHERE x IS NOT NULL AND x<>'null'::jsonb) candidates;
 SELECT d.document INTO doc FROM email.delivery_snapshots d WHERE d.send_id=message;
 live:=s.anonymized_at IS NULL AND person.status='active' AND (person.expires_at IS NULL OR person.expires_at>clock_timestamp()) AND c.status='active'
 AND r.status='active' AND r.expires_at>clock_timestamp() AND request.expires_at>clock_timestamp()
 AND EXISTS(SELECT 1 FROM app.subjects o WHERE o.id=s.owner_subject_id AND o.status='active' AND (o.expires_at IS NULL OR o.expires_at>clock_timestamp()))
 AND NOT partners.pilot_blocked(c.subject_id,ARRAY['all-email']);
 offers:=live AND request.adult AND c.verified_at IS NOT NULL AND s.requested_purposes ? 'offers' AND NOT partners.pilot_blocked(c.subject_id,ARRAY['all-marketing','offers'])
 AND EXISTS(SELECT 1 FROM privacy.consent_state p JOIN privacy.consent_events e ON e.id=p.source_event_id JOIN privacy.notices n ON n.id=e.notice_id
 WHERE p.subject_id=c.subject_id AND p.purpose='offers' AND p.scope_key='offers' AND p.status='confirmed' AND p.effective_at<=clock_timestamp() AND (p.expires_at IS NULL OR p.expires_at>clock_timestamp())
 AND p.policy_version=policy AND e.notice_id=notice AND n.purpose='offers' AND n.published_at<=clock_timestamp());
 offers:=offers AND NOT EXISTS(SELECT 1 FROM partners.pilot_usage u WHERE u.send_id=message AND u.state<>'released' AND NOT(u.reserved_at>=date_trunc('month',clock_timestamp() AT TIME ZONE u.time_zone) AT TIME ZONE u.time_zone
 AND u.reserved_at<(date_trunc('month',clock_timestamp() AT TIME ZONE u.time_zone)+interval '1 month') AT TIME ZONE u.time_zone));
 report_scope:='report:'||s.report_id||':'||s.report_version;
 report:=live AND s.kind='report' AND s.requested_purposes ? 'report' AND NOT partners.pilot_blocked(c.subject_id,ARRAY['report',report_scope])
 AND EXISTS(SELECT 1 FROM privacy.consent_state p JOIN privacy.consent_events e ON e.id=p.source_event_id JOIN privacy.notices n ON n.id=e.notice_id
 WHERE p.subject_id=c.subject_id AND p.purpose='report' AND p.scope_key=report_scope AND p.effective_at<=clock_timestamp() AND p.policy_version=policy AND e.notice_id=report_notice AND n.purpose='report' AND n.published_at<=clock_timestamp() AND (p.expires_at IS NULL OR p.expires_at>clock_timestamp()) AND
 ((p.status='confirmed' AND c.verified_at IS NOT NULL) OR
 (p.status='pending' AND EXISTS(SELECT 1 FROM email.delivery_snapshots snap JOIN privacy.contact_intents i ON i.challenge_id=snap.verification_id JOIN privacy.verification_challenges v ON v.id=i.challenge_id
 WHERE snap.send_id=message AND snap.permission_event_id=p.source_event_id AND i.contact_id=c.id AND i.owner_subject_id=s.owner_subject_id AND i.scope_key=report_scope AND i.policy_version=policy AND v.notice_id=report_notice AND v.purpose='report' AND v.invalidated_at IS NULL AND v.expires_at>clock_timestamp()))));
 -- Only an immutable source price explicitly associated with this selected plan supplies minimum-spend/savings math.
 SELECT (p->>'quantity')::integer INTO source_quantity FROM jsonb_array_elements(coalesce(output->'prices','[]')) p WHERE p->>'planId'=request.item_key AND p->>'quantity' ~ '^[1-4]$' LIMIT 1;
 SELECT p->>'totalMinor' INTO sub_total FROM jsonb_array_elements(coalesce(output->'prices','[]')) p WHERE p->>'planId'=request.item_key AND p->>'currency'='USD' AND p->>'totalMinor' ~ '^[0-9]{1,19}$' LIMIT 1;
 RETURN jsonb_build_object('sendId',s.id,'ownerId',s.owner_subject_id,'recipientId',c.subject_id,'contactId',c.id,'provider',s.provider,'providerKey',s.provider_key,'permissionRevision',person.permission_revision::text,
 'policyVersion',request.policy_version,'reportAllowed',coalesce(report,false),'offersAllowed',coalesce(offers,false),'contact',jsonb_build_object('keyVersion',c.key_version,'hex',encode(c.encrypted_email,'hex')),
 'geo',request.geo,'audience',jsonb_build_object('market',r.market,'products',products,'quantity',CASE WHEN source_quantity=request.quantity THEN source_quantity ELSE 0 END,'subtotalMinor',sub_total,'currency','USD','region',NULL,'postal',NULL,'latitude',NULL,'longitude',NULL),
 'document',CASE WHEN report THEN doc ELSE NULL END);
END $$;
CREATE FUNCTION partners.pilot_evidence(message uuid,token uuid,generation bigint,reason text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE evidence uuid:=gen_random_uuid();BEGIN
 PERFORM partners.pilot_root(message);
 IF NOT EXISTS(SELECT 1 FROM partners.pilot_work w WHERE w.send_id=message AND w.lease_token=token AND w.lease_generation=generation AND w.lease_until>clock_timestamp()
 AND (w.provider_started_at IS NULL OR reason='definitively_not_sent' AND w.state='dispatching')) THEN RAISE EXCEPTION 'Pilot non-use evidence unavailable' USING ERRCODE='23514';END IF;
 IF reason NOT IN('cancelled_before_dispatch','definitively_not_sent','expired_unstarted') THEN RAISE EXCEPTION 'Invalid pilot reason' USING ERRCODE='23514';END IF;
 INSERT INTO admin.audit_events(id,action,resource_kind,result,change_digest,field_names,occurred_at) VALUES(evidence,'pilot.'||reason,'coupon_assignment','approved',encode(sha256(convert_to(message::text||token::text||reason,'UTF8')),'hex'),'[]',clock_timestamp());
 RETURN evidence;
END $$;
CREATE FUNCTION partners.pilot_send_state(message uuid,token uuid,generation bigint,state text,message_id text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE attempt uuid;work partners.pilot_work%ROWTYPE;handoff_at timestamptz;BEGIN
 PERFORM partners.pilot_root(message);
 IF NOT EXISTS(SELECT 1 FROM partners.pilot_work w WHERE w.send_id=message AND w.lease_token=token AND w.lease_generation=generation AND w.lease_until>clock_timestamp()) THEN RAISE EXCEPTION 'Pilot lease unavailable' USING ERRCODE='23514';END IF;
 IF state NOT IN('dispatching','accepted','uncertain','failed','cancelled','suppressed') THEN RAISE EXCEPTION 'Invalid pilot send state' USING ERRCODE='23514';END IF;
 IF state='dispatching' THEN
  IF NOT EXISTS(SELECT 1 FROM email.email_sends WHERE id=message AND dispatch_state='scheduled' AND send_after<=clock_timestamp()) THEN RAISE EXCEPTION 'Pilot send not due' USING ERRCODE='23514';END IF;
  SELECT * INTO work FROM partners.pilot_work WHERE send_id=message;
  IF NOT EXISTS(SELECT 1 FROM app.object_assets a JOIN partners.pilot_payload_refs ref ON ref.asset_id=a.id AND ref.send_id=message AND ref.generation=$3
  WHERE a.id=work.payload_asset_id AND a.purpose='email_payload' AND a.state='ready' AND a.sha256=work.payload_object_hash AND a.object_version IS NOT NULL AND a.expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'Ready pilot payload required' USING ERRCODE='23514';END IF;
  handoff_at:=clock_timestamp();
  -- A held code cannot borrow a replacement cap window's unused capacity.
  IF EXISTS(SELECT 1 FROM partners.coupon_reservations a WHERE a.send_id=message AND a.state<>'released' AND
   (a.state<>'reserved' OR (SELECT count(*) FROM partners.cap_reservations cr JOIN partners.offer_cap_windows cw ON cw.org_id=cr.org_id AND cw.id=cr.cap_id
    WHERE cr.org_id=a.org_id AND cr.reservation_id=a.id AND cr.state='reserved' AND cw.consumed_units>=cr.units
    AND cw.policy_version=(SELECT policy_version FROM partners.pilot_requests WHERE send_id=message)
    AND cw.window_start<=handoff_at AND cw.window_end>handoff_at)<>3)) THEN RETURN NULL;END IF;
  INSERT INTO email.send_attempts(send_id,attempt_no,started_at,outcome) VALUES(message,1,handoff_at,'in_progress') RETURNING id INTO attempt;
  UPDATE email.email_sends SET claimed_at=handoff_at,payload_asset_id=work.payload_asset_id,payload_hash=work.payload_object_hash WHERE id=message;
 ELSE
  SELECT attempt_id INTO attempt FROM partners.pilot_work WHERE send_id=message;
  IF attempt IS NOT NULL THEN UPDATE email.send_attempts SET outcome=CASE state WHEN 'accepted' THEN 'accepted' WHEN 'failed' THEN 'definitive_rejection' ELSE 'uncertain' END,finished_at=clock_timestamp() WHERE id=attempt;END IF;
 END IF;
 UPDATE email.email_sends SET dispatch_state=state,provider_message_id=message_id,accepted_at=CASE WHEN state='accepted' THEN clock_timestamp() ELSE NULL END,revision=revision+1,updated_at=clock_timestamp() WHERE id=message;
 IF state<>'dispatching' THEN
 INSERT INTO email.send_receipts(send_id,provider,provider_key_digest,payload_digest,outcome,last_reconciled_at)
 SELECT id,provider,sha256(convert_to(provider_key,'UTF8')),CASE WHEN payload_hash IS NULL THEN NULL ELSE decode(payload_hash,'hex') END,CASE WHEN state='failed' THEN 'definitive_rejection' ELSE state END,clock_timestamp() FROM email.email_sends WHERE id=message
 ON CONFLICT(send_id) DO UPDATE SET outcome=excluded.outcome,last_reconciled_at=excluded.last_reconciled_at,updated_at=clock_timestamp(),revision=email.send_receipts.revision+1;
 END IF;
 RETURN attempt;
END $$;
REVOKE ALL ON FUNCTION partners.guard_pilot_work(),partners.pilot_root(uuid),partners.pilot_blocked(uuid,text[]),partners.pilot_capture(uuid,jsonb,text,boolean,integer,jsonb,text,text),partners.pilot_product(uuid,uuid,text),partners.pilot_context(uuid,uuid,bigint,uuid,uuid,text),partners.pilot_evidence(uuid,uuid,bigint,text),partners.pilot_send_state(uuid,uuid,bigint,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION partners.pilot_dataset_live(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION partners.pilot_root(uuid),partners.pilot_blocked(uuid,text[]),partners.pilot_capture(uuid,jsonb,text,boolean,integer,jsonb,text,text),partners.pilot_context(uuid,uuid,bigint,uuid,uuid,text),partners.pilot_evidence(uuid,uuid,bigint,text),partners.pilot_send_state(uuid,uuid,bigint,text,text) TO tt_p2_pilot_service;
GRANT SELECT ON partners.organizations,partners.offer_versions,partners.offer_targets,partners.locations,partners.coupon_pools,partners.coupon_codes,partners.eligible_offer_versions TO tt_p2_pilot_service;
GRANT SELECT ON partners.offers TO tt_p2_pilot_service;
GRANT INSERT ON partners.coupon_codes TO tt_p2_pilot_service;
CREATE POLICY pilot_org ON partners.organizations TO tt_p2_pilot_service USING(true);
CREATE POLICY pilot_offers ON partners.offers TO tt_p2_pilot_service USING(true);
CREATE POLICY pilot_versions ON partners.offer_versions TO tt_p2_pilot_service USING(true);
CREATE POLICY pilot_targets ON partners.offer_targets TO tt_p2_pilot_service USING(true);
CREATE POLICY pilot_locations ON partners.locations TO tt_p2_pilot_service USING(true);
CREATE FUNCTION partners.pilot_due(message uuid) RETURNS TABLE(id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT id FROM email.email_sends WHERE id=message AND send_after<=statement_timestamp() AND dispatch_state IN('scheduled','dispatching') AND anonymized_at IS NULL;
$$;
CREATE FUNCTION partners.pilot_admit_recipient(message uuid,person uuid,zone text,offers uuid[]) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE start_at timestamptz;end_at timestamptz;BEGIN
 PERFORM partners.pilot_root(message);
 IF NOT EXISTS(SELECT 1 FROM email.email_sends s JOIN privacy.contacts c ON c.id=s.recipient_contact_id WHERE s.id=message AND c.subject_id=person) OR cardinality(offers)>3 OR cardinality(offers)<1 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=zone) THEN RAISE EXCEPTION 'Pilot recipient mismatch' USING ERRCODE='23514';END IF;
 start_at:=date_trunc('month',clock_timestamp() AT TIME ZONE zone) AT TIME ZONE zone;end_at:=(date_trunc('month',clock_timestamp() AT TIME ZONE zone)+interval '1 month') AT TIME ZONE zone;
 IF EXISTS(SELECT 1 FROM partners.pilot_usage WHERE recipient_subject_id=person AND time_zone<>zone AND state<>'released') THEN RAISE EXCEPTION 'Pilot frequency policy changed' USING ERRCODE='23505';END IF;
 IF (SELECT count(*) FROM partners.pilot_usage WHERE recipient_subject_id=person AND send_id<>message AND state<>'released' AND reserved_at>=start_at AND reserved_at<end_at)>=4
 OR EXISTS(SELECT 1 FROM partners.pilot_usage u JOIN partners.coupon_reservations a ON a.send_id=u.send_id WHERE u.recipient_subject_id=person AND u.send_id<>message AND u.state<>'released' AND a.state<>'released' AND a.offer_id=ANY(offers) AND a.reserved_at>clock_timestamp()-interval '30 days') THEN RAISE EXCEPTION 'Pilot recipient frequency exhausted' USING ERRCODE='23505';END IF;
 INSERT INTO partners.pilot_usage(send_id,recipient_subject_id,time_zone) VALUES(message,person,zone) ON CONFLICT(send_id) DO UPDATE SET state='reserved' WHERE pilot_usage.state='released';
END $$;
CREATE FUNCTION partners.pilot_cancel_authorize(message uuid,keys jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM partners.pilot_root(message);
 IF NOT EXISTS(SELECT 1 FROM email.email_sends s JOIN app.owner_sessions o ON o.subject_id=s.owner_subject_id JOIN app.subjects person ON person.id=o.subject_id
 JOIN jsonb_to_recordset(keys) k(key_version text,digest text) ON o.key_version=k.key_version AND o.token_hash=decode(k.digest,'hex')
 WHERE s.id=message AND s.dispatch_state='scheduled' AND s.cancel_deadline>clock_timestamp() AND person.status='active' AND o.revoked_at IS NULL AND o.expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'Pilot cancellation unavailable' USING ERRCODE='23514';END IF;
END $$;
REVOKE ALL ON FUNCTION partners.pilot_due(uuid),partners.pilot_admit_recipient(uuid,uuid,text,uuid[]),partners.pilot_cancel_authorize(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION partners.pilot_due(uuid),partners.pilot_admit_recipient(uuid,uuid,text,uuid[]),partners.pilot_cancel_authorize(uuid,jsonb) TO tt_p2_pilot_service;
