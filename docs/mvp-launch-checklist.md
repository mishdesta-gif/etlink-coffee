# ET Link Coffee MVP release checklist

Target date is November 10, 2026, Addis Ababa time. The release covers buyer and supplier onboarding, private buyer inquiries and supplier lots, staff review, and internal manual matching.

## Before requesting deployment approval

- Capture the reviewed source and migration versions in a release commit. The current working tree contains substantial existing implementation beyond HEAD. Include the application, public assets, dependency lockfile and reviewed migrations. Exclude private environment files, browser state, generated builds and fixture evidence.
- Verify the selected Supabase target, migration history, executor privileges and a recoverable backup or approved recovery route before any hosted migration. Reconcile hosted migration versions against the reviewed source before applying anything. See the [staging preflight](../review/phase2-staging-preflight-stop-report.md).
- Verify Auth redirects, email confirmation and scanner-resistant recovery on the intended host. Validate provider-native abuse controls before setting `ETLINK_AUTH_PROVIDER_PROTECTION_REVIEWED=true`. Verify HTTPS, trusted guest inquiry ingress and private document handling against the intended production settings before enabling those paths.

## After approval

1. Prepare a restricted deployment on a Node.js server with the lockfile and target-specific configuration. Set the Supabase URL and publishable key at build time and supply the app origin and any approved server secrets at runtime. Keep synthetic fixtures and transactional delivery disabled. Keep trading disabled until the database schema and grants are verified.
2. Apply only the reviewed missing migrations in order after the recovery gate passes. Grant staff only the review and matching permissions needed for launch and verify MFA. Review effective grants for the MVP scope, including withholding commission management and offer issuance grants.
3. In the restricted environment, set `ETLINK_PHASE2_ENABLED=true` and set `ETLINK_TRADING_APPROVED_APP_ORIGIN` and `ETLINK_TRADING_APPROVED_SUPABASE_ORIGIN` to the exact HTTPS origins from the approved release configuration. Leave the values unset on unrelated previews.
4. Smoke-test desktop and mobile landing pages, buyer and supplier registration and login, pre-verification buyer inquiry submission, supplier stock denial before approval and acceptance afterward, and manual matching by authorized MFA staff. Confirm anonymous users and unrelated tenants cannot read private records or prices. Confirm customers cannot see counterparty identities through the match workflow and unauthorized staff cannot approve a match.
5. Open public access only after those checks pass and the owner approves release. If hosted verification fails, keep public access restricted and disable trading in the app. Treat that switch as an application control and use the approved database access or recovery procedure for any schema, data or permission issue.
