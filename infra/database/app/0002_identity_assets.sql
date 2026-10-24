CREATE TABLE app.subjects (
  id uuid DEFAULT gen_random_uuid() CONSTRAINT subjects_pk PRIMARY KEY,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  permission_revision bigint NOT NULL DEFAULT 1,
  last_active_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT subjects_kind_ck CHECK (kind IN ('guest','contact','account')),
  CONSTRAINT subjects_status_ck CHECK (status IN ('active','restricted','pending_deletion')),
  CONSTRAINT subjects_revision_ck CHECK (revision > 0 AND permission_revision > 0),
  CONSTRAINT subjects_times_ck CHECK (updated_at >= created_at AND last_active_at >= created_at AND (expires_at IS NULL OR expires_at > created_at))
);
CREATE INDEX subjects_expiry_idx ON app.subjects(expires_at, id) WHERE expires_at IS NOT NULL;
CREATE TABLE app.owner_sessions (
  id uuid DEFAULT gen_random_uuid() CONSTRAINT owner_sessions_pk PRIMARY KEY,
  subject_id uuid NOT NULL,
  token_hash bytea NOT NULL,
  key_version text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT owner_sessions_subject_fk FOREIGN KEY (subject_id) REFERENCES app.subjects(id) ON DELETE RESTRICT,
  CONSTRAINT owner_sessions_digest_uq UNIQUE (key_version, token_hash),
  CONSTRAINT owner_sessions_digest_ck CHECK (octet_length(token_hash) = 32),
  CONSTRAINT owner_sessions_key_ck CHECK (length(btrim(key_version)) BETWEEN 1 AND 100),
  CONSTRAINT owner_sessions_revision_ck CHECK (revision > 0),
  CONSTRAINT owner_sessions_times_ck CHECK (updated_at >= created_at AND expires_at > created_at AND (revoked_at IS NULL OR revoked_at >= created_at))
);
CREATE INDEX owner_sessions_subject_idx ON app.owner_sessions(subject_id, id);
CREATE INDEX owner_sessions_expiry_idx ON app.owner_sessions(expires_at, id);

CREATE TABLE admin.staff_identities (
  id uuid DEFAULT gen_random_uuid() CONSTRAINT staff_identities_pk PRIMARY KEY,
  provider_subject text NOT NULL CONSTRAINT staff_identities_provider_uq UNIQUE,
  status text NOT NULL,
  role_revision bigint NOT NULL DEFAULT 1,
  last_verified_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT staff_identities_provider_ck CHECK (length(btrim(provider_subject)) BETWEEN 1 AND 200),
  CONSTRAINT staff_identities_status_ck CHECK (status IN ('active','disabled')),
  CONSTRAINT staff_identities_revision_ck CHECK (revision > 0 AND role_revision > 0),
  CONSTRAINT staff_identities_times_ck CHECK (updated_at >= created_at)
);
CREATE TABLE admin.roles (
  id uuid DEFAULT gen_random_uuid() CONSTRAINT roles_pk PRIMARY KEY,
  code text NOT NULL CONSTRAINT roles_code_uq UNIQUE,
  permissions jsonb NOT NULL,
  policy_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT roles_code_ck CHECK (code ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT roles_permissions_ck CHECK (CASE WHEN jsonb_typeof(permissions) = 'array' THEN jsonb_array_length(permissions) <= 64 AND NOT jsonb_path_exists(permissions, '$[*] ? (@.type() != "string")') ELSE false END),
  CONSTRAINT roles_policy_ck CHECK (length(btrim(policy_version)) BETWEEN 1 AND 100),
  CONSTRAINT roles_revision_ck CHECK (revision > 0),
  CONSTRAINT roles_times_ck CHECK (updated_at >= created_at)
);
CREATE TABLE admin.staff_role_assignments (
  staff_id uuid NOT NULL,
  role_id uuid NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT staff_role_assignments_pk PRIMARY KEY (staff_id, role_id),
  CONSTRAINT staff_role_assignments_staff_fk FOREIGN KEY (staff_id) REFERENCES admin.staff_identities(id) ON DELETE RESTRICT,
  CONSTRAINT staff_role_assignments_role_fk FOREIGN KEY (role_id) REFERENCES admin.roles(id) ON DELETE RESTRICT,
  CONSTRAINT staff_role_assignments_revision_ck CHECK (revision > 0),
  CONSTRAINT staff_role_assignments_times_ck CHECK (updated_at >= created_at AND (revoked_at IS NULL OR revoked_at >= granted_at))
);
CREATE INDEX staff_role_assignments_role_idx ON admin.staff_role_assignments(role_id, staff_id);

CREATE TABLE app.object_assets (
  id uuid DEFAULT gen_random_uuid() CONSTRAINT object_assets_pk PRIMARY KEY,
  purpose text NOT NULL,
  purpose_set text NOT NULL DEFAULT 'asset_purpose',
  bucket text NOT NULL,
  object_key text NOT NULL,
  object_version text,
  sha256 text,
  size_bytes bigint,
  mime_type text NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  expires_at timestamptz,
  deleted_at timestamptz,
  key_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1,
  CONSTRAINT object_assets_location_uq UNIQUE (bucket, object_key),
  CONSTRAINT object_assets_purpose_fk FOREIGN KEY (purpose_set, purpose) REFERENCES app.code_values(set_code, code) ON DELETE RESTRICT,
  CONSTRAINT object_assets_purpose_set_ck CHECK (purpose_set = 'asset_purpose'),
  CONSTRAINT object_assets_bucket_ck CHECK (bucket ~ '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$'),
  CONSTRAINT object_assets_key_ck CHECK (object_key ~ '^assets/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  CONSTRAINT object_assets_hash_ck CHECK (sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT object_assets_size_ck CHECK (size_bytes IS NULL OR size_bytes >= 0),
  CONSTRAINT object_assets_mime_ck CHECK (mime_type ~ '^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$' AND length(mime_type) <= 100),
  CONSTRAINT object_assets_state_ck CHECK (state IN ('pending','ready','quarantined','deleting','deleted')),
  CONSTRAINT object_assets_ready_ck CHECK (state <> 'ready' OR (sha256 IS NOT NULL AND size_bytes IS NOT NULL)),
  CONSTRAINT object_assets_deleted_ck CHECK ((state = 'deleted') = (deleted_at IS NOT NULL)),
  CONSTRAINT object_assets_revision_ck CHECK (revision > 0),
  CONSTRAINT object_assets_times_ck CHECK (updated_at >= created_at AND (expires_at IS NULL OR expires_at > created_at) AND (deleted_at IS NULL OR deleted_at >= created_at)),
  CONSTRAINT object_assets_versions_ck CHECK ((object_version IS NULL OR length(btrim(object_version)) BETWEEN 1 AND 1024) AND (key_version IS NULL OR length(btrim(key_version)) BETWEEN 1 AND 100))
);
CREATE INDEX object_assets_purpose_idx ON app.object_assets(purpose_set, purpose);
CREATE INDEX object_assets_retention_idx ON app.object_assets(state, expires_at, id);

GRANT SELECT, INSERT, UPDATE ON app.subjects, app.owner_sessions TO tt_app_runtime;
GRANT SELECT, INSERT, UPDATE ON app.object_assets TO tt_asset_runtime;
GRANT USAGE ON SCHEMA admin TO tt_staff_runtime;
GRANT SELECT ON admin.staff_identities, admin.roles, admin.staff_role_assignments TO tt_staff_runtime;
-- Identity/grant provisioning and deletion workers gain narrowly reviewed grants with their later services.
-- No password/token secret column, public object URL, default grants or runtime DELETE/TRUNCATE/DDL.
