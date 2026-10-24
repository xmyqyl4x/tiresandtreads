-- Synthetic prior-release publication: only the isolated schema harness runs this fixture.
INSERT INTO app.data_providers(id,code,name,status)
VALUES ('66666666-6666-4666-8666-666666666661','upgrade_sentinel','Synthetic previous release','disabled');
INSERT INTO app.data_licenses(id,provider_id,market,rights,effective_at,reviewed_at)
VALUES ('66666666-6666-4666-8666-666666666662','66666666-6666-4666-8666-666666666661','US',
  '{"display":false,"cache":false,"derived":false,"snapshot":false,"api":false}','2026-01-01','2026-01-01');
INSERT INTO app.dataset_versions(id,provider_id,license_id,kind,external_version,checksum,status,effective_at,fetched_at,row_count)
VALUES ('66666666-6666-4666-8666-666666666663','66666666-6666-4666-8666-666666666661','66666666-6666-4666-8666-666666666662',
  'synthetic','upgrade',repeat('c',64),'staging','2026-01-01','2026-01-01',0);
UPDATE app.dataset_versions SET status='published',published_at=now() WHERE id='66666666-6666-4666-8666-666666666663';
INSERT INTO app.dataset_bundles(id,market,manifest_hash,status)
VALUES ('66666666-6666-4666-8666-666666666664','US',repeat('c',64),'staging');
INSERT INTO app.bundle_members(bundle_id,component_key,dataset_version_id)
VALUES ('66666666-6666-4666-8666-666666666664','synthetic','66666666-6666-4666-8666-666666666663');
UPDATE app.dataset_bundles SET status='published',published_at=now() WHERE id='66666666-6666-4666-8666-666666666664';
INSERT INTO app.import_runs(id,provider_id,upstream_run_key,status,started_at,mode,mapping_version,content_hash,schema_version)
VALUES ('66666666-6666-4666-8666-666666666665','66666666-6666-4666-8666-666666666661','upgrade','validated',now(),'manual','test',repeat('c',64),'1');
INSERT INTO app.import_publications(id,run_id,bundle_id,market,actor_id,published_at)
VALUES ('66666666-6666-4666-8666-666666666666','66666666-6666-4666-8666-666666666665','66666666-6666-4666-8666-666666666664',
  'US','22222222-2222-4222-8222-222222222222',now());
