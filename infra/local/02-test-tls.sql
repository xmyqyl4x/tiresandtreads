-- Disposable test projects only. Legacy plaintext fixtures still run independently;
-- the new preflight client always requires CA and hostname verification.
ALTER SYSTEM SET ssl = 'on';
ALTER SYSTEM SET ssl_cert_file = '/tls/server.crt';
ALTER SYSTEM SET ssl_key_file = '/tls/server.key';
