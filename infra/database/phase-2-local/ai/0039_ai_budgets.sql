CREATE TABLE app.ai_budget_windows (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 policy_key text NOT NULL CHECK(length(btrim(policy_key)) BETWEEN 1 AND 200),
 policy_version_id uuid NOT NULL REFERENCES app.ai_policy_versions(id) ON DELETE RESTRICT,
 window_start timestamptz NOT NULL, window_end timestamptz NOT NULL,
 currency_code text NOT NULL REFERENCES app.currencies(code) ON DELETE RESTRICT,
 limit_minor bigint NOT NULL CHECK(limit_minor>=0),
 reserved_minor bigint NOT NULL DEFAULT 0 CHECK(reserved_minor>=0),
 spent_minor bigint NOT NULL DEFAULT 0 CHECK(spent_minor>=0),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(policy_key,window_start,currency_code), UNIQUE(id,policy_version_id,currency_code),
 CHECK(window_end>window_start), CHECK(spent_minor<=limit_minor AND reserved_minor<=limit_minor-spent_minor)
);
CREATE INDEX ai_budget_policy_idx ON app.ai_budget_windows(policy_version_id,window_end);
CREATE TABLE app.ai_budget_reservations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 budget_id uuid NOT NULL, attempt_id uuid NOT NULL, policy_version_id uuid NOT NULL, currency_code text NOT NULL,
 reserved_minor bigint NOT NULL CHECK(reserved_minor>0),
 settled_minor bigint CHECK(settled_minor>=0 AND settled_minor<=reserved_minor),
 state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','uncertain','settled','released')),
 release_reason text CHECK(release_reason IN ('not_dispatched','confirmed_not_charged')),
 evidence_id uuid REFERENCES admin.audit_events(id) ON DELETE RESTRICT,
 reconciled_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(budget_id,attempt_id),
 FOREIGN KEY(budget_id,policy_version_id,currency_code) REFERENCES app.ai_budget_windows(id,policy_version_id,currency_code) ON DELETE RESTRICT,
 FOREIGN KEY(attempt_id,policy_version_id,currency_code) REFERENCES app.ai_attempts(id,policy_version_id,currency_code) ON DELETE RESTRICT,
 CHECK((state='settled')=(settled_minor IS NOT NULL)),
 CHECK((state IN ('settled','released'))=(reconciled_at IS NOT NULL)),
 CHECK((state='released')=(release_reason IS NOT NULL)),
 CHECK(state<>'released' OR evidence_id IS NOT NULL),
 CHECK(reconciled_at IS NULL OR reconciled_at>=created_at)
);
CREATE INDEX ai_budget_attempt_idx ON app.ai_budget_reservations(attempt_id,id);
CREATE INDEX ai_budget_uncertain_idx ON app.ai_budget_reservations(state,created_at,id);
CREATE INDEX ai_budget_evidence_idx ON app.ai_budget_reservations(evidence_id);
CREATE FUNCTION app.ai_account_budget() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE a app.ai_attempts%ROWTYPE; b app.ai_budget_windows%ROWTYPE; held bigint; charged bigint;
BEGIN
 SELECT * INTO a FROM app.ai_attempts WHERE id=NEW.attempt_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI budget attempt must already exist' USING ERRCODE='23503'; END IF;
 IF (a.policy_version_id,a.currency_code) IS DISTINCT FROM (NEW.policy_version_id,NEW.currency_code) THEN
  RAISE EXCEPTION 'AI budget attempt identity mismatch' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  PERFORM app.ai_assert_request(a.request_id,false);
  IF NEW.state<>'reserved' OR a.state<>'created' THEN RAISE EXCEPTION 'AI cost must be reserved before dispatch' USING ERRCODE='23514'; END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['state','settled_minor','release_reason','evidence_id','reconciled_at']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['state','settled_minor','release_reason','evidence_id','reconciled_at'])
    OR (OLD.state IN ('settled','released') AND NEW IS DISTINCT FROM OLD)
    OR (OLD.state<>NEW.state AND NOT ((OLD.state='reserved' AND NEW.state IN ('uncertain','settled','released')) OR (OLD.state='uncertain' AND NEW.state IN ('settled','released'))))
  THEN RAISE EXCEPTION 'AI cost reservation cannot rewind or settle twice' USING ERRCODE='23514'; END IF;
  IF NEW.state='released' AND ((OLD.state='uncertain' AND NEW.release_reason<>'confirmed_not_charged') OR (NEW.release_reason='not_dispatched' AND a.started_at IS NOT NULL)) THEN
   RAISE EXCEPTION 'Uncertain AI charge needs definitive reconciliation' USING ERRCODE='23514'; END IF;
  IF NEW.state='settled' AND a.state NOT IN ('succeeded','failed','uncertain') THEN RAISE EXCEPTION 'AI settlement requires an attempted call' USING ERRCODE='23514'; END IF;
 END IF;
 SELECT * INTO b FROM app.ai_budget_windows WHERE id=NEW.budget_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'AI budget window must already exist' USING ERRCODE='23503'; END IF;
 IF (b.policy_version_id,b.currency_code) IS DISTINCT FROM (NEW.policy_version_id,NEW.currency_code) THEN
  RAISE EXCEPTION 'AI budget policy/currency mismatch' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF clock_timestamp()<b.window_start OR clock_timestamp()>=b.window_end THEN RAISE EXCEPTION 'AI budget window expired' USING ERRCODE='23514'; END IF;
  held:=NEW.reserved_minor; charged:=0;
 ELSE
  held:=(CASE WHEN NEW.state IN ('reserved','uncertain') THEN NEW.reserved_minor ELSE 0 END)
     -(CASE WHEN OLD.state IN ('reserved','uncertain') THEN OLD.reserved_minor ELSE 0 END);
  charged:=(CASE WHEN NEW.state='settled' THEN NEW.settled_minor ELSE 0 END)
     -(CASE WHEN OLD.state='settled' THEN OLD.settled_minor ELSE 0 END);
 END IF;
 UPDATE app.ai_budget_windows SET reserved_minor=reserved_minor+held,spent_minor=spent_minor+charged WHERE id=b.id;
 RETURN NEW;
END $$;
-- AFTER skips accounting for INSERTs suppressed by ON CONFLICT and counts upserts once.
CREATE TRIGGER ai_budget_accounting AFTER INSERT OR UPDATE ON app.ai_budget_reservations FOR EACH ROW EXECUTE FUNCTION app.ai_account_budget();
CREATE FUNCTION app.ai_guard_budget_window() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF (to_jsonb(NEW)-ARRAY['reserved_minor','spent_minor']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['reserved_minor','spent_minor']) THEN
  RAISE EXCEPTION 'AI configured budget identity is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_budget_identity BEFORE UPDATE ON app.ai_budget_windows FOR EACH ROW EXECUTE FUNCTION app.ai_guard_budget_window();
CREATE FUNCTION app.ai_require_budget() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.state='started' AND OLD.state<>'started' AND NOT EXISTS(SELECT 1 FROM app.ai_budget_reservations WHERE attempt_id=NEW.id AND state='reserved') THEN
  RAISE EXCEPTION 'AI attempt needs a live cost reservation before dispatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_attempt_budget BEFORE UPDATE ON app.ai_attempts FOR EACH ROW EXECUTE FUNCTION app.ai_require_budget();

-- Fixed local AI role policies and grants.
ALTER TABLE app.ai_budget_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_budget_windows FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.ai_budget_windows FROM PUBLIC;
CREATE POLICY ai_budget_windows_owner ON app.ai_budget_windows TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY ai_budget_windows_worker ON app.ai_budget_windows TO tt_p2_ai_worker USING(true) WITH CHECK(true);
CREATE POLICY ai_budget_windows_staff ON app.ai_budget_windows TO tt_p2_ai_staff USING(true) WITH CHECK(true);
ALTER TABLE app.ai_budget_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.ai_budget_reservations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON app.ai_budget_reservations FROM PUBLIC;
CREATE POLICY ai_budget_reservations_owner ON app.ai_budget_reservations TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE POLICY ai_budget_reservations_worker ON app.ai_budget_reservations TO tt_p2_ai_worker USING(true) WITH CHECK(true);
REVOKE ALL ON FUNCTION app.ai_account_budget() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.ai_guard_budget_window() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.ai_require_budget() FROM PUBLIC;
GRANT SELECT ON app.ai_budget_windows TO tt_p2_ai_worker,tt_p2_ai_staff;
GRANT INSERT(id,policy_key,policy_version_id,window_start,window_end,currency_code,limit_minor) ON app.ai_budget_windows TO tt_p2_ai_staff;
GRANT SELECT,INSERT,UPDATE ON app.ai_budget_reservations TO tt_p2_ai_worker;
