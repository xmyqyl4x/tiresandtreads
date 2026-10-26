-- Signed callback minima only. Raw bodies/addresses/IPs/user agents are not retained.
CREATE TABLE email.callback_observations (
 inbox_id uuid PRIMARY KEY REFERENCES app.webhook_inbox(id) ON DELETE RESTRICT,
 message_id text CHECK(message_id ~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'),
 delivery_key text CHECK(delivery_key ~ '^[a-f0-9]{64}$'),
 type text NOT NULL CHECK(type IN ('sent','delivered','delayed','bounced','complained','opened','clicked','unsupported')),
 classification text NOT NULL CHECK(classification IN ('unknown','machine','suspected_human','hard','soft')),
 occurred_at timestamptz NOT NULL
);
CREATE INDEX callback_observations_message_idx ON email.callback_observations(message_id,inbox_id);
CREATE INDEX callback_observations_key_idx ON email.callback_observations(delivery_key,inbox_id);
CREATE TRIGGER callback_observations_immutable BEFORE UPDATE ON email.callback_observations FOR EACH ROW EXECUTE FUNCTION app.reject_history_change();
CREATE INDEX webhook_inbox_provider_due_idx ON app.webhook_inbox(provider,next_attempt_at NULLS FIRST,id) WHERE state IN ('pending','failed');
GRANT SELECT,INSERT ON email.callback_observations,email.email_events,email.email_feedback TO tt_private_runtime;
GRANT SELECT,INSERT,UPDATE ON email.email_links TO tt_private_runtime;
