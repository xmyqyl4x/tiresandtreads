-- Opt-in local services only. A dedicated server capability, never a portal login.
CREATE TABLE partners.operations_receipts (
 scope text NOT NULL CHECK(scope='staff' OR scope ~ '^[a-f0-9-]{36}$'),
 command_id uuid NOT NULL, action text NOT NULL CHECK(action IN('redemption','dispute','domain','click')),
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object' AND octet_length(result::text)<=2048),
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(), PRIMARY KEY(scope,command_id)
);
CREATE TRIGGER operations_receipts_immutable BEFORE UPDATE ON partners.operations_receipts FOR EACH ROW EXECUTE FUNCTION partners.reject_update();
CREATE TABLE partners.operations_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_hash text NOT NULL CHECK(actor_hash ~ '^[a-f0-9]{64}$'),
 action text NOT NULL CHECK(length(action) BETWEEN 1 AND 80), resource_hash text NOT NULL CHECK(resource_hash ~ '^[a-f0-9]{64}$'),
 change_hash text NOT NULL CHECK(change_hash ~ '^[a-f0-9]{64}$'), created_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
CREATE TRIGGER operations_audit_immutable BEFORE UPDATE ON partners.operations_audit FOR EACH ROW EXECUTE FUNCTION partners.reject_update();
CREATE TABLE partners.operations_clicks (
 id uuid PRIMARY KEY, org_id uuid NOT NULL, reservation_id uuid NOT NULL,
 method text NOT NULL CHECK(method IN('GET','HEAD')), classification text NOT NULL CHECK(classification IN('machine','unknown','suspected_human')),
 occurred_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT statement_timestamp(), expires_at timestamptz NOT NULL DEFAULT statement_timestamp()+interval '13 months',
 FOREIGN KEY(org_id,reservation_id) REFERENCES partners.coupon_reservations(org_id,id) ON DELETE RESTRICT,
 CHECK(occurred_at BETWEEN created_at-interval '30 days' AND created_at+interval '5 minutes'),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '13 months')
);
CREATE INDEX operations_clicks_assignment_idx ON partners.operations_clicks(org_id,reservation_id,occurred_at);
CREATE INDEX operations_clicks_expiry_idx ON partners.operations_clicks(expires_at,id);
CREATE TRIGGER operations_clicks_immutable BEFORE UPDATE ON partners.operations_clicks FOR EACH ROW EXECUTE FUNCTION partners.reject_update();
CREATE TABLE partners.operations_releases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), audience text NOT NULL CHECK(audience='internal' OR audience ~ '^[a-f0-9-]{36}$'),
 week date NOT NULL CHECK(extract(isodow FROM week)=1), policy text NOT NULL DEFAULT 'fixed-week-50-v1' CHECK(policy='fixed-week-50-v1'),
 state text NOT NULL CHECK(state IN('available','suppressed','blocked')), cells jsonb,
 computed_at timestamptz NOT NULL DEFAULT statement_timestamp(), expires_at timestamptz NOT NULL,
 UNIQUE(audience,week), CHECK((state='available' AND jsonb_typeof(cells)='object' AND octet_length(cells::text)<=2048) OR (state<>'available' AND cells IS NULL)),
 CHECK(expires_at>computed_at AND expires_at<=computed_at+interval '13 months')
);
CREATE TABLE partners.operations_release_subjects (
 release_id uuid NOT NULL REFERENCES partners.operations_releases(id) ON DELETE RESTRICT,
 subject_id uuid NOT NULL REFERENCES app.subjects(id) ON DELETE RESTRICT,
 permission_revision bigint NOT NULL CHECK(permission_revision>0), scope text NOT NULL CHECK(scope IN('site','email')),
 collected_at timestamptz NOT NULL, valid_until timestamptz NOT NULL, PRIMARY KEY(release_id,subject_id)
);
CREATE INDEX operations_release_subjects_person_idx ON partners.operations_release_subjects(subject_id,release_id);
CREATE TRIGGER operations_release_subjects_immutable BEFORE UPDATE ON partners.operations_release_subjects FOR EACH ROW EXECUTE FUNCTION partners.reject_update();
CREATE FUNCTION partners.guard_operations_release() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.id<>OLD.id OR NEW.audience<>OLD.audience OR NEW.week<>OLD.week OR NEW.policy<>OLD.policy OR NEW.computed_at<>OLD.computed_at OR NEW.expires_at<>OLD.expires_at
 OR NEW.state<>'blocked' OR NEW.cells IS NOT NULL THEN RAISE EXCEPTION 'A released cohort cannot be refreshed' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER operations_release_immutable BEFORE UPDATE ON partners.operations_releases FOR EACH ROW EXECUTE FUNCTION partners.guard_operations_release();
CREATE TABLE partners.operations_domain_samples (
 id uuid PRIMARY KEY, domain text NOT NULL CHECK(domain ~ '^[a-z0-9.-]{3,253}$'),
 source text NOT NULL CHECK(source IN('google_postmaster','microsoft_snds')), day date NOT NULL,
 status text NOT NULL CHECK(status IN('available','unavailable')), reputation text CHECK(reputation IN('high','medium','low','bad')),
 spam_basis_points integer CHECK(spam_basis_points BETWEEN 0 AND 10000), sample_size bigint CHECK(sample_size BETWEEN 1 AND 1000000000),
 imported_at timestamptz NOT NULL DEFAULT statement_timestamp(), expires_at timestamptz NOT NULL DEFAULT statement_timestamp()+interval '30 days',
 CHECK((status='unavailable' AND reputation IS NULL AND spam_basis_points IS NULL AND sample_size IS NULL) OR (status='available' AND sample_size IS NOT NULL)),
 CHECK(expires_at>imported_at AND expires_at<=imported_at+interval '30 days')
);
CREATE INDEX operations_domain_samples_latest_idx ON partners.operations_domain_samples(domain,source,day DESC,imported_at DESC,id);
CREATE TRIGGER operations_domain_samples_immutable BEFORE UPDATE ON partners.operations_domain_samples FOR EACH ROW EXECUTE FUNCTION partners.reject_update();

CREATE FUNCTION partners.ops_staff(actor uuid,subject text,permission text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF permission NOT IN('partner.disputes','operations.email','operations.visitors','operations.insights','operations.reveal','operations.events','operations.privacy') THEN RETURN false;END IF;
 PERFORM 1 FROM admin.staff_identities s WHERE s.id=actor AND s.provider_subject=subject AND s.status='active' FOR SHARE;
 IF NOT FOUND THEN RETURN false;END IF;
 PERFORM 1 FROM admin.staff_role_assignments a JOIN admin.roles r ON r.id=a.role_id WHERE a.staff_id=actor AND a.revoked_at IS NULL AND r.permissions ? permission
 AND (permission NOT IN('operations.reveal','operations.privacy') OR r.code IN('owner','privacy_officer')) FOR SHARE OF a,r;
 RETURN FOUND;
END $$;
CREATE FUNCTION partners.ops_member(organization uuid,subject text,writing boolean) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM 1 FROM partners.organizations o WHERE o.id=organization AND o.status<>'closed' AND (NOT writing OR (o.status='active' AND o.verification_status='verified')) FOR SHARE;
 IF NOT FOUND THEN RETURN false;END IF;
 PERFORM 1 FROM partners.memberships m WHERE m.org_id=organization AND m.provider_subject=subject AND m.status='active' AND (NOT writing OR m.role IN('owner','manager')) FOR SHARE;
 RETURN FOUND;
END $$;
-- Conflicts of interest persist when portal access ends; organization state is irrelevant.
CREATE FUNCTION partners.ops_affiliated(organization uuid,subject text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM 1 FROM partners.memberships m WHERE m.org_id=organization AND m.provider_subject=subject AND m.status='active' FOR SHARE;
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION partners.ops_affiliated(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION partners.ops_affiliated(uuid,text) TO tt_p2_insights_service;
CREATE FUNCTION partners.ops_permitted(person uuid,scope text,collected timestamptz,revision bigint DEFAULT NULL) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.subjects s JOIN privacy.consent_state p ON p.subject_id=s.id
 JOIN privacy.consent_events e ON e.id=p.source_event_id JOIN privacy.notices n ON n.id=e.notice_id
 WHERE s.id=$1 AND s.status='active' AND (s.expires_at IS NULL OR s.expires_at>statement_timestamp())
 AND ($4 IS NULL OR s.permission_revision=$4) AND p.purpose='analytics' AND p.scope_key=$2 AND p.status='confirmed'
 AND p.effective_at<=$3 AND (p.expires_at IS NULL OR p.expires_at>statement_timestamp())
 AND n.purpose='analytics' AND n.market_policy=p.policy_version AND n.published_at<=$3
 AND NOT EXISTS(SELECT 1 FROM analytics.processing_restrictions z WHERE z.subject_id=$1 AND z.scope_key=$2)
 AND NOT EXISTS(SELECT 1 FROM privacy.suppressions z WHERE z.subject_id=$1 AND z.scope_key IN('all-analytics','analytics',$2) AND z.lifted_at IS NULL AND z.effective_at<=statement_timestamp() AND (z.expires_at IS NULL OR z.expires_at>statement_timestamp())));
$$;
CREATE FUNCTION partners.ops_lock_subjects(people uuid[]) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF cardinality(people)>10000 THEN RAISE EXCEPTION 'Operations source bound exceeded' USING ERRCODE='54000';END IF;
 PERFORM id FROM app.subjects WHERE id=ANY(people) ORDER BY id FOR SHARE;
END $$;
CREATE FUNCTION partners.ops_partner_facts(organization uuid,start_day date) RETURNS TABLE(person uuid,collected timestamptz,revision bigint,valid_until timestamptz,included boolean,codes_issued boolean,clicks boolean,reported_redemptions boolean,complaints boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF extract(isodow FROM start_day)<>1 OR start_day+7>(statement_timestamp() AT TIME ZONE 'UTC')::date OR start_day<(statement_timestamp()-interval '395 days')::date THEN RAISE EXCEPTION 'Fixed completed week required' USING ERRCODE='23514';END IF;
 IF (SELECT count(*) FROM (SELECT a.id FROM partners.coupon_reservations a JOIN email.email_sends s ON s.id=a.send_id WHERE a.org_id=organization AND s.accepted_at>=start_day::timestamp AT TIME ZONE 'UTC' AND s.accepted_at<(start_day+7)::timestamp AT TIME ZONE 'UTC' LIMIT 10001) b)>10000 THEN RAISE EXCEPTION 'Operations source bound exceeded' USING ERRCODE='54000';END IF;
 RETURN QUERY SELECT c.subject_id,min(s.created_at),p.permission_revision,least(coalesce(min(s.expires_at),'infinity'::timestamptz),min(s.created_at)+interval '13 months'),
 bool_or(true),bool_or(a.state IN('issued','redeemed')),
 bool_or(EXISTS(SELECT 1 FROM partners.operations_clicks e WHERE e.reservation_id=a.id AND e.org_id=a.org_id AND e.method='GET' AND e.classification='suspected_human' AND e.expires_at>statement_timestamp() AND e.occurred_at>=s.accepted_at)),
 bool_or((SELECT coalesce(sum(e.quantity_delta),0)>0 FROM partners.redemption_events e WHERE e.org_id=a.org_id AND e.reservation_id=a.id)),
 bool_or(EXISTS(SELECT 1 FROM email.email_events e WHERE e.send_id=s.id AND e.type='complained'))
 FROM partners.coupon_reservations a JOIN email.email_sends s ON s.id=a.send_id JOIN privacy.contacts c ON c.id=s.recipient_contact_id JOIN app.subjects p ON p.id=c.subject_id
 WHERE a.org_id=organization AND a.state IN('issued','redeemed') AND s.dispatch_state='accepted' AND s.anonymized_at IS NULL
 AND (s.expires_at IS NULL OR s.expires_at>statement_timestamp()) AND c.status='active' AND c.verified_at IS NOT NULL
 AND s.accepted_at>=start_day::timestamp AT TIME ZONE 'UTC' AND s.accepted_at<(start_day+7)::timestamp AT TIME ZONE 'UTC'
 AND partners.ops_permitted(c.subject_id,'email',s.created_at) GROUP BY c.subject_id,p.permission_revision;
END $$;
CREATE FUNCTION partners.ops_visitor_facts(start_day date) RETURNS TABLE(person uuid,collected timestamptz,revision bigint,valid_until timestamptz,last_seen timestamptz,sessions bigint,events bigint,routes text[],channels text[],first_channel text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF extract(isodow FROM start_day)<>1 OR start_day+7>(statement_timestamp() AT TIME ZONE 'UTC')::date OR start_day<(statement_timestamp()-interval '395 days')::date THEN RAISE EXCEPTION 'Fixed completed week required' USING ERRCODE='23514';END IF;
 IF (SELECT count(*) FROM (SELECT id FROM analytics.events WHERE event_day>=start_day AND event_day<start_day+7 LIMIT 10001) b)>10000 THEN RAISE EXCEPTION 'Operations source bound exceeded' USING ERRCODE='54000';END IF;
 RETURN QUERY SELECT e.subject_id,min(e.occurred_at),s.permission_revision,min(e.expires_at),max(e.occurred_at),count(DISTINCT e.session_ref),count(*),array_agg(DISTINCT e.route_template ORDER BY e.route_template),array_agg(DISTINCT e.channel ORDER BY e.channel),
 (array_agg(e.channel ORDER BY e.occurred_at,e.id))[1]
 FROM analytics.events e JOIN app.subjects s ON s.id=e.subject_id WHERE e.event_day>=start_day AND e.event_day<start_day+7
 AND e.channel IN('web','app') AND e.market='US' AND e.collection_scope='site' AND e.bot_classification='not_flagged' AND e.expires_at>statement_timestamp()
 AND partners.ops_permitted(e.subject_id,'site',e.occurred_at,e.permission_revision) GROUP BY e.subject_id,s.permission_revision;
END $$;
CREATE FUNCTION partners.ops_assignment(organization uuid,assignment uuid,unique_required boolean DEFAULT true) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a partners.coupon_reservations%ROWTYPE; person uuid;
BEGIN
 SELECT c.subject_id INTO person FROM partners.coupon_reservations r JOIN email.email_sends s ON s.id=r.send_id JOIN privacy.contacts c ON c.id=s.recipient_contact_id WHERE r.org_id=organization AND r.id=assignment;
 IF person IS NULL THEN RETURN NULL;END IF;
 PERFORM id FROM app.subjects WHERE id=person AND status='active' FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO a FROM partners.coupon_reservations WHERE org_id=organization AND id=assignment FOR UPDATE;
 IF NOT FOUND OR a.state NOT IN('issued','redeemed') OR (unique_required AND a.pool_mode='shared') THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('offer',a.offer_id,'version',a.offer_version,'mode',a.pool_mode);
END $$;
CREATE FUNCTION partners.ops_invalidate(person uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM id FROM app.subjects WHERE id=person FOR UPDATE;
 UPDATE partners.operations_releases r SET state='blocked',cells=NULL WHERE state<>'blocked' AND EXISTS(SELECT 1 FROM partners.operations_release_subjects s WHERE s.release_id=r.id AND s.subject_id=person);
END $$;
CREATE FUNCTION partners.ops_privacy_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE person uuid;
BEGIN
 IF TG_TABLE_SCHEMA='app' THEN person:=coalesce(NEW.id,OLD.id);ELSE person:=coalesce(NEW.subject_id,OLD.subject_id);END IF;
 PERFORM partners.ops_invalidate(person);RETURN coalesce(NEW,OLD);
END $$;
CREATE TRIGGER operations_subject_privacy AFTER UPDATE OF status,permission_revision,expires_at ON app.subjects FOR EACH ROW EXECUTE FUNCTION partners.ops_privacy_change();
CREATE TRIGGER operations_consent_privacy AFTER INSERT OR UPDATE OR DELETE ON privacy.consent_state FOR EACH ROW EXECUTE FUNCTION partners.ops_privacy_change();
CREATE TRIGGER operations_suppression_privacy AFTER INSERT OR UPDATE OR DELETE ON privacy.suppressions FOR EACH ROW EXECUTE FUNCTION partners.ops_privacy_change();
CREATE TRIGGER operations_restriction_privacy AFTER INSERT OR DELETE ON analytics.processing_restrictions FOR EACH ROW EXECUTE FUNCTION partners.ops_privacy_change();
CREATE TRIGGER operations_event_erasure AFTER DELETE ON analytics.events FOR EACH ROW EXECUTE FUNCTION partners.ops_privacy_change();
CREATE TRIGGER operations_contact_privacy AFTER UPDATE OF status,verified_at ON privacy.contacts FOR EACH ROW EXECUTE FUNCTION partners.ops_privacy_change();
CREATE FUNCTION partners.ops_source_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE person uuid; assignment uuid;
BEGIN
 assignment:=coalesce(NEW.reservation_id,OLD.reservation_id);
 SELECT c.subject_id INTO person FROM partners.coupon_reservations a JOIN email.email_sends s ON s.id=a.send_id JOIN privacy.contacts c ON c.id=s.recipient_contact_id WHERE a.id=assignment;
 IF person IS NOT NULL THEN PERFORM partners.ops_invalidate(person);END IF;
 RETURN coalesce(NEW,OLD);
END $$;
CREATE TRIGGER operations_redemption_correction AFTER INSERT OR DELETE ON partners.redemption_events FOR EACH ROW EXECUTE FUNCTION partners.ops_source_change();
CREATE FUNCTION partners.ops_subject_held(person uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM privacy.legal_holds h WHERE h.released_at IS NULL AND (h.subject_id=$1 OR h.resource_id IN(
 SELECT $1 UNION SELECT c.id FROM privacy.contacts c WHERE c.subject_id=$1
 UNION SELECT s.id FROM email.email_sends s JOIN privacy.contacts c ON c.id=s.recipient_contact_id WHERE c.subject_id=$1
 UNION SELECT s.report_id FROM email.email_sends s JOIN privacy.contacts c ON c.id=s.recipient_contact_id WHERE c.subject_id=$1 AND s.report_id IS NOT NULL
 UNION SELECT a.id FROM partners.coupon_reservations a JOIN email.email_sends s ON s.id=a.send_id JOIN privacy.contacts c ON c.id=s.recipient_contact_id WHERE c.subject_id=$1
 UNION SELECT e.id FROM partners.operations_clicks e JOIN partners.coupon_reservations a ON a.id=e.reservation_id JOIN email.email_sends s ON s.id=a.send_id JOIN privacy.contacts c ON c.id=s.recipient_contact_id WHERE c.subject_id=$1
 UNION SELECT release_id FROM partners.operations_release_subjects WHERE subject_id=$1)));
$$;
CREATE FUNCTION partners.ops_observation_held(observation uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM partners.operations_clicks e JOIN partners.coupon_reservations a ON a.id=e.reservation_id JOIN email.email_sends s ON s.id=a.send_id JOIN privacy.contacts c ON c.id=s.recipient_contact_id WHERE e.id=$1 AND partners.ops_subject_held(c.subject_id));
$$;
REVOKE ALL ON FUNCTION partners.ops_subject_held(uuid),partners.ops_observation_held(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION partners.ops_observation_held(uuid),partners.ops_subject_held(uuid) TO tt_p2_insights_service;
CREATE FUNCTION partners.ops_purge(person uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM id FROM app.subjects WHERE id=person FOR UPDATE;
 IF partners.ops_subject_held(person) THEN RAISE EXCEPTION 'Operations erasure held' USING ERRCODE='23514';END IF;
 PERFORM partners.ops_invalidate(person);
 DELETE FROM partners.operations_release_subjects WHERE subject_id=person;
 DELETE FROM partners.operations_clicks e USING partners.coupon_reservations a,email.email_sends s,privacy.contacts c
 WHERE e.reservation_id=a.id AND a.send_id=s.id AND s.recipient_contact_id=c.id AND c.subject_id=person;
END $$;
CREATE FUNCTION partners.ops_before_subject_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN PERFORM partners.ops_purge(OLD.id);RETURN OLD;END $$;
CREATE TRIGGER operations_subject_erasure BEFORE DELETE ON app.subjects FOR EACH ROW EXECUTE FUNCTION partners.ops_before_subject_delete();
CREATE FUNCTION partners.ops_reveal(actor uuid,actor_subject text,person uuid,start_day date,reason text,case_id uuid) RETURNS TABLE(id uuid,revision bigint,key_version text,hex text) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT partners.ops_staff(actor,actor_subject,'operations.reveal') THEN RAISE EXCEPTION 'Contact reveal forbidden' USING ERRCODE='42501';END IF;
 PERFORM p.id FROM app.subjects p WHERE p.id=person FOR SHARE;
 IF NOT EXISTS(SELECT 1 FROM partners.ops_visitor_facts(start_day) f WHERE f.person=ops_reveal.person) THEN RETURN;END IF;
 IF (SELECT count(*) FROM privacy.contacts c WHERE c.subject_id=person AND c.status='active' AND c.verified_at IS NOT NULL)<>1 THEN RETURN;END IF;
 PERFORM partners.ops_reveal_audit(actor,person,reason,case_id);
 RETURN QUERY SELECT c.id,c.revision,c.key_version,encode(c.encrypted_email,'hex') FROM privacy.contacts c WHERE c.subject_id=person AND c.status='active' AND c.verified_at IS NOT NULL FOR SHARE;
END $$;
CREATE FUNCTION partners.ops_reveal_audit(actor uuid,person uuid,reason text,case_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt uuid;
BEGIN
 IF reason NOT IN('support_request','privacy_request') THEN RAISE EXCEPTION 'Reveal reason required' USING ERRCODE='23514';END IF;
 INSERT INTO admin.audit_events(action,resource_kind,result,occurred_at,change_digest,field_names)
 VALUES('operations.contact_reveal','consented_visitor','succeeded',clock_timestamp(),encode(sha256(convert_to(reason||':'||case_id::text,'UTF8')),'hex'),'["contact_email"]') RETURNING id INTO receipt;
 INSERT INTO admin.audit_identity_links(event_id,actor_staff_id,subject_id) VALUES(receipt,actor,person);
END $$;
CREATE FUNCTION partners.ops_health(start_day date) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 WITH cohort AS(
 SELECT s.id,c.subject_id,(c.status='active' AND c.verified_at IS NOT NULL) AS contact_ready FROM email.email_sends s LEFT JOIN privacy.contacts c ON c.id=s.recipient_contact_id
 WHERE s.accepted_at>=start_day::timestamp AT TIME ZONE 'UTC' AND s.accepted_at<(start_day+7)::timestamp AT TIME ZONE 'UTC' AND s.anonymized_at IS NULL AND s.dispatch_state='accepted'),
 permitted_events AS MATERIALIZED(
 SELECT c.id,e.type,e.classification,CASE WHEN e.type IN('opened','clicked') THEN c.contact_ready AND partners.ops_permitted(c.subject_id,'email',e.occurred_at) ELSE true END AS permitted
 FROM cohort c LEFT JOIN email.email_events e ON e.send_id=c.id),
 facts AS(SELECT id,bool_or(type='delivered') delivered,bool_or(type='bounced') bounced,bool_or(type='complained') complained,
 bool_or(type='opened' AND classification='suspected_human' AND permitted) human_opens,bool_or(type='opened' AND classification='machine' AND permitted) machine_opens,bool_or(type='opened' AND coalesce(classification,'unknown')='unknown' AND permitted) unknown_opens,
 bool_or(type='clicked' AND classification='suspected_human' AND permitted) human_clicks,bool_or(type='clicked' AND classification='machine' AND permitted) machine_clicks,bool_or(type='clicked' AND coalesce(classification,'unknown')='unknown' AND permitted) unknown_clicks
 FROM permitted_events GROUP BY id)
 SELECT jsonb_build_object('accepted',count(*)::text,'uncertain',(SELECT count(*)::text FROM email.email_sends s WHERE s.dispatch_state IN('uncertain','manual_review') AND s.created_at>=start_day::timestamp AT TIME ZONE 'UTC' AND s.created_at<(start_day+7)::timestamp AT TIME ZONE 'UTC' AND s.anonymized_at IS NULL),
 'delivered',count(*) FILTER(WHERE delivered)::text,'bounced',count(*) FILTER(WHERE bounced)::text,'complained',count(*) FILTER(WHERE complained)::text,
 'suspectedHumanOpens',count(*) FILTER(WHERE human_opens)::text,'machineOpens',count(*) FILTER(WHERE machine_opens)::text,'unknownOpens',count(*) FILTER(WHERE unknown_opens)::text,
 'suspectedHumanClicks',count(*) FILTER(WHERE human_clicks)::text,'machineClicks',count(*) FILTER(WHERE machine_clicks)::text,'unknownClicks',count(*) FILTER(WHERE unknown_clicks)::text) FROM facts;
$$;

INSERT INTO admin.roles(code,permissions,policy_version) VALUES
 ('partner_caseworker','["partner.disputes"]','p2-local-insights-v1'),
 ('delivery_operator','["operations.email"]','p2-local-insights-v1'),
 ('visitor_operator','["operations.visitors"]','p2-local-insights-v1'),
 ('insights_analyst','["operations.insights"]','p2-local-insights-v1'),
 ('offer_event_writer','["operations.events"]','p2-local-insights-v1');
-- Owner/Privacy grants are deliberately not assigned or broadened here.
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['operations_receipts','operations_audit','operations_clicks','operations_releases','operations_release_subjects','operations_domain_samples'] LOOP
 EXECUTE format('ALTER TABLE partners.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE partners.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY insights_owner ON partners.%I TO tt_app_migrator USING(true) WITH CHECK(true)',t);
 EXECUTE format('CREATE POLICY insights_service ON partners.%I TO tt_p2_insights_service USING(true) WITH CHECK(true)',t);
 END LOOP;
END $$;
GRANT USAGE ON SCHEMA partners TO tt_p2_insights_service;
GRANT SELECT,INSERT ON partners.operations_receipts,partners.operations_audit,partners.operations_clicks,partners.operations_release_subjects,partners.operations_domain_samples TO tt_p2_insights_service;
GRANT SELECT,INSERT,UPDATE ON partners.operations_releases TO tt_p2_insights_service;
GRANT DELETE ON partners.operations_clicks,partners.operations_release_subjects,partners.operations_domain_samples TO tt_p2_insights_service;
GRANT SELECT,INSERT ON partners.redemption_events,partners.dispute_events TO tt_p2_insights_service;
GRANT SELECT(id,org_id,reservation_id,reason_code,state,resolution_event_id,closed_at,created_at),INSERT ON partners.disputes TO tt_p2_insights_service;
GRANT UPDATE(state,resolution_event_id,closed_at) ON partners.disputes TO tt_p2_insights_service;
CREATE POLICY insights_redemptions ON partners.redemption_events TO tt_p2_insights_service USING(true) WITH CHECK(true);
CREATE POLICY insights_disputes ON partners.disputes TO tt_p2_insights_service USING(true) WITH CHECK(true);
CREATE POLICY insights_dispute_events ON partners.dispute_events TO tt_p2_insights_service USING(true) WITH CHECK(true);
REVOKE ALL ON FUNCTION partners.ops_staff(uuid,text,text),partners.ops_member(uuid,text,boolean),partners.ops_permitted(uuid,text,timestamptz,bigint),partners.ops_lock_subjects(uuid[]),partners.ops_partner_facts(uuid,date),partners.ops_visitor_facts(date),partners.ops_assignment(uuid,uuid,boolean),partners.ops_invalidate(uuid),partners.ops_privacy_change(),partners.ops_source_change(),partners.ops_purge(uuid),partners.ops_before_subject_delete(),partners.ops_reveal(uuid,text,uuid,date,text,uuid),partners.ops_reveal_audit(uuid,uuid,text,uuid),partners.ops_health(date),partners.guard_operations_release() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION partners.ops_staff(uuid,text,text),partners.ops_member(uuid,text,boolean),partners.ops_permitted(uuid,text,timestamptz,bigint),partners.ops_lock_subjects(uuid[]),partners.ops_partner_facts(uuid,date),partners.ops_visitor_facts(date),partners.ops_assignment(uuid,uuid,boolean),partners.ops_purge(uuid),partners.ops_reveal(uuid,text,uuid,date,text,uuid),partners.ops_health(date) TO tt_p2_insights_service;

CREATE FUNCTION partners.ops_allow_click(organization uuid,assignment uuid,collected timestamptz) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM partners.coupon_reservations a JOIN email.email_sends s ON s.id=a.send_id JOIN privacy.contacts c ON c.id=s.recipient_contact_id
 WHERE a.org_id=organization AND a.id=assignment AND s.accepted_at<=collected AND s.dispatch_state='accepted' AND s.anonymized_at IS NULL AND c.status='active' AND partners.ops_permitted(c.subject_id,'email',collected));
$$;
REVOKE ALL ON FUNCTION partners.ops_allow_click(uuid,uuid,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION partners.ops_allow_click(uuid,uuid,timestamptz) TO tt_p2_insights_service;
CREATE FUNCTION partners.ops_send_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE person uuid;
BEGIN
 SELECT subject_id INTO person FROM privacy.contacts WHERE id=coalesce(NEW.recipient_contact_id,OLD.recipient_contact_id);
 IF person IS NOT NULL THEN PERFORM partners.ops_invalidate(person);END IF;RETURN coalesce(NEW,OLD);
END $$;
CREATE TRIGGER operations_send_privacy BEFORE UPDATE OF anonymized_at,recipient_contact_id,expires_at OR DELETE ON email.email_sends FOR EACH ROW EXECUTE FUNCTION partners.ops_send_change();
CREATE FUNCTION partners.ops_assignment_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE person uuid;BEGIN
 SELECT c.subject_id INTO person FROM email.email_sends s JOIN privacy.contacts c ON c.id=s.recipient_contact_id WHERE s.id=OLD.send_id;
 IF person IS NOT NULL THEN PERFORM partners.ops_invalidate(person);END IF;
 DELETE FROM partners.operations_clicks WHERE reservation_id=OLD.id;RETURN OLD;
END $$;
CREATE TRIGGER operations_assignment_erasure BEFORE DELETE ON partners.coupon_reservations FOR EACH ROW EXECUTE FUNCTION partners.ops_assignment_delete();
REVOKE ALL ON FUNCTION partners.ops_send_change(),partners.ops_assignment_delete() FROM PUBLIC;
CREATE INDEX operations_accepted_sends_idx ON email.email_sends(accepted_at,id) WHERE dispatch_state='accepted' AND anonymized_at IS NULL;

-- These invoker triggers/row-lock statements need only narrow metadata/lock columns.
GRANT SELECT(id,org_id,pool_mode) ON partners.coupon_reservations TO tt_p2_insights_service;
CREATE POLICY insights_reservation_metadata ON partners.coupon_reservations FOR SELECT TO tt_p2_insights_service USING(true);
GRANT UPDATE(id) ON partners.operations_clicks,partners.operations_domain_samples TO tt_p2_insights_service;
GRANT UPDATE(release_id) ON partners.operations_release_subjects TO tt_p2_insights_service;
