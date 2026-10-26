CREATE TABLE email.delivery_snapshots (
 send_id uuid PRIMARY KEY REFERENCES email.email_sends(id) ON DELETE RESTRICT,
 verification_id uuid NOT NULL REFERENCES privacy.contact_intents(challenge_id) ON DELETE RESTRICT,
 offers_verification_id uuid REFERENCES privacy.contact_intents(challenge_id) ON DELETE RESTRICT,
 permission_event_id uuid NOT NULL REFERENCES privacy.consent_events(id) ON DELETE RESTRICT,
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text)<=524288),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX delivery_snapshots_verification_idx ON email.delivery_snapshots(verification_id);
CREATE INDEX delivery_snapshots_offers_idx ON email.delivery_snapshots(offers_verification_id);
CREATE INDEX delivery_snapshots_permission_idx ON email.delivery_snapshots(permission_event_id);
CREATE TRIGGER delivery_snapshots_immutable BEFORE UPDATE ON email.delivery_snapshots FOR EACH ROW EXECUTE FUNCTION app.reject_history_change();
CREATE TABLE email.delivery_work (
 send_id uuid PRIMARY KEY REFERENCES email.email_sends(id) ON DELETE RESTRICT,
 lease_token uuid, lease_generation bigint NOT NULL DEFAULT 0 CHECK(lease_generation>=0), lease_until timestamptz,
 next_attempt_at timestamptz NOT NULL,
 failures integer NOT NULL DEFAULT 0 CHECK(failures BETWEEN 0 AND 1000),
 first_attempt_at timestamptz,
 payload_asset_id uuid REFERENCES app.object_assets(id) ON DELETE RESTRICT,
 pdf_asset_id uuid REFERENCES app.object_assets(id) ON DELETE RESTRICT,
 payload_hash text CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
 last_error text CHECK(last_error IN ('deferred','permission_denied','retry_exhausted','render_unavailable','payload_unavailable')),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((lease_token IS NULL)=(lease_until IS NULL)),
 CHECK((payload_asset_id IS NULL)=(payload_hash IS NULL) AND (payload_asset_id IS NULL)=(pdf_asset_id IS NULL))
);
CREATE INDEX delivery_work_due_idx ON email.delivery_work(next_attempt_at,send_id);
CREATE INDEX delivery_work_lease_idx ON email.delivery_work(lease_until,send_id) WHERE lease_until IS NOT NULL;
CREATE INDEX delivery_work_payload_idx ON email.delivery_work(payload_asset_id);
CREATE INDEX delivery_work_pdf_idx ON email.delivery_work(pdf_asset_id);
CREATE FUNCTION email.guard_delivery_work() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF OLD.send_id IS DISTINCT FROM NEW.send_id OR
 (OLD.payload_asset_id IS NOT NULL AND ROW(OLD.payload_asset_id,OLD.pdf_asset_id,OLD.payload_hash) IS DISTINCT FROM ROW(NEW.payload_asset_id,NEW.pdf_asset_id,NEW.payload_hash)) OR
 (OLD.first_attempt_at IS NOT NULL AND OLD.first_attempt_at IS DISTINCT FROM NEW.first_attempt_at)
 THEN RAISE EXCEPTION 'Delivery identity and attempted bytes are fixed' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER delivery_work_identity BEFORE UPDATE ON email.delivery_work FOR EACH ROW EXECUTE FUNCTION email.guard_delivery_work();
GRANT SELECT,INSERT ON email.delivery_snapshots TO tt_private_runtime;
GRANT SELECT,INSERT,UPDATE ON email.delivery_work TO tt_private_runtime;
GRANT SELECT ON app.public_pages TO tt_private_runtime;
GRANT SELECT ON email.education_topic_map TO tt_private_runtime;
