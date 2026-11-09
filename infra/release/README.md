# Release scaffold

P1-PR-002 produces an optimized nonroot Linux image with an OCI source-revision label. `pnpm verify:push` records its content-addressed image ID and source/lock hashes in ignored `.local/verified-commit.json`. This is local build evidence, not a remotely published deployment digest.

CI has read-only repository permissions and receives no provider/production credentials. It builds and tests the pinned image and disposable PostgreSQL cluster. Merge-to-main runs checks only; no push deploys a site.

When DD03/DD04 are resolved, add the selected registry/host adapter in P1-PR-003's outstanding provider proofs, completed no later than P1-PR-031. Configure GitHub `stage-hosted` and `production` environments with owner approval, branch restrictions and scoped secrets before any workflow can target them. Record the actual server-side protection settings as evidence; names in YAML alone are not protection. No hosted environment or production credentials are required for local bootstrap.

The release manifest must bind the approved source SHA, lockfile hash, published `registry/image@sha256:<64 hex>` digest, configuration version, separate app/CMS migration revisions, target environment, G0/S4/S6 evidence and rollback digest. Promotion consumes that immutable artifact; it cannot silently rebuild. Serialize migrations independently of runtime startup and require the selected host's authenticated smoke before traffic promotion. Provider credentials and native workstation database credentials never enter image layers or build arguments.

Host selection and actual protected hosted environments remain owner-deferred external work. S0 local acceptance does not authorize production traffic. This scaffold deliberately has no deployment command until a real target and its permissions exist.

The [Phase 1 local release packet](../../docs/implementation/P1-PR-043-local-release-preparation.md) inventories the verified construction baseline and missing production manifest inputs. It does not approve a candidate, select a host or authorize activation.

The [Phase 2 local release packet](../../docs/implementation/P2-PR-027-local-release-preparation.md) additionally separates the unchanged default33-app/3-CMS manifests from the unpromoted disposable55-app chain and identifies outstanding hosted P2 runtime/provider/identity integration. Its [controlled rollout handover](../../docs/operations/phase-2-controlled-rollout.md) and [input inventory](../../docs/implementation/evidence/P2/p2-pr-027-release-inputs.json) retain empty production candidate, approval and real pilot fields. These are local preparation documents; they add no deployment command, default schema promotion, provider/model activation, recipient permission or live phase acceptance.
