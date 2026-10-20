# Mobile application delivery

Page: `/app/projects/{workspace}/{project}/mobile`. Code: `lib/mobile/*`, `components/app/mobile`, routes
`app/api/projects/[projectId]/mobile/builds/[buildId]/download` and `app/api/mobile/runner-callback`.

## What is real

| Capability | Status |
| --- | --- |
| PWA bundle: `manifest.webmanifest`, `sw.js` (network-first navigations, offline fallback, cached assets), `offline.html`, SVG icon, `index.html` patched with manifest/theme/viewport/apple-touch-icon/SW registration. Existing files are never overwritten. | Real. Stored as a zip on the `MobileBuild` row. |
| PWA readiness score (HTTPS, manifest fields, 192/512 icons declared and present, service worker + fetch handler, offline page, meta tags) | Real, computed from the actual output. PNG icons are not generated (only the SVG); the score stays low and says so until real PNGs are added. |
| Capacitor project bundle: `capacitor.config.ts`, `package.json`, `www/` (project output + PWA assets), `README-MOBILE.md` with Android/iOS build, signing and version steps | Real, exportable source. It is **not** a compiled app. |
| Store listing metadata with per-store validation, screenshot references, privacy URL, age rating | Real (validation limits are copied from the stores' published limits and may change). |
| Submission checklist (auto items derived from data; manual items you confirm) | Real. |
| Store credentials (Google service account JSON, App Store Connect API key) | Real: encrypted with `encryptSecret`, never sent to the client (only a non-secret hint is shown). Shape is validated; they are **not** verified against Google/Apple. |

## What is blocked (needs external setup)

- **Native binaries (.aab/.apk/.ipa) are never built inside this app.** A native build request always creates a Capacitor source bundle, plus a
  `NATIVE_BINARY` build that is `BLOCKED` ("Blocked: external setup") unless **all** hold: paid plan (placeholder gate), a runner is configured and
  supports the platform, and the store credential for that platform is saved. iOS needs a macOS runner with Xcode and an Apple Developer account.
- Even with a runner, success is reported only by the runner's callback with an artifact name + SHA-256; the app never marks a native build succeeded itself.
- No store upload, review submission, or credential verification is implemented.

## Environment (`.env.example`)

- `MOBILE_BUILD_RUNNER_URL` (https, or localhost), `MOBILE_BUILD_RUNNER_TOKEN`, `MOBILE_BUILD_RUNNER_PLATFORMS` (`android`, `ios`).
- Runner contract: `POST {URL}/jobs` with `Authorization: Bearer <token>` and JSON `{buildId, platform, appId, versionName, buildNumber, bundleBase64, callbackUrl}`
  returning `{"jobId": "..."}`. The runner reports `POST {APP_URL}/api/mobile/runner-callback` (same bearer token) with
  `{buildId, status: RUNNING|SUCCEEDED|FAILED, logs?, artifactName?, artifactSha256?, error?}`. The runner contract is defined here but no reference runner is shipped.
- `BETTER_AUTH_SECRET` is required (credential encryption).

## Access, limits and audit

- Roles (`lib/team`): view/download = `view_project`; build, listing, checklist = `publish`; credentials = `manage_integrations`.
- Rate limits per user per hour: PWA/Capacitor 20, native 10, credentials 20, listings 60, checklist 200; runner callback 120/min per IP.
- Audit entries (`recordUserActivity`): `mobile.pwa_bundle_generated`, `mobile.capacitor_bundle_generated`, `mobile.native_build_requested`,
  `mobile.store_credential_saved|deleted`, `mobile.listing_saved`.
- Tables use plain `project_id` (no FK); `lib/projects/cleanup.ts` deletes them with the project. Bundles are capped at 25 MB.

## Pricing (placeholders)

No credit price is defined for mobile builds; nothing is charged. Native builds are gated to non-free plans as a placeholder until pricing is decided
(`planAllowsNative` in `lib/mobile/actions.ts`). Cost of running a runner (especially macOS) is the operator's.

## Store requirements to plan for

- Google Play: developer account, signed `.aab` with Play App Signing, data safety form, content rating, current target API level, privacy policy URL.
- App Store: Apple Developer Program, signing certificates/profiles, App Privacy labels, export compliance, TestFlight testing; minimum-functionality review (thin web wrappers are often rejected).
