-- Synthetic recovery-only data. No real email, token, provider or object bytes.
BEGIN;
INSERT INTO app.subjects(id,kind) VALUES
 ('88888888-8888-4888-8888-000000000001','guest'),
 ('88888888-8888-4888-8888-000000000002','guest');
INSERT INTO app.owner_sessions(id,subject_id,token_hash,key_version,expires_at)
VALUES ('88888888-8888-4888-8888-000000000003','88888888-8888-4888-8888-000000000001',decode(repeat('aa',32),'hex'),'fixture',now()+interval '1 hour');
INSERT INTO privacy.contacts(id,subject_id,encrypted_email,key_version,status)
VALUES ('88888888-8888-4888-8888-000000000004','88888888-8888-4888-8888-000000000001',convert_to('synthetic-encrypted-envelope','UTF8'),'fixture','active');
INSERT INTO privacy.contact_lookups(key_version,email_hmac,contact_id)
VALUES ('fixture',decode(repeat('ab',32),'hex'),'88888888-8888-4888-8888-000000000004');
INSERT INTO app.rule_versions(id,kind,version,document,document_hash,schema_version,status)
VALUES ('88888888-8888-4888-8888-000000000020','synthetic','recovery','{}',repeat('a',64),1,'draft');
INSERT INTO app.reports(id,owner_subject_id,market,locale,expires_at)
VALUES ('88888888-8888-4888-8888-000000000010','88888888-8888-4888-8888-000000000001','US','en-US',now()+interval '1 day');
INSERT INTO app.report_versions(report_id,version,bundle_id,rule_version_id,engine_version,schema_version,input_snapshot,output_snapshot,snapshot_hash)
VALUES ('88888888-8888-4888-8888-000000000010',1,'66666666-6666-4666-8666-666666666664','88888888-8888-4888-8888-000000000020','fixture',1,'{}','{}',repeat('a',64));
UPDATE app.reports SET current_version=1,status='active' WHERE id='88888888-8888-4888-8888-000000000010';
INSERT INTO app.report_drafts(report_id,base_version,input,schema_version,expires_at)
VALUES ('88888888-8888-4888-8888-000000000010',1,'{}',1,now()+interval '1 day');
INSERT INTO privacy.report_private_data(report_id,encrypted_fields,key_version,expires_at)
VALUES ('88888888-8888-4888-8888-000000000010',convert_to('synthetic-private-envelope','UTF8'),'fixture',now()+interval '1 day');
INSERT INTO app.object_assets(id,purpose,bucket,object_key,mime_type)
VALUES ('88888888-8888-4888-8888-000000000041','report_pdf','synthetic-private','assets/88888888-8888-4888-8888-000000000041','application/pdf');
INSERT INTO app.report_assets(asset_id,report_id,report_version,renderer_version,locale,view_scope,render_key)
VALUES ('88888888-8888-4888-8888-000000000041','88888888-8888-4888-8888-000000000010',1,'fixture','en-US','owner','recovery');
INSERT INTO app.download_grants(asset_id,report_id,report_version,view_scope,owner_session_id,owner_subject_id,token_hash,key_version,expires_at)
VALUES ('88888888-8888-4888-8888-000000000041','88888888-8888-4888-8888-000000000010',1,'owner','88888888-8888-4888-8888-000000000003','88888888-8888-4888-8888-000000000001',decode(repeat('ac',32),'hex'),'fixture',now()+interval '10 minutes');
INSERT INTO email.template_versions(id,template_key,version,locale,purpose,renderer_hash,status)
VALUES ('88888888-8888-4888-8888-000000000030','report','fixture','en-US','report',repeat('b',64),'draft');
INSERT INTO email.email_sends(id,kind,recipient_contact_id,owner_subject_id,report_id,report_version,template_id,send_after,cancel_deadline,provider_key,provider,requested_purposes,dispatch_policy_version)
VALUES ('88888888-8888-4888-8888-000000000031','report','88888888-8888-4888-8888-000000000004','88888888-8888-4888-8888-000000000001','88888888-8888-4888-8888-000000000010',1,'88888888-8888-4888-8888-000000000030',now()+interval '60 seconds',now()+interval '60 seconds','fixture-recovery','synthetic','["report"]','fixture');
INSERT INTO app.outbox(event_id,aggregate_kind,aggregate_id,event_type,schema_version,payload)
VALUES ('88888888-8888-4888-8888-000000000051','subject','88888888-8888-4888-8888-000000000001','fixture',1,'{}');
INSERT INTO analytics.events(id,subject_id,event_name,schema_version,occurred_at,received_at,market,locale,route_template,channel,permission_revision,policy_version,props,payload_digest,bot_classification,expires_at)
VALUES ('88888888-8888-4888-8888-000000000070','88888888-8888-4888-8888-000000000001','report_viewed',1,now(),now(),'US','en-US','/reports/:report','web',1,'fixture','{}',decode(repeat('ad',32),'hex'),'unknown',now()+interval '1 month');
INSERT INTO analytics.dirty_days(day,requested_revision,completed_revision,requested_at,completed_at,next_attempt_at)
VALUES (current_date,1,1,now(),now(),now());
INSERT INTO analytics.daily_metrics(day,metric_code,market,dimension_key,value,generation,computed_at,definition_version)
VALUES (current_date,'events','US','all',1,1,now(),'fixture');
COMMIT;
