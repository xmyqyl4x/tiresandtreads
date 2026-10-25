-- UPDATE(id) exists solely to permit bounded source row locks.
CREATE TRIGGER source_connectors_identity BEFORE UPDATE ON app.source_connectors FOR EACH ROW
 EXECUTE FUNCTION app.guard_identity_columns('id');
