-- Public projection extensions, never cross-database foreign keys into Payload storage.
CREATE TABLE app.public_page_details (
  content_key text NOT NULL, locale text NOT NULL, market text NOT NULL, generation bigint NOT NULL,
  document_id uuid NOT NULL, collection text NOT NULL CHECK(collection IN ('articles','glossary-terms')),
  public_path text NOT NULL CHECK(admin.is_public_content_path(public_path)),
  document jsonb,
  PRIMARY KEY(content_key,locale,market,generation),
  UNIQUE(document_id,collection,generation),
  FOREIGN KEY(content_key,locale,market,generation) REFERENCES app.content_publications(content_key,locale,market,generation) ON DELETE RESTRICT,
  CHECK(document IS NULL OR (jsonb_typeof(document)='object' AND octet_length(document::text)<=240000))
);
CREATE INDEX public_page_details_origin_idx ON app.public_page_details(document_id,collection,generation DESC);
CREATE INDEX public_page_details_path_idx ON app.public_page_details(public_path,locale,market);
CREATE TRIGGER public_page_details_immutable BEFORE UPDATE OR DELETE ON app.public_page_details FOR EACH ROW EXECUTE FUNCTION app.reject_history_change();
CREATE VIEW app.public_pages WITH(security_barrier=true) AS
 SELECT s.id,d.public_path,d.content_key,d.locale,d.market,d.document FROM app.public_page_details d
 JOIN app.content_publication_heads h USING(content_key,locale,market,generation)
 JOIN app.content_publications p USING(content_key,locale,market,generation)
 JOIN admin.seo_page_registry s ON s.public_path=d.public_path AND s.locale=d.locale AND s.market=d.market AND s.content_key=d.content_key
 WHERE d.document IS NOT NULL AND p.content_id IS NOT NULL AND p.published_at<=clock_timestamp() AND p.expires_at>clock_timestamp()
 AND s.index_status='eligible' AND s.review_due_at>clock_timestamp();
CREATE TABLE app.redirect_publications (
 revision integer PRIMARY KEY CHECK(revision>0), issued_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 rules jsonb NOT NULL CHECK(jsonb_typeof(rules)='array' AND jsonb_array_length(rules)<=200 AND octet_length(rules::text)<=60000),
 checksum text NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'), reviewer_id uuid NOT NULL REFERENCES admin.staff_identities(id) ON DELETE RESTRICT,
 CHECK(expires_at>issued_at AND expires_at<=issued_at+interval '24 hours')
);
CREATE TRIGGER redirect_publications_immutable BEFORE UPDATE OR DELETE ON app.redirect_publications FOR EACH ROW EXECUTE FUNCTION app.reject_history_change();
CREATE VIEW app.current_redirects WITH(security_barrier=true) AS SELECT revision,issued_at,expires_at,rules,checksum FROM app.redirect_publications WHERE revision=(SELECT max(revision) FROM app.redirect_publications);
-- Current staff and role grants remain locked through the application publication transaction.
CREATE FUNCTION admin.authorize_content(actor uuid,permission text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF permission NOT IN ('content.publish','seo.publish') THEN RETURN false; END IF;
 PERFORM id FROM admin.staff_identities WHERE id=actor AND status='active' FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM a.staff_id FROM admin.staff_role_assignments a JOIN admin.roles r ON r.id=a.role_id
 WHERE a.staff_id=actor AND a.revoked_at IS NULL AND r.permissions ? permission FOR SHARE OF a,r;
 RETURN FOUND;
END $$;
GRANT EXECUTE ON FUNCTION admin.authorize_content(uuid,text) TO tt_content_runtime;
GRANT EXECUTE ON FUNCTION admin.is_public_content_path(text) TO tt_content_runtime;
GRANT SELECT,INSERT ON app.public_page_details,app.redirect_publications TO tt_content_runtime;
GRANT SELECT,INSERT,UPDATE ON admin.seo_page_registry,admin.seo_audit_runs,admin.seo_findings,admin.search_daily_metrics TO tt_content_runtime;
GRANT SELECT ON app.public_pages,app.current_redirects TO tt_content_runtime,tt_public_runtime;
GRANT SELECT ON app.current_public_content,app.public_configuration TO tt_content_runtime;
-- Fixed opaque event shape; the content role cannot read unrelated report/contact outbox records.
CREATE FUNCTION admin.notify_content(page uuid,version integer) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 INSERT INTO app.outbox(event_id,aggregate_kind,aggregate_id,event_type,schema_version,payload)
 SELECT gen_random_uuid(),'seo_page',s.id,'content.index_notification',1,jsonb_build_object('resource_id',s.id::text,'resource_kind','seo_page','version',version)
 FROM admin.seo_page_registry s WHERE s.id=page
$$;
GRANT EXECUTE ON FUNCTION admin.notify_content(uuid,integer) TO tt_content_runtime;
