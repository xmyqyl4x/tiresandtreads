-- Optional, local-only fixtures. Never run by migrate or an application startup.
INSERT INTO app.subjects (id, kind) VALUES ('11111111-1111-4111-8111-111111111111', 'guest') ON CONFLICT (id) DO NOTHING;
INSERT INTO app.owner_sessions (id, subject_id, token_hash, key_version, expires_at)
  VALUES ('11111111-1111-4111-8111-111111111112', '11111111-1111-4111-8111-111111111111', decode(repeat('01', 32), 'hex'), 'synthetic-only', now() + interval '1 day') ON CONFLICT (id) DO NOTHING;
INSERT INTO admin.staff_identities (id, provider_subject, status, last_verified_at)
  VALUES ('22222222-2222-4222-8222-222222222222', 'synthetic_disabled_staff', 'disabled', now()) ON CONFLICT (id) DO NOTHING;
INSERT INTO admin.roles (id, code, permissions, policy_version)
  VALUES ('33333333-3333-4333-8333-333333333333', 'synthetic_no_permissions', '[]', 'synthetic-only') ON CONFLICT (id) DO NOTHING;
INSERT INTO admin.staff_role_assignments (staff_id, role_id, revoked_at)
  VALUES ('22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', now()) ON CONFLICT (staff_id, role_id) DO NOTHING;
INSERT INTO app.object_assets (id, purpose, bucket, object_key, mime_type)
  VALUES ('44444444-4444-4444-8444-444444444444', 'report_pdf', 'synthetic-private', 'assets/44444444-4444-4444-8444-444444444444', 'application/pdf') ON CONFLICT (id) DO NOTHING;
