-- P1-PR-006: immutable presentation references and durable dispatch identities.
-- Schema checks do not authorize dispatch; later services serialize current consent and provider handoff.

INSERT INTO app.code_values(set_code,code,label) VALUES ('asset_purpose','email_payload','Private frozen email payload'),('asset_purpose','webhook_raw','Private encrypted webhook body');

CREATE TABLE email.template_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  template_key text NOT NULL,
  version text NOT NULL,
  locale text NOT NULL,
  purpose text NOT NULL,
  renderer_hash text NOT NULL,
  status text NOT NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT template_versions_pk PRIMARY KEY (id),
  CONSTRAINT template_versions_u1 UNIQUE (template_key,version,locale),
  CONSTRAINT template_versions_template_key_ck CHECK (length(btrim(template_key)) BETWEEN 1 AND 100),
  CONSTRAINT template_versions_version_ck CHECK (length(btrim(version)) BETWEEN 1 AND 100),
  CONSTRAINT template_versions_renderer_hash_ck CHECK (renderer_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT template_versions_purpose_ck CHECK (purpose IN ('report','offers','lifecycle','identity_sharing','analytics','ads','targeted_ads','necessary')),
  CONSTRAINT template_versions_status_ck CHECK (status IN ('draft','reviewed','published','retired')),
  CONSTRAINT template_versions_review_ck CHECK (status NOT IN ('reviewed','published') OR reviewed_at IS NOT NULL),
  CONSTRAINT template_versions_locale_fk FOREIGN KEY (locale) REFERENCES app.locales(code) ON DELETE RESTRICT
);

CREATE INDEX template_versions_locale_idx ON email.template_versions(locale);

CREATE FUNCTION email.guard_template() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF OLD.status IN ('reviewed','published','retired') THEN RAISE EXCEPTION 'Reviewed template is immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER template_versions_immutable BEFORE UPDATE ON email.template_versions FOR EACH ROW EXECUTE FUNCTION email.guard_template();

CREATE TABLE email.education_topic_map (
  rule_version_id uuid NOT NULL,
  reason_code text NOT NULL,
  topic_key text NOT NULL,
  weight numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT education_topic_map_pk PRIMARY KEY (rule_version_id,reason_code,topic_key),
  CONSTRAINT education_topic_map_reason_code_ck CHECK (length(btrim(reason_code)) BETWEEN 1 AND 100),
  CONSTRAINT education_topic_map_topic_key_ck CHECK (length(btrim(topic_key)) BETWEEN 1 AND 100),
  CONSTRAINT education_topic_map_weight_ck CHECK (weight >= 0 AND weight <= 100 AND weight <> 'NaN'::numeric),
  CONSTRAINT education_topic_map_rule_fk FOREIGN KEY (rule_version_id) REFERENCES app.rule_versions(id) ON DELETE RESTRICT
);

CREATE TRIGGER education_topic_map_immutable BEFORE UPDATE ON email.education_topic_map FOR EACH ROW EXECUTE FUNCTION app.reject_history_change();

CREATE TABLE email.email_sends (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  recipient_contact_id uuid,
  owner_subject_id uuid,
  report_id uuid,
  report_version integer,
  comparison_revision bigint,
  template_id uuid NOT NULL,
  dispatch_state text NOT NULL DEFAULT 'scheduled',
  send_after timestamptz NOT NULL,
  cancel_deadline timestamptz NOT NULL,
  claimed_at timestamptz,
  accepted_at timestamptz,
  payload_asset_id uuid,
  payload_hash text,
  provider_key text NOT NULL,
  provider_message_id text,
  provider text NOT NULL,
  expires_at timestamptz,
  anonymized_at timestamptz,
  requested_purposes jsonb NOT NULL,
  notice_id uuid,
  dispatch_policy_version text NOT NULL,
  authorized_consent_revision bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT email_sends_pk PRIMARY KEY (id),
  CONSTRAINT email_sends_u1 UNIQUE (provider_key),
  CONSTRAINT email_sends_u2 UNIQUE (id,provider),
  CONSTRAINT email_sends_kind_ck CHECK (kind IN ('report','confirmation','offers','lifecycle')),
  CONSTRAINT email_sends_state_ck CHECK (dispatch_state IN ('scheduled','cancelled','suppressed','dispatching','accepted','uncertain','failed','manual_review')),
  CONSTRAINT email_sends_report_pair_ck CHECK ((report_id IS NULL)=(report_version IS NULL) AND (comparison_revision IS NULL OR report_id IS NOT NULL)),
  CONSTRAINT email_sends_live_references_ck CHECK (anonymized_at IS NOT NULL OR (recipient_contact_id IS NOT NULL AND (kind <> 'report' OR (report_id IS NOT NULL AND owner_subject_id IS NOT NULL)))),
  CONSTRAINT email_sends_report_owner_ck CHECK (report_id IS NULL OR owner_subject_id IS NOT NULL),
  CONSTRAINT email_sends_erasure_ck CHECK (anonymized_at IS NULL OR (dispatch_state IN ('cancelled','suppressed','accepted','failed','manual_review') AND num_nonnulls(recipient_contact_id,owner_subject_id,report_id,report_version,comparison_revision,payload_asset_id,payload_hash,notice_id,authorized_consent_revision)=0 AND requested_purposes='[]'::jsonb)),
  CONSTRAINT email_sends_payload_pair_ck CHECK ((payload_asset_id IS NULL)=(payload_hash IS NULL)),
  CONSTRAINT email_sends_payload_hash_ck CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT email_sends_provider_key_ck CHECK (length(btrim(provider_key)) BETWEEN 1 AND 200),
  CONSTRAINT email_sends_provider_message_id_ck CHECK (length(btrim(provider_message_id)) BETWEEN 1 AND 200),
  CONSTRAINT email_sends_provider_ck CHECK (length(btrim(provider)) BETWEEN 1 AND 100),
  CONSTRAINT email_sends_dispatch_policy_version_ck CHECK (length(btrim(dispatch_policy_version)) BETWEEN 1 AND 100),
  CONSTRAINT email_sends_purposes_ck CHECK (privacy.valid_purposes(requested_purposes)),
  CONSTRAINT email_sends_permission_ck CHECK (authorized_consent_revision > 0),
  CONSTRAINT email_sends_times_ck CHECK (cancel_deadline >= created_at AND send_after >= cancel_deadline AND (kind <> 'report' OR (cancel_deadline >= created_at + interval '60 seconds' AND send_after=cancel_deadline)) AND (claimed_at IS NULL OR claimed_at >= send_after) AND (accepted_at IS NULL OR (claimed_at IS NOT NULL AND accepted_at >= claimed_at)) AND (expires_at IS NULL OR expires_at > created_at) AND (anonymized_at IS NULL OR anonymized_at >= created_at)),
  CONSTRAINT email_sends_state_times_ck CHECK ((dispatch_state NOT IN ('dispatching','accepted','uncertain','failed','manual_review') OR claimed_at IS NOT NULL) AND (dispatch_state <> 'accepted' OR accepted_at IS NOT NULL) AND (accepted_at IS NULL OR dispatch_state='accepted')),
  CONSTRAINT email_sends_dispatch_payload_ck CHECK (anonymized_at IS NOT NULL OR dispatch_state NOT IN ('dispatching','accepted','uncertain','manual_review') OR payload_asset_id IS NOT NULL),
  CONSTRAINT email_sends_revision_ck CHECK (revision > 0),
  CONSTRAINT email_sends_updated_ck CHECK (updated_at >= created_at),
  CONSTRAINT email_sends_recipient_fk FOREIGN KEY (recipient_contact_id) REFERENCES privacy.contacts(id) ON DELETE RESTRICT,
  CONSTRAINT email_sends_owner_fk FOREIGN KEY (owner_subject_id) REFERENCES app.subjects(id) ON DELETE RESTRICT,
  CONSTRAINT email_sends_report_owner_fk FOREIGN KEY (report_id,owner_subject_id) REFERENCES app.reports(id,owner_subject_id) ON DELETE RESTRICT,
  CONSTRAINT email_sends_version_fk FOREIGN KEY (report_id,report_version) REFERENCES app.report_versions(report_id,version) ON DELETE RESTRICT,
  CONSTRAINT email_sends_comparison_fk FOREIGN KEY (report_id,report_version,comparison_revision) REFERENCES app.comparisons(report_id,report_version,revision) ON DELETE RESTRICT,
  CONSTRAINT email_sends_template_fk FOREIGN KEY (template_id) REFERENCES email.template_versions(id) ON DELETE RESTRICT,
  CONSTRAINT email_sends_payload_fk FOREIGN KEY (payload_asset_id) REFERENCES app.object_assets(id) ON DELETE RESTRICT,
  CONSTRAINT email_sends_notice_fk FOREIGN KEY (notice_id) REFERENCES privacy.notices(id) ON DELETE RESTRICT
);

CREATE INDEX email_sends_recipient_idx ON email.email_sends(recipient_contact_id);

CREATE INDEX email_sends_owner_idx ON email.email_sends(owner_subject_id);

CREATE INDEX email_sends_report_owner_idx ON email.email_sends(report_id,owner_subject_id);

CREATE INDEX email_sends_version_idx ON email.email_sends(report_id,report_version);

CREATE INDEX email_sends_comparison_idx ON email.email_sends(report_id,report_version,comparison_revision);

CREATE INDEX email_sends_template_idx ON email.email_sends(template_id);

CREATE INDEX email_sends_payload_idx ON email.email_sends(payload_asset_id);

CREATE INDEX email_sends_notice_idx ON email.email_sends(notice_id);

CREATE INDEX email_sends_due_idx ON email.email_sends(send_after,id) WHERE dispatch_state='scheduled';

CREATE INDEX email_sends_uncertain_idx ON email.email_sends(updated_at,id) WHERE dispatch_state IN ('uncertain','manual_review');

CREATE INDEX email_sends_expiry_idx ON email.email_sends(expires_at,id) WHERE expires_at IS NOT NULL;

CREATE UNIQUE INDEX email_sends_provider_message_uq ON email.email_sends(provider,provider_message_id) WHERE provider_message_id IS NOT NULL;

CREATE FUNCTION email.guard_send_identity() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF ROW(OLD.kind,OLD.provider,OLD.provider_key,OLD.template_id,OLD.send_after,OLD.cancel_deadline)
     IS DISTINCT FROM ROW(NEW.kind,NEW.provider,NEW.provider_key,NEW.template_id,NEW.send_after,NEW.cancel_deadline) THEN
    RAISE EXCEPTION 'Send identity and presentation are fixed' USING ERRCODE='23514';
  END IF;
  IF OLD.anonymized_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Erased send cannot be revived' USING ERRCODE='23514';
  END IF;
  IF NEW.anonymized_at IS NULL AND ROW(OLD.recipient_contact_id,OLD.owner_subject_id,OLD.report_id,OLD.report_version,OLD.comparison_revision)
     IS DISTINCT FROM ROW(NEW.recipient_contact_id,NEW.owner_subject_id,NEW.report_id,NEW.report_version,NEW.comparison_revision) THEN
    RAISE EXCEPTION 'Delivery references are fixed' USING ERRCODE='23514';
  END IF;
  IF NEW.anonymized_at IS NULL AND OLD.dispatch_state IN ('dispatching','accepted','uncertain','manual_review')
     AND ROW(OLD.payload_asset_id,OLD.payload_hash) IS DISTINCT FROM ROW(NEW.payload_asset_id,NEW.payload_hash) THEN
    RAISE EXCEPTION 'Attempted payload is frozen' USING ERRCODE='23514';
  END IF;
  IF OLD.dispatch_state IS DISTINCT FROM NEW.dispatch_state AND NOT (
    (OLD.dispatch_state='scheduled' AND NEW.dispatch_state IN ('cancelled','suppressed','dispatching')) OR
    (OLD.dispatch_state='dispatching' AND NEW.dispatch_state IN ('accepted','uncertain','failed','suppressed')) OR
    (OLD.dispatch_state='uncertain' AND NEW.dispatch_state IN ('dispatching','accepted','manual_review','failed'))
  ) THEN RAISE EXCEPTION 'Invalid dispatch transition' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER email_sends_identity BEFORE UPDATE ON email.email_sends FOR EACH ROW EXECUTE FUNCTION email.guard_send_identity();

CREATE TABLE email.send_attempts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  send_id uuid NOT NULL,
  attempt_no integer NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  outcome text NOT NULL,
  provider_request_id text,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT send_attempts_pk PRIMARY KEY (id),
  CONSTRAINT send_attempts_u1 UNIQUE (send_id,attempt_no),
  CONSTRAINT send_attempts_attempt_ck CHECK (attempt_no BETWEEN 1 AND 1000),
  CONSTRAINT send_attempts_outcome_ck CHECK (outcome IN ('in_progress','accepted','definitive_rejection','uncertain')),
  CONSTRAINT send_attempts_finished_ck CHECK ((outcome='in_progress')=(finished_at IS NULL) AND (finished_at IS NULL OR finished_at >= started_at)),
  CONSTRAINT send_attempts_provider_request_id_ck CHECK (length(btrim(provider_request_id)) BETWEEN 1 AND 200),
  CONSTRAINT send_attempts_error_code_ck CHECK (length(btrim(error_code)) BETWEEN 1 AND 100),
  CONSTRAINT send_attempts_send_fk FOREIGN KEY (send_id) REFERENCES email.email_sends(id) ON DELETE RESTRICT
);

CREATE INDEX send_attempts_unfinished_idx ON email.send_attempts(started_at,id) WHERE finished_at IS NULL;

-- Receipt send_id is a logical identity, intentionally not an FK: protected dedupe can survive send erasure.

CREATE TABLE email.send_receipts (
  send_id uuid NOT NULL,
  provider text NOT NULL,
  provider_key_digest bytea NOT NULL,
  payload_digest bytea,
  outcome text NOT NULL,
  last_reconciled_at timestamptz NOT NULL,
  retain_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT send_receipts_pk PRIMARY KEY (send_id),
  CONSTRAINT send_receipts_u1 UNIQUE (provider,provider_key_digest),
  CONSTRAINT send_receipts_provider_ck CHECK (length(btrim(provider)) BETWEEN 1 AND 100),
  CONSTRAINT send_receipts_provider_key_digest_ck CHECK (octet_length(provider_key_digest)=32),
  CONSTRAINT send_receipts_payload_digest_ck CHECK (octet_length(payload_digest)=32),
  CONSTRAINT send_receipts_outcome_ck CHECK (outcome IN ('accepted','definitive_rejection','uncertain','cancelled','suppressed','manual_review')),
  CONSTRAINT send_receipts_retention_ck CHECK (retain_until IS NULL OR retain_until > created_at),
  CONSTRAINT send_receipts_revision_ck CHECK (revision > 0),
  CONSTRAINT send_receipts_updated_ck CHECK (updated_at >= created_at)
);

CREATE INDEX send_receipts_retention_idx ON email.send_receipts(retain_until,send_id) WHERE retain_until IS NOT NULL;

CREATE TABLE email.email_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  send_id uuid,
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  classification text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_events_pk PRIMARY KEY (id),
  CONSTRAINT email_events_u1 UNIQUE (provider,provider_event_id),
  CONSTRAINT email_events_provider_ck CHECK (length(btrim(provider)) BETWEEN 1 AND 100),
  CONSTRAINT email_events_provider_event_id_ck CHECK (length(btrim(provider_event_id)) BETWEEN 1 AND 200),
  CONSTRAINT email_events_type_ck CHECK (type IN ('delivered','delayed','bounced','complained','opened','clicked')),
  CONSTRAINT email_events_classification_ck CHECK (classification IS NULL OR classification IN ('unknown','machine','suspected_human','hard','soft')),
  CONSTRAINT email_events_send_provider_fk FOREIGN KEY (send_id,provider) REFERENCES email.email_sends(id,provider) ON DELETE RESTRICT
);

CREATE INDEX email_events_send_provider_idx ON email.email_events(send_id,provider);

CREATE INDEX email_events_history_idx ON email.email_events(send_id,occurred_at,id);

CREATE INDEX email_events_retention_idx ON email.email_events(received_at,id);

CREATE TABLE email.email_links (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  send_id uuid NOT NULL,
  slot text NOT NULL,
  purpose text NOT NULL,
  approved_destination text NOT NULL,
  token_hash bytea NOT NULL,
  key_version text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT email_links_pk PRIMARY KEY (id),
  CONSTRAINT email_links_u1 UNIQUE (key_version,token_hash),
  CONSTRAINT email_links_u2 UNIQUE (send_id,slot),
  CONSTRAINT email_links_digest_ck CHECK (octet_length(token_hash)=32),
  CONSTRAINT email_links_key_version_ck CHECK (length(btrim(key_version)) BETWEEN 1 AND 100),
  CONSTRAINT email_links_lifetime_ck CHECK (expires_at > created_at AND (revoked_at IS NULL OR revoked_at >= created_at)),
  CONSTRAINT email_links_slot_ck CHECK (length(btrim(slot)) BETWEEN 1 AND 100),
  CONSTRAINT email_links_purpose_ck CHECK (purpose IN ('education','report_view','pdf','confirmation','preferences','unsubscribe','feedback')),
  CONSTRAINT email_links_destination_ck CHECK (approved_destination ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[^[:space:]]*)?$' AND approved_destination !~ '[\\]' AND length(approved_destination) <= 2048),
  CONSTRAINT email_links_revision_ck CHECK (revision > 0),
  CONSTRAINT email_links_updated_ck CHECK (updated_at >= created_at),
  CONSTRAINT email_links_send_fk FOREIGN KEY (send_id) REFERENCES email.email_sends(id) ON DELETE RESTRICT
);

CREATE INDEX email_links_expiry_idx ON email.email_links(expires_at,id);

CREATE TABLE email.email_feedback (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  send_id uuid NOT NULL,
  kind text NOT NULL,
  value text NOT NULL,
  submitted_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_feedback_pk PRIMARY KEY (id),
  CONSTRAINT email_feedback_u1 UNIQUE (send_id,kind),
  CONSTRAINT email_feedback_kind_ck CHECK (kind='helpful'),
  CONSTRAINT email_feedback_value_ck CHECK (value IN ('yes','no')),
  CONSTRAINT email_feedback_send_fk FOREIGN KEY (send_id) REFERENCES email.email_sends(id) ON DELETE RESTRICT
);

CREATE TRIGGER email_feedback_immutable BEFORE UPDATE ON email.email_feedback FOR EACH ROW EXECUTE FUNCTION app.reject_history_change();
