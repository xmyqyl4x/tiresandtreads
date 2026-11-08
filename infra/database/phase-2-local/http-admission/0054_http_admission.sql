-- Opt-in disposable/local HTTP command admission. No raw identity, payload or response cache.
CREATE TABLE admin.p2_http_admissions(command_hash text PRIMARY KEY CHECK(command_hash ~ '^[a-f0-9]{64}$'),fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),created_at timestamptz NOT NULL DEFAULT statement_timestamp());
ALTER TABLE admin.p2_http_admissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin.p2_http_admissions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON admin.p2_http_admissions FROM PUBLIC;
CREATE POLICY p2_http_migrator ON admin.p2_http_admissions TO tt_app_migrator USING(true) WITH CHECK(true);
CREATE FUNCTION admin.p2_http_admit(command text,body text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF command !~ '^[a-f0-9]{64}$' OR body !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Bound HTTP command required' USING ERRCODE='23514';END IF;
 PERFORM pg_advisory_xact_lock(54,1);
 IF EXISTS(SELECT 1 FROM admin.p2_http_admissions WHERE command_hash=command) THEN RETURN false;END IF;
 IF (SELECT count(*) FROM admin.p2_http_admissions)>=100000 THEN RAISE EXCEPTION 'Local HTTP admission capacity reached' USING ERRCODE='54000';END IF;
 INSERT INTO admin.p2_http_admissions(command_hash,fingerprint) VALUES(command,body);RETURN true;
END $$;
REVOKE ALL ON FUNCTION admin.p2_http_admit(text,text) FROM PUBLIC;
GRANT USAGE ON SCHEMA admin TO tt_p2_partner_service,tt_p2_csv_staff;
GRANT EXECUTE ON FUNCTION admin.p2_http_admit(text,text) TO tt_p2_partner_service,tt_p2_csv_staff;

CREATE FUNCTION admin.csv_http_rollback_market(actor uuid,intake uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE market text;BEGIN
 PERFORM admin.csv_service_actor(actor,'data.publish');
 SELECT c.market INTO market FROM admin.csv_upload_commands c WHERE c.id=intake AND c.phase='published' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Published CSV intake required' USING ERRCODE='23514';END IF;RETURN market;
END $$;
REVOKE ALL ON FUNCTION admin.csv_http_rollback_market(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin.csv_http_rollback_market(uuid,uuid) TO tt_publish_runtime;
