# Local partner repository support

This opt-in track extends the exact [local S1 schema](../gate/README.md) with migration 0044, one forced-RLS immutable allocation-receipt table and four purpose-specific disposable roles. It is not in the default app/CMS manifests or generated models. Production bootstrap, CLI, preflight and policy are unchanged.

| Fixture role | Repository purpose |
| --- | --- |
| `tt_p2_identity_writer` | Pending organization/owner registration and revision-checked organization/membership changes |
| `tt_p2_offer_writer` | Append drafts/targets, record independent review and compare-and-set the published pointer |
| `tt_p2_allocation_runtime` | Internal code/frequency/cap reservations, outcomes, definitive releases and append-only reported redemption corrections |
| `tt_p2_pilot_reader` | Current-member organization/location/offer reads and masked pilot, dispute and reviewed cohort projections |

These are trusted server-side credentials, not authenticated consumer/partner sessions. SQL membership checks bind every partner read to transaction-local organization and actor context. The service layer must authorize staff and allocation commands; these repositories do not accept an external identity token or decide eligibility, consent, ranking, geography, commercial policy or evidentiary sufficiency.

The fixture alone creates these roles, restricted and initially absent, in its owned disposable project. Fixed security-definer bridges expose only root/offer locks; they grant no raw contact/send data to the allocation role. Receipt, selection and correction history cannot be rewritten by repository credentials. No deployment role lifecycle is added.

Run `node tests/fixtures/phase2/partner-repositories-run.mjs` for type checking, the focused unit/database suite and verified owned cleanup. The [implementation packet](../../../../docs/implementation/P2-PR-006-local-partner-repositories.md) explains transaction order, idempotency, privacy and acceptance limits. Actual S1/S2/pilot/privacy/provider/deployment approval remains pending; no case or gate closes here.
