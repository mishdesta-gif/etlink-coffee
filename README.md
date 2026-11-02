# ET Link Coffee

The foundation for an Ethiopian coffee B2B trading and business matching platform. Built with Next.js App Router, TypeScript, and Tailwind CSS v4. Marketplace and admin features are not implemented yet.

## Local setup

Use Node.js 24 LTS and npm (the lockfile pins dependencies).

```sh
npm ci
npm run dev
```

Open the development server at `http://localhost:3000`.

No credentials are required to run the homepage. Optionally copy `.env.example` to `.env.local` and supply your Supabase project URL and public publishable key when a project is available:

```sh
cp .env.example .env.local
```

Never place a Supabase service-role key or other secret in a `NEXT_PUBLIC_*` variable. These variables are included in the browser bundle. Local environment files are ignored by Git.

## Checks and production

```sh
npm run lint
npm run typecheck
npm run build
npm start
```

`npm start` serves the production build and requires `npm run build` first. No automated test suite exists yet; lint, TypeScript, production build, and an HTTP homepage smoke check are the initial validation workflow.

## Structure

- `src/app/`: root layout, homepage, metadata, and global styles.
- `src/components/layout/`: responsive site header and footer.
- `src/lib/supabase/client.ts`: optional lazy browser client; returns `null` without configuration. No database requests, authentication, or schema are included yet. Future callers must handle the unconfigured state.
- `public/`: approved static brand assets can be added here later.

## Brand foundation

Tailwind theme tokens in `src/app/globals.css`: `forest` (#174B3A), `deep-green` (#102C24), `gold` (#C99A50), and `ivory` (#F2E8D2). Playfair Display is used for headings; Inter for body text. Fontsource bundles both fonts locally, avoiding external font requests during builds and page loads.

The current logo is temporary typography. Approved logo files, imagery, and brand guidelines are still needed before replacing it.
