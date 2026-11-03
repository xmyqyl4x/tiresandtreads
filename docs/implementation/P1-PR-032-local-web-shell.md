# P1-PR-032 — accessible local web shell

The local shell and design-system implementation completes the fifth card in the owner-authorized 028–032 development scope. Actual S3/G0/S4, live-release and deployment acceptance remain held. The six S3 records remain pending and empty; HS01–HS08 remain proposed, operator/coverage/rates unconfirmed and specialist/licensed work pending. No provisioning, purchases, actual recipient notifications or external commercial activation occurs. No original lifecycle case or gate closes.

## Delivered experience

The React views implement the approved charcoal/blue/yellow palette, spacing, responsive navigation, semantic landmarks, skip link, reusable buttons/fields/status/error patterns, reserved house-content space and locale/Intl scaffolding. Native mobile disclosure works before hydration; Escape closes it and returns focus. The privacy dialog has labeled native controls, explicit Tab wrapping, Escape/Close focus return, saved/error feedback focus and default-off optional permissions. System fonts provide the approved fallback while the heading-font license remains pending. The tire illustration is original SVG.

The home page, component gallery and clearly labeled navigation previews are available. Assessment, results, shopping, delivery screens and reviewed editorial content remain in 033 onward. Components contain presentation and interaction behavior; authorization, consent, pricing, ranking and persistence remain in the shared services behind the APIs.

## Rendering and performance

Next App Router remains the HTTP/API host. Its local HTML response adapters serve server-rendered React views with one small React client bundle and lazy privacy client. Navigation uses normal links; this shell ships no Next client router. The existing esbuild dependency builds shared views, hashed browser assets and an isolated Node renderer. Generated code stays under `apps/web/node_modules/.cache/tt-preview`, outside Git; Next standalone output contains the compiled renderer and allowlisted assets. No new dependency or framework is introduced.

Both default Next client-router and Webpack profiles exceeded the unchanged 120,000-byte initial JavaScript gzip target. The final profile measures every client module, including the lazy consent SDK, against that target. The integration test prints `LOCAL_WEB_BUNDLE` and `LOCAL_WEB_COMPLETE_CLIENT` with exact measured totals. The earlier optimized Linux run measured 82,198 bytes for the complete client; the final exact-source run and CI provide the authoritative totals. Bundled license comments remain in generated code.

The transport and public consent contracts use direct named Zod Mini imports. Browser/API callers share canonical input, view and error schemas; JSON-schema generation accepts both existing full schemas and Mini schemas. Browser validation disables JIT/eval probes before constructing schemas under the self-only CSP. Node service parsers keep their prior configuration. A separate child test explicitly labels its browser-realm/CSP simulation; real browser console inspection is recorded separately.

## Local dev and stage

Run from the repository root:

```sh
node scripts/dev/web-preview.mjs dev
node scripts/dev/web-preview.mjs stage
```

Dev uses `http://127.0.0.1:8380`; stage uses `http://127.0.0.1:8480`. Each command creates its own disposable PostgreSQL/CMS, synthetic S3/KMS/workflow fixtures, validated private service-host settings and standalone Next process. These commands do not migrate or modify the retained 3100/3200 environments. Data is disposable, not a persistence or production-readiness promise.

The original test/provider network stays internal. A separate ingress network contains only a read-only, unprivileged Node proxy with a fixed internal `test:3000` upstream and a loopback-only published port. The proxy bounds methods, bodies, request time and concurrency; it cannot select an upstream from caller URLs/forwarded headers. PostgreSQL, providers and the application container acquire no public port. The new override is used only by this frontend preview command; existing bootstrap/CLI/preflight/network policy files are unchanged.

The web adapter requires explicit local fixture flags, exact Host and mutation Origin, declared API paths, bounded bodies and the fixed private loopback API origin. It keeps private headers and forwards the backend's committed receipts. Dev/stage/test owner cookies have separate HttpOnly namespaces even when ports share 127.0.0.1; only the active environment's cookie maps to the backend owner cookie. Duplicate active cookies are refused. Request logs do not contain cookies, tokens, email or paths selected by callers.

The mode record `.local/web-preview-<mode>.json` is claimed exclusively and identifies the generated project. Stop with Ctrl+C. Normal shutdown drains the application/API, removes owned containers/networks/volumes and deletes its private environment/record. A second same-mode command refuses an existing claim. No retained project is selected for teardown.

## Verification

The real standalone integration checks rendered language/title/landmarks/controls, published notices, browser choice persistence through Next → HTTP services → PostgreSQL, forged raw Host refusal, missing/callback routes and complete-client gzip size. Browser QA found and fixed the empty React title, post-save feedback focus, native modal Tab wrapping and compact mobile header. Actual Windows loopback access exposed the fixture network's port restriction; the separate fixed proxy preserves provider isolation while making the preview reachable.

[The browser record](evidence/P1/p1-pr-032-browser.json) distinguishes real browser observations from simulations and later release evidence. Desktop/mobile screenshots accompany it. Checks cover keyboard skip/focus recovery, native menu Escape, default/read/save/reject consent, actual dev/stage isolation, form summary/field recovery and reflow at 320/640/1024/1280 CSS pixels. Console inspection reported no warnings/errors. CSS contrast, target sizes and reduced-motion rules have automated checks; system motion emulation, actual assistive-technology acceptance, field LCP/INP/CLS and full product journeys remain the later experience gate.

The React review applies conditional SDK loading, parallel independent reads, interaction work in event handlers, immutable public formatting objects, stable component definitions, native semantics and transitive client/server boundaries. The full Linux build/quality/coverage/database/recovery/deployment/capacity/observation/provider gate and all independent CI jobs are required for the exact commit before merge. Actual source/provider/privacy/operator decisions remain separate.
