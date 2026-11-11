# ET Link Coffee launch status

Real Supabase staging acceptance passed for registration, email confirmation, login, verification, private inventory and requests, matching, offers, samples, allocation, reservation, deals and commissions. Nine migrations are applied. Do not reapply them during deployment. Temporary privileges were revoked and historical records preserved.

Encrypted logical backup passed archive readback and remount checksum verification. Client verify-full validates the application-workstation-to-pooler connection. Backend pg_stat_ssl describes a separate pooler-to-database connection and does not measure client TLS.

## Remaining cutover requirements

- Obtain Netlify Free account/site access; no paid add-ons or automatic recharge. Publish only after owner approval. Disable automatic branch and deploy previews.
- Obtain approval to use the existing Supabase staging project for customer operations. The release guard permits only project fzgnepvhwhvxukuyubzk.
- Enter the environment template values privately in build and functions scopes. Enable the reviewed Auth and trading gates only at approved cutover. Never deploy staging-test credentials or fixture flags. Private verification uploads require the server-only document validator key. Optional guest ingress remains closed until a trusted edge signer is configured; authenticated buyer requests work independently.
- Set Auth Site URL to https://etlinkcoffee.com. Preserve local redirects; add https://etlinkcoffee.com/auth/callback, https://etlinkcoffee.com/auth/callback?next=reset and https://etlinkcoffee.com/auth/reset. Retain tested confirmation and scanner-resistant recovery flows and the token_hash invitation confirmation page. Check Resend SMTP sender verification and provider abuse controls. Optional application notifications remain disabled.
- Nominate an operational staff manager, verify MFA and approve least-privilege staff access. No permanent operational manager remains from testing. Do not recreate revoked test grant tuples.
- Before real customer intake, refresh the encrypted cutover backup and preserve necessary Auth configuration, roles and Storage bytes separately. A PostgreSQL archive covers readable Auth tables and Storage metadata, not hosted settings, all provider roles or object contents. Verify an operational recovery route.
- Porkbun: replace conflicting parking records with apex ALIAS (blank host) to apex-loadbalancer.netlify.com and www CNAME to the assigned Netlify site hostname. Preserve unrelated MX/TXT records. Add both domains in Netlify. The www value depends on site assignment and must not be guessed.
- After deployment approval: verify issued HTTPS, canonical redirect, real-host confirmation/recovery, session isolation, private no-store responses and operational MFA access. Reuse staging evidence and repeat only host-dependent checks. If these fail, restrict public access or roll back the deploy; never automatically roll back the accepted database schema.
