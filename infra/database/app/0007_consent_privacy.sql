-- P1-PR-006: encrypted privacy records, evidence and erasable identity mappings.
-- Cryptographic envelope encoding/verification and current permission decisions belong to later adapters/services.

CREATE TABLE privacy.report_private_data (
  report_id uuid NOT NULL,
  encrypted_fields bytea NOT NULL,
  key_version text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT report_private_data_pk PRIMARY KEY (report_id),
  CONSTRAINT report_private_data_encrypted_fields_ck CHECK (octet_length(encrypted_fields) BETWEEN 16 AND 65536),
  CONSTRAINT report_private_data_key_version_ck CHECK (length(btrim(key_version)) BETWEEN 1 AND 100),
  CONSTRAINT report_private_data_lifetime_ck CHECK (expires_at > created_at),
  CONSTRAINT report_private_data_revision_ck CHECK (revision > 0),
  CONSTRAINT report_private_data_updated_ck CHECK (updated_at >= created_at),
  CONSTRAINT report_private_data_parent_fk FOREIGN KEY (report_id) REFERENCES app.reports(id) ON DELETE RESTRICT
);

CREATE INDEX report_private_data_expiry_idx ON privacy.report_private_data(expires_at,report_id);

CREATE TABLE privacy.quote_private_data (
  quote_id uuid NOT NULL,
  encrypted_notes bytea NOT NULL,
  key_version text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT quote_private_data_pk PRIMARY KEY (quote_id),
  CONSTRAINT quote_private_data_encrypted_notes_ck CHECK (octet_length(encrypted_notes) BETWEEN 16 AND 65536),
  CONSTRAINT quote_private_data_key_version_ck CHECK (length(btrim(key_version)) BETWEEN 1 AND 100),
  CONSTRAINT quote_private_data_lifetime_ck CHECK (expires_at > created_at),
  CONSTRAINT quote_private_data_revision_ck CHECK (revision > 0),
  CONSTRAINT quote_private_data_updated_ck CHECK (updated_at >= created_at),
  CONSTRAINT quote_private_data_parent_fk FOREIGN KEY (quote_id) REFERENCES app.shop_quotes(id) ON DELETE RESTRICT
);

CREATE INDEX quote_private_data_expiry_idx ON privacy.quote_private_data(expires_at,quote_id);

CREATE TABLE privacy.contacts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL,
  encrypted_email bytea NOT NULL,
  key_version text NOT NULL,
  verified_at timestamptz,
  status text NOT NULL,
  last_purpose_activity_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT contacts_pk PRIMARY KEY (id),
  CONSTRAINT contacts_u1 UNIQUE (subject_id),
  CONSTRAINT contacts_encrypted_email_ck CHECK (octet_length(encrypted_email) BETWEEN 16 AND 65536),
  CONSTRAINT contacts_key_version_ck CHECK (length(btrim(key_version)) BETWEEN 1 AND 100),
  CONSTRAINT contacts_status_ck CHECK (status IN ('active','restricted','pending_deletion')),
  CONSTRAINT contacts_times_ck CHECK (last_purpose_activity_at >= created_at AND (verified_at IS NULL OR verified_at >= created_at)),
  CONSTRAINT contacts_revision_ck CHECK (revision > 0),
  CONSTRAINT contacts_updated_ck CHECK (updated_at >= created_at),
  CONSTRAINT contacts_subject_fk FOREIGN KEY (subject_id) REFERENCES app.subjects(id) ON DELETE RESTRICT
);

CREATE INDEX contacts_inactivity_idx ON privacy.contacts(last_purpose_activity_at,id);

CREATE TABLE privacy.contact_lookups (
  key_version text NOT NULL,
  email_hmac bytea NOT NULL,
  contact_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_lookups_pk PRIMARY KEY (key_version,email_hmac),
  CONSTRAINT contact_lookups_u1 UNIQUE (contact_id,key_version),
  CONSTRAINT contact_lookups_key_version_ck CHECK (length(btrim(key_version)) BETWEEN 1 AND 100),
  CONSTRAINT contact_lookups_email_hmac_ck CHECK (octet_length(email_hmac)=32),
  CONSTRAINT contact_lookups_contact_fk FOREIGN KEY (contact_id) REFERENCES privacy.contacts(id) ON DELETE RESTRICT
);

CREATE TABLE privacy.notices (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  purpose text NOT NULL,
  market_policy text NOT NULL,
  version text NOT NULL,
  content_hash text NOT NULL,
  published_at timestamptz NOT NULL,
  content_ref text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notices_pk PRIMARY KEY (id),
  CONSTRAINT notices_u1 UNIQUE (purpose,market_policy,version),
  CONSTRAINT notices_u2 UNIQUE (id,purpose),
  CONSTRAINT notices_purpose_ck CHECK (purpose IN ('report','offers','lifecycle','identity_sharing','analytics','ads','targeted_ads','necessary')),
  CONSTRAINT notices_market_policy_ck CHECK (length(btrim(market_policy)) BETWEEN 1 AND 100),
  CONSTRAINT notices_version_ck CHECK (length(btrim(version)) BETWEEN 1 AND 100),
  CONSTRAINT notices_content_hash_ck CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT notices_content_ref_ck CHECK (length(btrim(content_ref)) BETWEEN 1 AND 500)
);

CREATE TRIGGER notices_immutable BEFORE UPDATE ON privacy.notices FOR EACH ROW EXECUTE FUNCTION app.reject_history_change();

CREATE TABLE privacy.consent_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  purpose text NOT NULL,
  action text NOT NULL,
  notice_id uuid NOT NULL,
  policy_version text NOT NULL,
  scope_key text NOT NULL,
  occurred_at timestamptz NOT NULL,
  method text NOT NULL,
  evidence_digest text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consent_events_pk PRIMARY KEY (id),
  CONSTRAINT consent_events_u1 UNIQUE (id,purpose,scope_key),
  CONSTRAINT consent_events_purpose_ck CHECK (purpose IN ('report','offers','lifecycle','identity_sharing','analytics','ads','targeted_ads','necessary')),
  CONSTRAINT consent_events_action_ck CHECK (action IN ('grant','confirm','withdraw','expire')),
  CONSTRAINT consent_events_policy_version_ck CHECK (length(btrim(policy_version)) BETWEEN 1 AND 100),
  CONSTRAINT consent_events_scope_key_ck CHECK (length(btrim(scope_key)) BETWEEN 1 AND 200),
  CONSTRAINT consent_events_method_ck CHECK (length(btrim(method)) BETWEEN 1 AND 100),
  CONSTRAINT consent_events_evidence_digest_ck CHECK (evidence_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT consent_events_notice_fk FOREIGN KEY (notice_id,purpose) REFERENCES privacy.notices(id,purpose) ON DELETE RESTRICT
);

CREATE INDEX consent_events_notice_idx ON privacy.consent_events(notice_id,purpose);

CREATE INDEX consent_events_occurred_idx ON privacy.consent_events(occurred_at,id);

CREATE TRIGGER consent_events_immutable BEFORE UPDATE ON privacy.consent_events FOR EACH ROW EXECUTE FUNCTION app.reject_history_change();

CREATE TABLE privacy.subject_links (
  event_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subject_links_pk PRIMARY KEY (event_id),
  CONSTRAINT subject_links_u1 UNIQUE (event_id,subject_id),
  CONSTRAINT subject_links_event_fk FOREIGN KEY (event_id) REFERENCES privacy.consent_events(id) ON DELETE RESTRICT,
  CONSTRAINT subject_links_subject_fk FOREIGN KEY (subject_id) REFERENCES app.subjects(id) ON DELETE RESTRICT
);

CREATE INDEX subject_links_subject_idx ON privacy.subject_links(subject_id);

CREATE INDEX subject_links_subject_event_idx ON privacy.subject_links(subject_id,event_id);

CREATE TABLE privacy.consent_state (
  subject_id uuid NOT NULL,
  purpose text NOT NULL,
  scope_key text NOT NULL,
  status text NOT NULL,
  source_event_id uuid NOT NULL,
  effective_at timestamptz NOT NULL,
  expires_at timestamptz,
  policy_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT consent_state_pk PRIMARY KEY (subject_id,purpose,scope_key),
  CONSTRAINT consent_state_status_ck CHECK (status IN ('pending','confirmed','withdrawn','expired')),
  CONSTRAINT consent_state_policy_version_ck CHECK (length(btrim(policy_version)) BETWEEN 1 AND 100),
  CONSTRAINT consent_state_lifetime_ck CHECK (expires_at IS NULL OR expires_at > effective_at),
  CONSTRAINT consent_state_revision_ck CHECK (revision > 0),
  CONSTRAINT consent_state_updated_ck CHECK (updated_at >= created_at),
  CONSTRAINT consent_state_subject_fk FOREIGN KEY (subject_id) REFERENCES app.subjects(id) ON DELETE RESTRICT,
  CONSTRAINT consent_state_event_scope_fk FOREIGN KEY (source_event_id,purpose,scope_key) REFERENCES privacy.consent_events(id,purpose,scope_key) ON DELETE RESTRICT,
  CONSTRAINT consent_state_event_subject_fk FOREIGN KEY (source_event_id,subject_id) REFERENCES privacy.subject_links(event_id,subject_id) ON DELETE RESTRICT
);

CREATE INDEX consent_state_event_scope_idx ON privacy.consent_state(source_event_id,purpose,scope_key);

CREATE INDEX consent_state_event_subject_idx ON privacy.consent_state(source_event_id,subject_id);

CREATE INDEX consent_state_expiry_idx ON privacy.consent_state(expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE privacy.verification_challenges (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL,
  purpose text NOT NULL,
  token_hash bytea NOT NULL,
  key_version text NOT NULL,
  notice_id uuid,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  invalidated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT verification_challenges_pk PRIMARY KEY (id),
  CONSTRAINT verification_challenges_u1 UNIQUE (key_version,token_hash),
  CONSTRAINT verification_challenges_purpose_ck CHECK (purpose IN ('report','offers','lifecycle','identity_sharing','analytics','ads','targeted_ads','necessary')),
  CONSTRAINT verification_challenges_token_hash_ck CHECK (octet_length(token_hash)=32),
  CONSTRAINT verification_challenges_key_version_ck CHECK (length(btrim(key_version)) BETWEEN 1 AND 100),
  CONSTRAINT verification_challenges_lifetime_ck CHECK (expires_at > created_at AND expires_at <= created_at + interval '7 days' AND (used_at IS NULL OR used_at BETWEEN created_at AND expires_at) AND (invalidated_at IS NULL OR invalidated_at >= created_at)),
  CONSTRAINT verification_challenges_revision_ck CHECK (revision > 0),
  CONSTRAINT verification_challenges_updated_ck CHECK (updated_at >= created_at),
  CONSTRAINT verification_challenges_subject_fk FOREIGN KEY (subject_id) REFERENCES app.subjects(id) ON DELETE RESTRICT,
  CONSTRAINT verification_challenges_notice_fk FOREIGN KEY (notice_id,purpose) REFERENCES privacy.notices(id,purpose) ON DELETE RESTRICT
);

CREATE INDEX verification_challenges_subject_idx ON privacy.verification_challenges(subject_id);

CREATE INDEX verification_challenges_notice_idx ON privacy.verification_challenges(notice_id,purpose);

CREATE INDEX verification_challenges_expiry_idx ON privacy.verification_challenges(expires_at,id);

CREATE TABLE privacy.suppressions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  subject_id uuid,
  scope_key text NOT NULL,
  reason_code text NOT NULL,
  effective_at timestamptz NOT NULL,
  expires_at timestamptz,
  source_event_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT suppressions_pk PRIMARY KEY (id),
  CONSTRAINT suppressions_scope_key_ck CHECK (length(btrim(scope_key)) BETWEEN 1 AND 200),
  CONSTRAINT suppressions_reason_code_ck CHECK (length(btrim(reason_code)) BETWEEN 1 AND 100),
  CONSTRAINT suppressions_lifetime_ck CHECK (expires_at IS NULL OR expires_at > effective_at),
  CONSTRAINT suppressions_revision_ck CHECK (revision > 0),
  CONSTRAINT suppressions_updated_ck CHECK (updated_at >= created_at),
  CONSTRAINT suppressions_subject_fk FOREIGN KEY (subject_id) REFERENCES app.subjects(id) ON DELETE RESTRICT,
  CONSTRAINT suppressions_event_fk FOREIGN KEY (source_event_id) REFERENCES privacy.consent_events(id) ON DELETE RESTRICT
);

CREATE INDEX suppressions_subject_idx ON privacy.suppressions(subject_id);

CREATE INDEX suppressions_event_idx ON privacy.suppressions(source_event_id);

CREATE INDEX suppressions_scope_idx ON privacy.suppressions(subject_id,scope_key);

CREATE INDEX suppressions_expiry_idx ON privacy.suppressions(expires_at,id) WHERE expires_at IS NOT NULL;

CREATE TABLE privacy.suppression_tombstones (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  key_version text NOT NULL,
  lookup_hmac bytea NOT NULL,
  scope_key text NOT NULL,
  reason_code text NOT NULL,
  effective_at timestamptz NOT NULL,
  review_after timestamptz NOT NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT suppression_tombstones_pk PRIMARY KEY (id),
  CONSTRAINT suppression_tombstones_u1 UNIQUE (key_version,lookup_hmac,scope_key),
  CONSTRAINT suppression_tombstones_key_version_ck CHECK (length(btrim(key_version)) BETWEEN 1 AND 100),
  CONSTRAINT suppression_tombstones_lookup_hmac_ck CHECK (octet_length(lookup_hmac)=32),
  CONSTRAINT suppression_tombstones_scope_key_ck CHECK (length(btrim(scope_key)) BETWEEN 1 AND 200),
  CONSTRAINT suppression_tombstones_reason_code_ck CHECK (length(btrim(reason_code)) BETWEEN 1 AND 100),
  CONSTRAINT suppression_tombstones_times_ck CHECK (review_after > effective_at AND (expires_at IS NULL OR expires_at > effective_at)),
  CONSTRAINT suppression_tombstones_revision_ck CHECK (revision > 0),
  CONSTRAINT suppression_tombstones_updated_ck CHECK (updated_at >= created_at)
);

CREATE INDEX suppression_tombstones_review_idx ON privacy.suppression_tombstones(review_after,id);

CREATE INDEX suppression_tombstones_expiry_idx ON privacy.suppression_tombstones(expires_at,id) WHERE expires_at IS NOT NULL;

CREATE FUNCTION privacy.valid_purposes(value jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog AS $$
 SELECT CASE WHEN jsonb_typeof(value)='array' THEN jsonb_array_length(value)<=8 AND NOT jsonb_path_exists(value, '$[*] ? (@.type() != "string")') AND value <@ '["report","offers","lifecycle","identity_sharing","analytics","ads","targeted_ads","necessary"]'::jsonb ELSE false END
$$;

CREATE TABLE privacy.cookie_consents (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL,
  notice_id uuid NOT NULL,
  policy_version text NOT NULL,
  gpc boolean NOT NULL,
  allowed_purposes jsonb NOT NULL,
  receipt_digest text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT cookie_consents_pk PRIMARY KEY (id),
  CONSTRAINT cookie_consents_policy_version_ck CHECK (length(btrim(policy_version)) BETWEEN 1 AND 100),
  CONSTRAINT cookie_consents_receipt_digest_ck CHECK (receipt_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT cookie_consents_purposes_ck CHECK (privacy.valid_purposes(allowed_purposes) AND (NOT gpc OR NOT (allowed_purposes ?| ARRAY['identity_sharing','targeted_ads']))),
  CONSTRAINT cookie_consents_lifetime_ck CHECK (expires_at > created_at),
  CONSTRAINT cookie_consents_revision_ck CHECK (revision > 0),
  CONSTRAINT cookie_consents_updated_ck CHECK (updated_at >= created_at),
  CONSTRAINT cookie_consents_subject_fk FOREIGN KEY (subject_id) REFERENCES app.subjects(id) ON DELETE RESTRICT,
  CONSTRAINT cookie_consents_notice_fk FOREIGN KEY (notice_id) REFERENCES privacy.notices(id) ON DELETE RESTRICT
);

CREATE INDEX cookie_consents_subject_idx ON privacy.cookie_consents(subject_id);

CREATE INDEX cookie_consents_notice_idx ON privacy.cookie_consents(notice_id);

CREATE INDEX cookie_consents_expiry_idx ON privacy.cookie_consents(expires_at,id);

CREATE TABLE privacy.cookie_registry (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  vendor_code text NOT NULL,
  cookie_key text NOT NULL,
  purpose text NOT NULL,
  policy_version text NOT NULL,
  ttl_seconds integer NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT cookie_registry_pk PRIMARY KEY (id),
  CONSTRAINT cookie_registry_u1 UNIQUE (vendor_code,cookie_key,policy_version),
  CONSTRAINT cookie_registry_vendor_code_ck CHECK (length(btrim(vendor_code)) BETWEEN 1 AND 100),
  CONSTRAINT cookie_registry_cookie_key_ck CHECK (length(btrim(cookie_key)) BETWEEN 1 AND 200),
  CONSTRAINT cookie_registry_policy_version_ck CHECK (length(btrim(policy_version)) BETWEEN 1 AND 100),
  CONSTRAINT cookie_registry_purpose_ck CHECK (purpose IN ('report','offers','lifecycle','identity_sharing','analytics','ads','targeted_ads','necessary')),
  CONSTRAINT cookie_registry_ttl_ck CHECK (ttl_seconds BETWEEN 0 AND 63072000),
  CONSTRAINT cookie_registry_status_ck CHECK (status IN ('draft','reviewed','disabled')),
  CONSTRAINT cookie_registry_revision_ck CHECK (revision > 0),
  CONSTRAINT cookie_registry_updated_ck CHECK (updated_at >= created_at)
);

CREATE TABLE privacy.privacy_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  subject_id uuid,
  kind text NOT NULL,
  jurisdiction text NOT NULL,
  policy_version text NOT NULL,
  status text NOT NULL,
  verified_at timestamptz,
  due_at timestamptz NOT NULL,
  completed_at timestamptz,
  encrypted_reply_context bytea,
  key_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT privacy_requests_pk PRIMARY KEY (id),
  CONSTRAINT privacy_requests_kind_ck CHECK (kind IN ('access','delete','correct','restrict','opt_out','export')),
  CONSTRAINT privacy_requests_jurisdiction_ck CHECK (length(btrim(jurisdiction)) BETWEEN 1 AND 100),
  CONSTRAINT privacy_requests_policy_version_ck CHECK (length(btrim(policy_version)) BETWEEN 1 AND 100),
  CONSTRAINT privacy_requests_status_ck CHECK (status IN ('pending','verified','processing','completed','rejected','manual_review')),
  CONSTRAINT privacy_requests_completion_ck CHECK ((status='completed')=(completed_at IS NOT NULL)),
  CONSTRAINT privacy_requests_envelope_ck CHECK ((encrypted_reply_context IS NULL)=(key_version IS NULL) AND (encrypted_reply_context IS NULL OR octet_length(encrypted_reply_context) BETWEEN 16 AND 65536)),
  CONSTRAINT privacy_requests_key_version_ck CHECK (length(btrim(key_version)) BETWEEN 1 AND 100),
  CONSTRAINT privacy_requests_times_ck CHECK (due_at >= created_at AND (verified_at IS NULL OR verified_at >= created_at) AND (completed_at IS NULL OR completed_at >= created_at)),
  CONSTRAINT privacy_requests_revision_ck CHECK (revision > 0),
  CONSTRAINT privacy_requests_updated_ck CHECK (updated_at >= created_at),
  CONSTRAINT privacy_requests_subject_fk FOREIGN KEY (subject_id) REFERENCES app.subjects(id) ON DELETE RESTRICT
);

CREATE INDEX privacy_requests_subject_idx ON privacy.privacy_requests(subject_id);

CREATE INDEX privacy_requests_due_idx ON privacy.privacy_requests(status,due_at,id);

CREATE TABLE privacy.fulfillment_steps (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  store text NOT NULL,
  action text NOT NULL,
  status text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  evidence_digest text,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT fulfillment_steps_pk PRIMARY KEY (id),
  CONSTRAINT fulfillment_steps_u1 UNIQUE (request_id,store,action),
  CONSTRAINT fulfillment_steps_store_ck CHECK (length(btrim(store)) BETWEEN 1 AND 100),
  CONSTRAINT fulfillment_steps_action_ck CHECK (length(btrim(action)) BETWEEN 1 AND 100),
  CONSTRAINT fulfillment_steps_status_ck CHECK (status IN ('pending','running','completed','exempted','failed','manual_review')),
  CONSTRAINT fulfillment_steps_attempts_ck CHECK (attempts BETWEEN 0 AND 1000),
  CONSTRAINT fulfillment_steps_evidence_digest_ck CHECK (evidence_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT fulfillment_steps_last_error_code_ck CHECK (length(btrim(last_error_code)) BETWEEN 1 AND 100),
  CONSTRAINT fulfillment_steps_revision_ck CHECK (revision > 0),
  CONSTRAINT fulfillment_steps_updated_ck CHECK (updated_at >= created_at),
  CONSTRAINT fulfillment_steps_request_fk FOREIGN KEY (request_id) REFERENCES privacy.privacy_requests(id) ON DELETE RESTRICT
);

CREATE INDEX fulfillment_steps_pending_idx ON privacy.fulfillment_steps(next_attempt_at,id) WHERE status IN ('pending','failed');

CREATE TABLE privacy.deletion_markers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  resource_kind text NOT NULL,
  resource_key_hmac bytea NOT NULL,
  key_version text NOT NULL,
  deleted_at timestamptz NOT NULL,
  policy_version text NOT NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deletion_markers_pk PRIMARY KEY (id),
  CONSTRAINT deletion_markers_u1 UNIQUE (resource_kind,key_version,resource_key_hmac),
  CONSTRAINT deletion_markers_resource_kind_ck CHECK (length(btrim(resource_kind)) BETWEEN 1 AND 100),
  CONSTRAINT deletion_markers_resource_key_hmac_ck CHECK (octet_length(resource_key_hmac)=32),
  CONSTRAINT deletion_markers_key_version_ck CHECK (length(btrim(key_version)) BETWEEN 1 AND 100),
  CONSTRAINT deletion_markers_policy_version_ck CHECK (length(btrim(policy_version)) BETWEEN 1 AND 100),
  CONSTRAINT deletion_markers_lifetime_ck CHECK (expires_at IS NULL OR expires_at > deleted_at)
);

CREATE INDEX deletion_markers_expiry_idx ON privacy.deletion_markers(expires_at,id) WHERE expires_at IS NOT NULL;

CREATE TRIGGER deletion_markers_immutable BEFORE UPDATE ON privacy.deletion_markers FOR EACH ROW EXECUTE FUNCTION app.reject_history_change();

CREATE TABLE privacy.retention_policies (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  data_class text NOT NULL,
  jurisdiction text NOT NULL,
  version text NOT NULL,
  rule jsonb NOT NULL,
  reviewed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT retention_policies_pk PRIMARY KEY (id),
  CONSTRAINT retention_policies_u1 UNIQUE (data_class,jurisdiction,version),
  CONSTRAINT retention_policies_data_class_ck CHECK (length(btrim(data_class)) BETWEEN 1 AND 100),
  CONSTRAINT retention_policies_jurisdiction_ck CHECK (length(btrim(jurisdiction)) BETWEEN 1 AND 100),
  CONSTRAINT retention_policies_version_ck CHECK (length(btrim(version)) BETWEEN 1 AND 100),
  CONSTRAINT retention_policies_rule_ck CHECK (jsonb_typeof(rule)='object' AND octet_length(rule::text) <= 65536)
);

CREATE TRIGGER retention_policies_immutable BEFORE UPDATE ON privacy.retention_policies FOR EACH ROW EXECUTE FUNCTION app.reject_history_change();

CREATE TABLE privacy.legal_holds (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  subject_id uuid,
  resource_kind text NOT NULL,
  resource_id uuid,
  reason_code text NOT NULL,
  approved_by uuid NOT NULL,
  review_after timestamptz NOT NULL,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT legal_holds_pk PRIMARY KEY (id),
  CONSTRAINT legal_holds_scope_ck CHECK (num_nonnulls(subject_id,resource_id)>=1),
  CONSTRAINT legal_holds_resource_kind_ck CHECK (length(btrim(resource_kind)) BETWEEN 1 AND 100),
  CONSTRAINT legal_holds_reason_code_ck CHECK (length(btrim(reason_code)) BETWEEN 1 AND 100),
  CONSTRAINT legal_holds_times_ck CHECK (review_after > created_at AND (released_at IS NULL OR released_at >= created_at)),
  CONSTRAINT legal_holds_revision_ck CHECK (revision > 0),
  CONSTRAINT legal_holds_updated_ck CHECK (updated_at >= created_at),
  CONSTRAINT legal_holds_subject_fk FOREIGN KEY (subject_id) REFERENCES app.subjects(id) ON DELETE RESTRICT,
  CONSTRAINT legal_holds_approver_fk FOREIGN KEY (approved_by) REFERENCES admin.staff_identities(id) ON DELETE RESTRICT
);

CREATE INDEX legal_holds_subject_idx ON privacy.legal_holds(subject_id);

CREATE INDEX legal_holds_approver_idx ON privacy.legal_holds(approved_by);

CREATE INDEX legal_holds_review_idx ON privacy.legal_holds(review_after,id) WHERE released_at IS NULL;

CREATE INDEX legal_holds_resource_idx ON privacy.legal_holds(resource_kind,resource_id);
