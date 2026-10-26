-- Bind inbox proof to the precise pending grant, never a client-declared contact permission.
CREATE TABLE privacy.contact_intents (
  challenge_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  owner_subject_id uuid NOT NULL,
  scope_key text NOT NULL,
  policy_version text NOT NULL,
  grant_event_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_intents_pk PRIMARY KEY(challenge_id),
  CONSTRAINT contact_intents_challenge_fk FOREIGN KEY(challenge_id) REFERENCES privacy.verification_challenges(id) ON DELETE RESTRICT,
  CONSTRAINT contact_intents_contact_fk FOREIGN KEY(contact_id) REFERENCES privacy.contacts(id) ON DELETE RESTRICT,
  CONSTRAINT contact_intents_owner_fk FOREIGN KEY(owner_subject_id) REFERENCES app.subjects(id) ON DELETE RESTRICT,
  CONSTRAINT contact_intents_event_fk FOREIGN KEY(grant_event_id) REFERENCES privacy.consent_events(id) ON DELETE RESTRICT,
  CONSTRAINT contact_intents_scope_ck CHECK(length(btrim(scope_key)) BETWEEN 1 AND 200),
  CONSTRAINT contact_intents_policy_ck CHECK(length(btrim(policy_version)) BETWEEN 1 AND 100)
);
CREATE INDEX contact_intents_contact_idx ON privacy.contact_intents(contact_id);
CREATE INDEX contact_intents_owner_idx ON privacy.contact_intents(owner_subject_id);
CREATE INDEX contact_intents_event_idx ON privacy.contact_intents(grant_event_id);
CREATE TRIGGER contact_intents_immutable BEFORE UPDATE ON privacy.contact_intents FOR EACH ROW EXECUTE FUNCTION app.reject_history_change();
ALTER TABLE privacy.suppressions ADD COLUMN lifted_at timestamptz;
ALTER TABLE privacy.suppressions ADD CONSTRAINT suppressions_lifted_ck CHECK(lifted_at IS NULL OR lifted_at>=effective_at);
GRANT SELECT,INSERT ON privacy.contact_intents,privacy.cookie_consents TO tt_private_runtime;
GRANT SELECT,INSERT,UPDATE ON privacy.verification_challenges,privacy.suppression_tombstones TO tt_private_runtime;
