-- Opt-in disposable validation track only; preserves all earlier migration checksums.
CREATE FUNCTION app.ai_guard_reservation_purge() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF OLD.state IN ('reserved','uncertain') THEN
  RAISE EXCEPTION 'Unresolved AI cost hold must reconcile before purge' USING ERRCODE='23514';
 END IF;
 -- Terminal purge retains the budget window's historical spent total.
 RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION app.ai_guard_reservation_purge() FROM PUBLIC;
CREATE TRIGGER ai_reservation_purge BEFORE DELETE ON app.ai_budget_reservations
 FOR EACH ROW EXECUTE FUNCTION app.ai_guard_reservation_purge();
-- Subject erasure must not scan all photo claims to find an owner's children.
CREATE INDEX photo_claim_owner_idx ON app.photo_asset_claims(owner_subject_id,upload_id,asset_id);
