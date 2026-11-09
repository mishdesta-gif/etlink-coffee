# ET Link Coffee

Premium public website for an Ethiopian coffee trade intermediary, built on the existing Next.js 16.4.3 App Router, React 19, strict TypeScript, and Tailwind CSS v4 foundation.

## Local development on Windows

Use Node.js 24 LTS (see .nvmrc) and npm.

The commands below are general development instructions, not the approved controlled-staging startup procedure. For hosted-backed staging on port 3103, follow review/phase1-controlled-staging-operating-runbook.md and the recorded approval boundaries. Do not treat the default port 3000 preview as the reviewed staging candidate.

```powershell
Set-Location 'C:\Users\Rediet Fikre\Documents\ChatGPT\Etlink Coffee Project'
npm ci
npm run dev
```

Open http://localhost:3000. If localhost cannot connect, try http://127.0.0.1:3000. Stop the server with Ctrl+C.

No credentials are needed for the public website. Phase 1 now includes Supabase authentication, business registration/membership, independent buyer/supplier verification, staff MFA and permissions, private documents, inquiry management, in-app notifications and audit logging. Missing configuration fails closed. Never expose a service-role or secret key. For fake-only local validation, use [the isolated journey runner](docs/phase1-user-journey-validation.md); do not point that fixture build at staging.

The current Phase 1 target is controlled local staging, not public deployment. Hosted scanner-resistant password recovery is **BLOCKED — pending SMTP configuration and controlled validation**. Custom SMTP and further hosted recovery emails are explicitly deferred. The local recovery-confirmation implementation is preserved and tested but is not connected to the unchanged hosted email template. Transactional email remains disabled; etlinkcoffee@gmail.com is the sole public contact. See [the current Phase 1 readiness report](review/phase1-readiness-after-email-deferral-20261105.md).

## Public pages

| Route | Content |
| --- | --- |
| / | Premium hero, buyer/supplier journeys, origins, intermediary safeguards |
| /about | Mission, Ethiopian coffee heritage, leadership, intermediary role |
| /how-it-works | Separate four-stage buyer and supplier processes |
| /for-buyers | International importers, domestic buyers, exporters purchasing coffee |
| /for-suppliers | Farmers, cooperatives, traders, licensed exporters offering coffee |
| /coffee-origins | Five indicative regional profiles; not stock or public offers |
| /contact | General Manager, Addis Ababa location, email, telephone, WhatsApp |

Contact links use mailto:, tel:, and https://wa.me/251926329275; they send nothing automatically. The contact page also includes a guest inquiry form backed by authorized server ingress and private staff processing. It requires the approved trusted proxy and server-only configuration; a visible form alone does not establish operational intake. See the controlled-staging runbook in review/phase1-controlled-staging-operating-runbook.md.

ET Link manually reviews and matches requests. Offers and negotiated prices remain private; identities are disclosed only at approved stages. Sample acceptance does not reserve stock. Commercial terms and commissions must be confirmed before progression. ET Link is not an escrow service, payment processor, or exporter of record. Exporters can buy or supply depending on the transaction.

The historical Phase 1B public website has been preserved while Phase 1 secure-foundation functionality was added. Previously developed Phase 2 local candidates are retained, but are not enabled or extended by the current Phase 1 approval. Samples, allocations, financial progression and public trading remain outside this milestone.

## Branding and assets

Approved originals remain in brand-references/. Optimized public assets:
- public/brand/orbital-bean.webp: resized Gold orbital coffee bean symbol.png, used in header, footer, homepage seal, and favicon.
- public/brand/brand-signature.webp: resized ET LINK gold logo on forest green.png, used on home/about and social metadata.
- public/brand/coffee-cherries.webp: cropped coffee-cherry illustration from ET Link Ethiopian Coffee Brand Board.png, used in the hero and origins banner.

These three files total about 138 KB. Next Image provides responsive image delivery; fonts are locally bundled with Fontsource. The brand-board imagery is illustrative, not a representation of actual stock, farms, or suppliers.

Colors: forest #174B3A, deep evergreen #102C24, coffee gold #C99A50, ivory #F2E8D2, coffee brown #30251F. Headings use Playfair Display; body and UI use Inter.

Regional descriptions are indicative, sourced from the Ethiopian Coffee and Tea Authority specialty coffee booklet linked on the origins page. Individual lots require sample evaluation.

## Structure

- src/app/: seven public pages plus private account, business, inquiry and staff routes, shared layout, metadata, robots.txt and sitemap.xml.
- src/components/layout/: shared header with responsive disclosure navigation, and footer.
- src/components/public-site.tsx: shared introductions, actions, trade safeguards, and contact CTA.
- src/components/audience-page.tsx: buyer and supplier page structure.
- src/lib/trade-process.ts: shared process content.
- src/lib/supabase/client.ts: unchanged optional Supabase foundation.
- review/: local review screenshots and validation notes.
- AGENTS.md: generated by the installed Next.js development server.

SEO uses etlinkcoffee.com for the metadata base, sitemap, and robots reference; confirm domain ownership and deployment settings before publication. Each public page has a title and description. Open Graph and Twitter metadata use the approved signature asset.

## Validation

```powershell
npm run lint
npm run typecheck
npm run build
npm start
```

The historical public-site validation is preserved in review/validation.md. Current Phase 1 evidence records 73 passing Node tests, 16 configured browser tests, one unconfigured fail-closed browser test and eight security probes; lint and isolated build/TypeScript checks passed. The local fixture uses fake credentials and sends no real email. See review/phase1-recovery-confirmation-local-report-20261105.md. These are local results, not production approval or proof of hosted recovery delivery.

Next dev may regenerate next-env.d.ts to reference .next/dev/types; the production build regenerates production type references. It also generates AGENTS.md. These are framework behavior.

## Dependency audit

Historical review, November 2, 2026 (not a current dependency certification):
- Full npm audit: 16 moderate findings in the development linting dependency chain, rooted in the minimatch globparts amplification advisory (GHSA-g3hv-75wg-m249).
- npm audit --omit=dev: zero reported vulnerabilities.
- npm reports ESLint 9.39.5 as unsupported.
- The audit's force-fix suggestions include incompatible downgrades; none were applied. Review compatible upstream tooling updates separately.

That original public-site report predates later Phase 1 dependency additions. Do not infer that current package files are unchanged from Phase 1B. Any dependency audit is point-in-time evidence, not a security guarantee; incompatible force fixes must not be applied automatically.
