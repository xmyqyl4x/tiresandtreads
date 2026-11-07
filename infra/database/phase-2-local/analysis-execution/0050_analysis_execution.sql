-- Opt-in execution/caching support. No production bootstrap/runtime promotion.
CREATE TABLE app.ai_cost_plans(
 policy_id uuid PRIMARY KEY REFERENCES app.ai_policy_versions(id) ON DELETE RESTRICT,
 configuration_hash text NOT NULL CHECK(configuration_hash ~ '^[a-f0-9]{64}$'),
 input_ceiling bigint NOT NULL CHECK(input_ceiling BETWEEN 1 AND 1048576), output_ceiling bigint NOT NULL CHECK(output_ceiling BETWEEN 1 AND 4096),
 input_per_million_minor bigint NOT NULL CHECK(input_per_million_minor>=0),output_per_million_minor bigint NOT NULL CHECK(output_per_million_minor>=0),
 daily_limit bigint NOT NULL CHECK(daily_limit>=0),hourly_limit bigint NOT NULL CHECK(hourly_limit>=0),owner_daily_limit bigint NOT NULL CHECK(owner_daily_limit>=0),
 max_concurrency integer NOT NULL CHECK(max_concurrency BETWEEN 1 AND 4),
 status text NOT NULL CHECK(status IN('active','blocked')),
 reviewed_by uuid NOT NULL REFERENCES admin.staff_identities(id) ON DELETE RESTRICT,reviewed_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
CREATE FUNCTION app.ai_cost_plan_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p app.ai_policy_versions%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' AND OLD.status='blocked' AND NEW.status='active' THEN RAISE EXCEPTION 'New reviewed policy/price plan required after blocking' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN RAISE EXCEPTION 'Reviewed price/limits immutable; new policy and limits required' USING ERRCODE='23514';END IF;
 SELECT * INTO p FROM app.ai_policy_versions WHERE id=NEW.policy_id;
 IF p.configuration_hash IS DISTINCT FROM NEW.configuration_hash OR p.reviewed_at IS NULL OR
 NEW.input_ceiling<>(CASE WHEN p.task='photo_extraction' THEN 1048576 ELSE 65536 END) OR
 NEW.output_ceiling<>(CASE p.task WHEN 'report_analysis' THEN 4096 WHEN 'generic_explanation' THEN 512 ELSE 1024 END)
 THEN RAISE EXCEPTION 'Price plan must match the evaluated transport bounds/configuration' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_cost_plan_identity BEFORE INSERT OR UPDATE ON app.ai_cost_plans FOR EACH ROW EXECUTE FUNCTION app.ai_cost_plan_guard();
CREATE TABLE app.ai_provider_circuits(
 policy_id uuid PRIMARY KEY REFERENCES app.ai_policy_versions(id) ON DELETE RESTRICT,
 generation bigint NOT NULL DEFAULT 1 CHECK(generation>0),state text NOT NULL DEFAULT 'closed' CHECK(state IN('closed','open','half_open')),
 failures integer NOT NULL DEFAULT 0 CHECK(failures BETWEEN 0 AND 3),open_until timestamptz,probe_until timestamptz,
 CHECK((state='open')=(open_until IS NOT NULL)),CHECK((state='half_open')=(probe_until IS NOT NULL))
);
CREATE TABLE app.ai_execution_states(
 request_id uuid PRIMARY KEY REFERENCES app.ai_analysis_requests(id) ON DELETE RESTRICT,
 policy_id uuid NOT NULL REFERENCES app.ai_policy_versions(id) ON DELETE RESTRICT,
 attempt_id uuid NOT NULL REFERENCES app.ai_attempts(id) ON DELETE RESTRICT,ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 3),
 lease_holder uuid NOT NULL,reuse_fence bigint NOT NULL CHECK(reuse_fence>0),circuit_generation bigint NOT NULL CHECK(circuit_generation>0),
 state text NOT NULL CHECK(state IN('inflight','retry','complete','failed','uncertain')),next_at timestamptz,lease_until timestamptz NOT NULL,
 CHECK((state='retry')=(next_at IS NOT NULL))
);
CREATE INDEX ai_execution_slots_idx ON app.ai_execution_states(policy_id,lease_until) WHERE state='inflight';
CREATE TABLE app.ai_report_commands(
 scope_id uuid NOT NULL REFERENCES app.ai_reuse_scopes(id) ON DELETE RESTRICT,command_key text NOT NULL CHECK(command_key ~ '^[A-Za-z0-9_-]{16,128}$'),
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),permission_revision bigint NOT NULL CHECK(permission_revision>0),invalidation_revision bigint NOT NULL CHECK(invalidation_revision>=0),
 request_id uuid NOT NULL REFERENCES app.ai_report_work(request_id) ON DELETE RESTRICT,report_id uuid NOT NULL,report_version integer NOT NULL,
 PRIMARY KEY(scope_id,command_key),FOREIGN KEY(report_id,report_version) REFERENCES app.report_versions(report_id,version) ON DELETE RESTRICT
);
CREATE INDEX ai_report_commands_request_idx ON app.ai_report_commands(request_id);
CREATE TRIGGER ai_report_command_immutable BEFORE UPDATE ON app.ai_report_commands FOR EACH ROW EXECUTE FUNCTION app.reject_history_change();
CREATE FUNCTION app.ai_report_command_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM app.ai_repository_scope(NEW.scope_id,true);
 IF NOT EXISTS(SELECT 1 FROM app.ai_analysis_requests r JOIN app.ai_report_work w ON w.request_id=r.id WHERE r.id=NEW.request_id AND r.scope_id=NEW.scope_id AND r.input_digest=NEW.digest AND r.permission_revision=NEW.permission_revision AND r.invalidation_revision=NEW.invalidation_revision AND EXISTS(SELECT 1 FROM app.ai_scope_guards g WHERE g.scope_id=r.scope_id AND g.permission_revision=NEW.permission_revision AND g.invalidation_revision=NEW.invalidation_revision) AND w.report_id=NEW.report_id AND w.report_version=NEW.report_version) THEN RAISE EXCEPTION 'Command receipt must bind current exact owner work' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_report_command_guard BEFORE INSERT ON app.ai_report_commands FOR EACH ROW EXECUTE FUNCTION app.ai_report_command_guard();
CREATE TABLE app.ai_generic_definitions(
 id uuid PRIMARY KEY,policy_id uuid NOT NULL REFERENCES app.ai_policy_versions(id) ON DELETE RESTRICT,
 advice_id uuid NOT NULL REFERENCES app.advice_facts(id) ON DELETE RESTRICT,claim_hash text NOT NULL CHECK(claim_hash ~ '^[a-f0-9]{64}$'),
 renderer_version text NOT NULL CHECK(renderer_version='generic-render-v1'),status text NOT NULL CHECK(status IN('reviewed','retired')),
 reviewed_by uuid NOT NULL REFERENCES admin.staff_identities(id) ON DELETE RESTRICT,reviewed_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
CREATE TRIGGER ai_generic_definition_identity BEFORE UPDATE ON app.ai_generic_definitions FOR EACH ROW EXECUTE FUNCTION app.guard_identity_columns('id','policy_id','advice_id','claim_hash','renderer_version','reviewed_by','reviewed_at');
CREATE TABLE app.ai_generic_work(
 request_id uuid PRIMARY KEY REFERENCES app.ai_analysis_requests(id) ON DELETE RESTRICT,
 definition_id uuid NOT NULL REFERENCES app.ai_generic_definitions(id) ON DELETE RESTRICT,
 packet jsonb NOT NULL CHECK(jsonb_typeof(packet)='object' AND octet_length(packet::text)<=8192),job_id uuid UNIQUE REFERENCES app.job_runs(id) ON DELETE RESTRICT
);
CREATE TABLE app.ai_shared_demand(
 scope_id uuid NOT NULL REFERENCES app.ai_reuse_scopes(id) ON DELETE RESTRICT,digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 hour timestamptz NOT NULL,hits integer NOT NULL DEFAULT 1 CHECK(hits BETWEEN 1 AND 1000000),refresh_hour timestamptz,
 PRIMARY KEY(scope_id,digest,hour)
);
CREATE INDEX ai_shared_demand_due_idx ON app.ai_shared_demand(hour,scope_id,digest);
CREATE TABLE app.ai_refresh_batches(hour timestamptz PRIMARY KEY,scheduled integer NOT NULL DEFAULT 0 CHECK(scheduled BETWEEN 0 AND 25));
CREATE FUNCTION app.ai_generic_source(definition uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d app.ai_generic_definitions%ROWTYPE;f app.advice_facts%ROWTYPE;p app.ai_policy_versions%ROWTYPE;until timestamptz;license uuid;provider uuid;
BEGIN
 SELECT * INTO d FROM app.ai_generic_definitions WHERE id=definition AND status='reviewed' FOR SHARE;IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO p FROM app.ai_policy_versions WHERE id=d.policy_id AND task='generic_explanation' AND shared_allowed AND status='active' FOR SHARE;IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO f FROM app.advice_facts WHERE id=d.advice_id AND market='US' AND locale='en-US' AND status='reviewed' AND applicability='{}'::jsonb AND review_due_at>clock_timestamp() FOR SHARE;IF NOT FOUND THEN RETURN NULL;END IF;
 IF encode(sha256(convert_to(f.claim,'UTF8')),'hex')<>d.claim_hash OR length(f.claim)>2000 OR f.claim ~ '[<>]' THEN RETURN NULL;END IF;
 -- Reviewed context-independent education is version-pinned separately from report bundles.
 IF EXISTS(SELECT 1 FROM app.ai_generic_definitions newer JOIN app.advice_facts nf ON nf.id=newer.advice_id JOIN app.ai_policy_versions np ON np.id=newer.policy_id WHERE nf.topic_key=f.topic_key AND nf.market=f.market AND nf.locale=f.locale AND np.template_key=p.template_key AND (newer.reviewed_at,newer.id)>(d.reviewed_at,d.id)) THEN RETURN NULL;END IF;
 SELECT license_id,provider_id INTO license,provider FROM app.dataset_versions WHERE id=f.dataset_version_id;
 PERFORM 1 FROM app.data_providers WHERE id=provider FOR SHARE;PERFORM 1 FROM app.data_licenses WHERE id=license FOR SHARE;PERFORM 1 FROM app.dataset_versions WHERE id=f.dataset_version_id FOR SHARE;
 SELECT least(s.expires_at,f.review_due_at) INTO until FROM app.catalog_sources s WHERE s.dataset_id=f.dataset_version_id AND s.market='US' AND s.rights->'ai_processing'='true'::jsonb AND s.rights->'cache'='true'::jsonb AND s.rights->'derived'='true'::jsonb AND s.rights->'snapshot'='true'::jsonb;
 IF NOT FOUND OR until<=clock_timestamp() THEN RETURN NULL;END IF;
 RETURN jsonb_build_object('definition',d.id,'policyId',p.id,'adviceId',f.id,'text',f.claim,'source',f.dataset_version_id,'validUntil',until);
END $$;
CREATE FUNCTION app.ai_generic_work_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app.ai_analysis_requests%ROWTYPE;e jsonb;
BEGIN
 IF TG_OP='UPDATE' THEN IF (to_jsonb(NEW)-'job_id') IS DISTINCT FROM (to_jsonb(OLD)-'job_id') OR OLD.job_id IS NOT NULL OR NEW.job_id IS NULL THEN RAISE EXCEPTION 'Generic work immutable' USING ERRCODE='23514';END IF;
 ELSE
 SELECT * INTO r FROM app.ai_analysis_requests WHERE id=NEW.request_id;PERFORM app.ai_repository_scope(r.scope_id,true);e:=app.ai_generic_source(NEW.definition_id);
 IF NEW.packet->>'schema' IS DISTINCT FROM 'generic-evidence-v1' OR (NEW.packet-ARRAY['schema','definition','parameters','fact'])<>'{}'::jsonb OR ((NEW.packet->'fact')-ARRAY['id','text','source','validUntil'])<>'{}'::jsonb OR jsonb_typeof(NEW.packet->'fact'->'validUntil') IS DISTINCT FROM 'string' OR e IS NULL OR r.owner_subject_id IS NOT NULL OR r.policy_version_id::text IS DISTINCT FROM e->>'policyId' OR r.input_manifest->>'rule_version' IS DISTINCT FROM NEW.definition_id::text OR r.input_manifest->>'advice_revision' IS DISTINCT FROM e->>'adviceId' OR NEW.packet->'parameters' IS DISTINCT FROM r.input_manifest->'parameters' OR NEW.packet->>'definition' IS DISTINCT FROM NEW.definition_id::text OR NEW.packet->'fact'->>'id' IS DISTINCT FROM e->>'adviceId' OR NEW.packet->'fact'->>'text' IS DISTINCT FROM e->>'text' OR NEW.packet->'fact'->>'source' IS DISTINCT FROM e->>'source' OR (NEW.packet->'fact'->>'validUntil')::timestamptz> (e->>'validUntil')::timestamptz OR NEW.job_id IS NOT NULL THEN RAISE EXCEPTION 'Generic work must use reviewed public evidence only' USING ERRCODE='23514';END IF;
 END IF;
 IF NEW.job_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.job_runs WHERE id=NEW.job_id AND job_type='ai.generic-analysis' AND resource_id=NEW.request_id AND schema_version=1) THEN RAISE EXCEPTION 'Generic job binding mismatch' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_generic_work_guard BEFORE INSERT OR UPDATE ON app.ai_generic_work FOR EACH ROW EXECUTE FUNCTION app.ai_generic_work_guard();
CREATE POLICY ai_generic_jobs ON app.job_runs TO tt_p2_analysis_service USING(job_type='ai.generic-analysis') WITH CHECK(job_type='ai.generic-analysis' AND resource_id IN(SELECT request_id FROM app.ai_generic_work));
ALTER TABLE app.ai_cost_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_cost_plans FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.ai_cost_plans FROM PUBLIC;
CREATE POLICY ai_cost_plans_owner ON app.ai_cost_plans TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY ai_cost_plans_service ON app.ai_cost_plans TO tt_p2_analysis_service USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON app.ai_cost_plans TO tt_p2_analysis_service;
ALTER TABLE app.ai_provider_circuits ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_provider_circuits FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.ai_provider_circuits FROM PUBLIC;
CREATE POLICY ai_provider_circuits_owner ON app.ai_provider_circuits TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY ai_provider_circuits_service ON app.ai_provider_circuits TO tt_p2_analysis_service USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON app.ai_provider_circuits TO tt_p2_analysis_service;
ALTER TABLE app.ai_execution_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_execution_states FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.ai_execution_states FROM PUBLIC;
CREATE POLICY ai_execution_states_owner ON app.ai_execution_states TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY ai_execution_states_service ON app.ai_execution_states TO tt_p2_analysis_service USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON app.ai_execution_states TO tt_p2_analysis_service;
ALTER TABLE app.ai_report_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_report_commands FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.ai_report_commands FROM PUBLIC;
CREATE POLICY ai_report_commands_owner ON app.ai_report_commands TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY ai_report_commands_service ON app.ai_report_commands TO tt_p2_analysis_service USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON app.ai_report_commands TO tt_p2_analysis_service;
ALTER TABLE app.ai_generic_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_generic_definitions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.ai_generic_definitions FROM PUBLIC;
CREATE POLICY ai_generic_definitions_owner ON app.ai_generic_definitions TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY ai_generic_definitions_service ON app.ai_generic_definitions TO tt_p2_analysis_service USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON app.ai_generic_definitions TO tt_p2_analysis_service;
ALTER TABLE app.ai_generic_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_generic_work FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.ai_generic_work FROM PUBLIC;
CREATE POLICY ai_generic_work_owner ON app.ai_generic_work TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY ai_generic_work_service ON app.ai_generic_work TO tt_p2_analysis_service USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON app.ai_generic_work TO tt_p2_analysis_service;
ALTER TABLE app.ai_shared_demand ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_shared_demand FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.ai_shared_demand FROM PUBLIC;
CREATE POLICY ai_shared_demand_owner ON app.ai_shared_demand TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY ai_shared_demand_service ON app.ai_shared_demand TO tt_p2_analysis_service USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON app.ai_shared_demand TO tt_p2_analysis_service;
ALTER TABLE app.ai_refresh_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_refresh_batches FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.ai_refresh_batches FROM PUBLIC;
CREATE POLICY ai_refresh_batches_owner ON app.ai_refresh_batches TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY ai_refresh_batches_service ON app.ai_refresh_batches TO tt_p2_analysis_service USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON app.ai_refresh_batches TO tt_p2_analysis_service;
REVOKE ALL ON FUNCTION app.ai_cost_plan_guard(),app.ai_report_command_guard(),app.ai_generic_source(uuid),app.ai_generic_work_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ai_generic_source(uuid) TO tt_p2_analysis_service;

CREATE FUNCTION app.ai_generic_current(request uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app.ai_analysis_requests%ROWTYPE;w app.ai_generic_work%ROWTYPE;e jsonb;
BEGIN
 SELECT * INTO r FROM app.ai_analysis_requests WHERE id=request;IF NOT FOUND THEN RETURN false;END IF;
 PERFORM app.ai_repository_scope(r.scope_id,false);
 IF r.owner_subject_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM app.ai_scope_guards g JOIN app.ai_policy_versions p ON p.id=r.policy_version_id WHERE g.scope_id=r.scope_id AND g.processing_allowed AND g.state='active' AND p.status='active' AND p.task='generic_explanation' AND p.shared_allowed AND g.permission_revision=r.permission_revision AND g.invalidation_revision=r.invalidation_revision) THEN RETURN false;END IF;
 SELECT * INTO w FROM app.ai_generic_work WHERE request_id=request;IF NOT FOUND THEN RETURN false;END IF;e:=app.ai_generic_source(w.definition_id);
 RETURN e IS NOT NULL AND r.policy_version_id::text=e->>'policyId' AND w.packet->'fact'->>'id'=e->>'adviceId' AND w.packet->'fact'->>'text'=e->>'text' AND w.packet->'fact'->>'source'=e->>'source' AND (w.packet->'fact'->>'validUntil')::timestamptz<=(e->>'validUntil')::timestamptz AND (w.packet->'fact'->>'validUntil')::timestamptz>clock_timestamp();
END $$;
REVOKE ALL ON FUNCTION app.ai_generic_current(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ai_generic_current(uuid) TO tt_p2_analysis_service;
GRANT DELETE ON app.ai_shared_demand,app.ai_refresh_batches TO tt_p2_analysis_service;
CREATE FUNCTION app.ai_shared_demand_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM app.ai_reuse_scopes s JOIN app.ai_policy_versions p ON p.id=s.policy_version_id WHERE s.id=NEW.scope_id AND s.kind='shared' AND p.task='generic_explanation' AND p.shared_allowed) THEN RAISE EXCEPTION 'Operational popularity cannot contain owner keys' USING ERRCODE='23514';END IF;
 IF NEW.hour<>date_trunc('hour',NEW.hour AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' THEN RAISE EXCEPTION 'Fixed UTC hour required' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_shared_demand_guard BEFORE INSERT OR UPDATE ON app.ai_shared_demand FOR EACH ROW EXECUTE FUNCTION app.ai_shared_demand_guard();
REVOKE ALL ON FUNCTION app.ai_shared_demand_guard() FROM PUBLIC;

CREATE INDEX ai_generic_definition_latest_idx ON app.ai_generic_definitions(advice_id,reviewed_at,id);
CREATE INDEX ai_generic_topic_idx ON app.advice_facts(market,locale,topic_key,id);
CREATE FUNCTION app.ai_generic_definition_state() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN IF OLD.status='retired' AND NEW.status<>'retired' THEN RAISE EXCEPTION 'Retired definitions require a new reviewed version' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER ai_generic_definition_state BEFORE UPDATE ON app.ai_generic_definitions FOR EACH ROW EXECUTE FUNCTION app.ai_generic_definition_state();
REVOKE ALL ON FUNCTION app.ai_generic_definition_state() FROM PUBLIC;

-- Expiry uses a fixed bounded shared-only capability; private lease rows stay unwritable.
CREATE FUNCTION app.ai_expire_shared_cold() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE changed integer;
BEGIN
 WITH cold AS(SELECT e.scope_id,e.cache_key FROM app.ai_reuse_entries e JOIN app.ai_reuse_scopes s ON s.id=e.scope_id WHERE s.kind='shared' AND e.valid_until<=clock_timestamp() AND (e.state='ready' OR(e.state='leased' AND e.lease_until<=clock_timestamp())) ORDER BY e.scope_id,e.cache_key LIMIT 25 FOR UPDATE OF e)
 UPDATE app.ai_reuse_entries e SET state='invalidated',lease_holder=NULL,lease_until=NULL,fence=fence+1 FROM cold WHERE e.scope_id=cold.scope_id AND e.cache_key=cold.cache_key;
 GET DIAGNOSTICS changed=ROW_COUNT;RETURN changed;
END $$;
REVOKE ALL ON FUNCTION app.ai_expire_shared_cold() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ai_expire_shared_cold() TO tt_p2_analysis_service;

CREATE FUNCTION app.ai_execution_identity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app.ai_analysis_requests%ROWTYPE;a app.ai_attempts%ROWTYPE;
BEGIN
 SELECT * INTO r FROM app.ai_analysis_requests WHERE id=NEW.request_id;SELECT * INTO a FROM app.ai_attempts WHERE id=NEW.attempt_id;
 IF a.request_id IS DISTINCT FROM NEW.request_id OR a.policy_version_id IS DISTINCT FROM NEW.policy_id OR r.policy_version_id IS DISTINCT FROM NEW.policy_id OR a.attempt<>NEW.ordinal THEN RAISE EXCEPTION 'Execution request/attempt identity mismatch' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' AND (NEW.request_id,NEW.policy_id) IS DISTINCT FROM (OLD.request_id,OLD.policy_id) THEN RAISE EXCEPTION 'Execution root immutable' USING ERRCODE='23514';END IF;
 IF NEW.state='inflight' THEN
 IF a.state<>'started' OR r.state<>'running' OR NEW.lease_until<=clock_timestamp() OR NEW.lease_until>r.expires_at OR NEW.lease_until>clock_timestamp()+interval '30 seconds' OR NOT EXISTS(SELECT 1 FROM app.ai_reuse_entries e WHERE e.scope_id=r.scope_id AND e.cache_key=r.input_digest AND e.state='leased' AND e.lease_holder=NEW.lease_holder AND e.fence=NEW.reuse_fence AND e.lease_until>clock_timestamp()) OR NOT EXISTS(SELECT 1 FROM app.ai_provider_circuits c WHERE c.policy_id=NEW.policy_id AND c.generation=NEW.circuit_generation AND c.state<>'open') THEN RAISE EXCEPTION 'Execution needs current reserved attempt and fences' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' AND (OLD.state<>'retry' OR OLD.ordinal+1<>NEW.ordinal OR OLD.attempt_id=NEW.attempt_id OR OLD.next_at>clock_timestamp() OR (OLD.lease_holder,OLD.reuse_fence) IS DISTINCT FROM (NEW.lease_holder,NEW.reuse_fence)) THEN RAISE EXCEPTION 'Bounded retry progression required' USING ERRCODE='23514';END IF;
 ELSIF TG_OP='INSERT' THEN RAISE EXCEPTION 'Execution must start inflight' USING ERRCODE='23514';
 ELSE
 IF (to_jsonb(NEW)-ARRAY['state','next_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','next_at']) OR OLD.state<>'inflight' OR (NEW.state='complete' AND a.state<>'succeeded') OR (NEW.state='retry' AND (a.state<>'failed' OR a.cost_minor IS NULL OR a.cost_status<>'reconciled' OR NEW.ordinal>=3)) THEN RAISE EXCEPTION 'Execution outcome or retry identity invalid' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_execution_identity BEFORE INSERT OR UPDATE ON app.ai_execution_states FOR EACH ROW EXECUTE FUNCTION app.ai_execution_identity();
REVOKE ALL ON FUNCTION app.ai_execution_identity() FROM PUBLIC;

-- Only an expired recorded execution may reach the internal uncertainty ledger helper.
CREATE FUNCTION app.ai_recover_expired_dispatch(request uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r app.ai_analysis_requests%ROWTYPE;e app.ai_execution_states%ROWTYPE;
BEGIN
 SELECT * INTO r FROM app.ai_analysis_requests WHERE id=request;IF NOT FOUND THEN RAISE EXCEPTION 'Recorded execution unavailable' USING ERRCODE='23514';END IF;
 PERFORM app.ai_repository_scope(r.scope_id,false);
 SELECT * INTO e FROM app.ai_execution_states WHERE request_id=request AND state='uncertain' AND lease_until<=clock_timestamp() FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM app.ai_attempts WHERE id=e.attempt_id AND request_id=r.id AND state IN('started','succeeded','failed','uncertain')) OR r.state<>'running' THEN RAISE EXCEPTION 'Only an expired recorded dispatch may become uncertain' USING ERRCODE='23514';END IF;
 PERFORM app.ai_repository_uncertain_budgets(ARRAY[r.id]);
 UPDATE app.ai_attempts SET state='uncertain',finished_at=clock_timestamp(),error_code='timeout' WHERE id=e.attempt_id AND state='started';
 UPDATE app.ai_analysis_requests SET state='uncertain' WHERE id=r.id;
END $$;
REVOKE ALL ON FUNCTION app.ai_recover_expired_dispatch(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ai_recover_expired_dispatch(uuid) TO tt_p2_analysis_service;
