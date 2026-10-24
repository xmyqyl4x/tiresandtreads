import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { catalogFixture, uid, time, success } from '../catalog/database.ts';
import { createOwnerRepository } from '../../../packages/db/src/repositories/owners.ts';
import { createReportRepository } from '../../../packages/db/src/repositories/reports.ts';
import { createCapabilityRepository } from '../../../packages/db/src/repositories/capabilities.ts';
import { createPrivacyRepository } from '../../../packages/db/src/repositories/privacy.ts';
import { createDeliveryRepository } from '../../../packages/db/src/repositories/delivery.ts';
import { createReliabilityRepository } from '../../../packages/db/src/repositories/reliability.ts';
import { rid } from '../../../packages/db/src/repositories/private-values.ts';
import type { Owner, Version } from '../../../packages/application/src/ports/private-records.ts';
import type { ConsentPurpose } from '../../../packages/domain/src/entities/consent.ts';
export { uid, time, success, result } from '../catalog/database.ts';
export function key(keyVersion = 'test-hmac-v1') {
  return { keyVersion, digest: randomBytes(32).toString('hex') };
}
export function encrypted(keyVersion = 'test-enc-v1') {
  return { keyVersion, hex: randomBytes(32).toString('hex') };
}
export async function privateFixture() {
  const f = await catalogFixture();
  try {
    const scope = f.adapter('tt_private_runtime'),
      owners = createOwnerRepository(scope),
      reports = createReportRepository(scope),
      caps = createCapabilityRepository(scope),
      privacy = createPrivacyRepository(scope, ['test-hmac-v1']),
      delivery = createDeliveryRepository(scope),
      reliability = createReliabilityRepository(scope);
    await f.owner.query(readFileSync('tests/fixtures/schema/pr005-upgrade.sql', 'utf8'));
    const bundleId = rid('bundle', '66666666-6666-4666-8666-666666666664'),
      ruleId = uid('rule');
    await f.owner.query(
      "INSERT INTO app.rule_versions(id,kind,version,document,document_hash,status) VALUES($1,'synthetic','v1','{}',$2,'draft')",
      [ruleId, key().digest],
    );
    await f.owner.query(
      "UPDATE app.rule_versions SET status='published',reviewed_by=$2,reviewed_at=now() WHERE id=$1",
      [ruleId, f.staff],
    );
    async function owner() {
      const identity = { subjectId: uid('subject'), sessionId: uid('owner_session') },
        token = key();
      await success(scope.unitOfWork, (tx) =>
        owners.create(tx, { owner: identity, key: token, expiresAt: time(86400000) }),
      );
      return { identity, token };
    }
    async function report(identity: Owner) {
      const h = await success(scope.unitOfWork, (tx) =>
        reports.create(tx, identity, {
          id: uid('report'),
          market: 'US',
          locale: 'en-US',
          expiresAt: time(86400000),
        }),
      );
      const v: Version = {
        reportId: h.id,
        version: 1,
        baseVersion: null,
        bundleId,
        ruleVersionId: ruleId,
        engineVersion: 'synthetic-v1',
        schemaVersion: 1,
        input: { unknown: null },
        output: { cost: '123456789', evidence: 'unknown' },
      };
      const published = await success(scope.unitOfWork, (tx) =>
        reports.publish(tx, identity, h.revision, v, [
          { key: 'excluded', skuId: null, kind: 'excluded', rank: null, snapshot: { price: null } },
        ]),
      );
      return { head: published, version: v };
    }
    async function contact() {
      const token = key(),
        envelope = encrypted();
      const input = { id: uid('contact'), subjectId: uid('subject'), keys: [token], envelope };
      const value = await success(scope.unitOfWork, (tx) => privacy.registerContact(tx, input));
      return { value, input, token };
    }
    async function notice(purpose: ConsentPurpose = 'report') {
      const id = uid('notice');
      await f.owner.query(
        "INSERT INTO privacy.notices(id,purpose,market_policy,version,content_hash,published_at,content_ref) VALUES($1,$2,'synthetic',$3,$4,now(),'synthetic-reference')",
        [id, purpose, uid('version'), key().digest],
      );
      return id;
    }
    async function template(purpose = 'report') {
      const id = uid('template');
      await f.owner.query(
        "INSERT INTO email.template_versions(id,template_key,version,locale,purpose,renderer_hash,status,reviewed_at) VALUES($1,$2,'1','en-US',$3,$4,'published',now())",
        [id, uid('template_key'), purpose, key().digest],
      );
      return id;
    }
    async function asset(purpose = 'report_pdf') {
      const id = uid('asset'),
        hash = key().digest;
      await f.owner.query(
        "INSERT INTO app.object_assets(id,purpose,bucket,object_key,mime_type,state,sha256,size_bytes,object_version) VALUES($1,$2,'synthetic-private',$3,'application/pdf','ready',$4,12345,'v1')",
        [id, purpose, 'assets/' + id, hash],
      );
      return { id, hash };
    }
    return {
      ...f,
      admin: f.owner,
      scope,
      owners,
      reports,
      caps,
      privacy,
      delivery,
      reliability,
      owner,
      report,
      contact,
      notice,
      template,
      asset,
      bundleId,
      ruleId,
    };
  } catch (error) {
    await f.cleanup();
    throw error;
  }
}
