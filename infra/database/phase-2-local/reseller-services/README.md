# Opt-in local reseller services

This disposable-only extension follows migrations 0034–0045 and adds 0046. Its checksum-pinned manifest is loaded only by `tests/fixtures/phase2/partner-services.ts`; the default 33/3 manifests and production provisioning are unchanged. Do not run it as an ad hoc production bootstrap.

The fixture creates two absent, randomly credentialed local server roles, installs the exact source chain and removes its owned pools/databases/roles. `tt_p2_partner_service` inherits the existing identity/offer writers; `tt_p2_coupon_worker` gets only explicit job/staging/code capabilities. Narrow definer functions lock authority/code rows without granting unrelated update rights. Fixed policies authorize server capabilities; application services, rather than browser-selected SQL settings, establish actor/tenant authority.

Five new tables record onboarding, invitations, append-only masked audit and bounded encrypted coupon-import staging. A nullable staff author plus explicit partner author preserves old staff rows and permits genuinely partner-authored offers with independent review. Serving requires approved local onboarding metadata, so earlier organizations need a reviewed backfill before any later promotion. Existing historical proofs remain historical.

Run `node tests/fixtures/phase2/partner-services-run.mjs`. See [service design and limits](../../../../docs/implementation/P2-PR-009-local-reseller-services.md). Actual schema/privacy/authentication/provider/pilot/deployment acceptance and latest-track restore remain held; no case or gate closes.
