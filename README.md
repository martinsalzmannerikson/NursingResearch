# Nursing Research Monitor

Retro terminal-style Netlify web app for monitoring recent nursing, omvårdnad, sykepleie, midwifery, palliative care, wound care, psychiatric nursing, critical care nursing, nursing education, nursing management, and related care publications.

The app uses the CSV manifest at `src/data/nursing_journals_codex_ready.csv`, resolves journal source IDs from OpenAlex, fetches recent OpenAlex Works, de-duplicates by DOI/OpenAlex ID, and caches the active dataset in Netlify Blobs. The static fallback lives at `public/data/latest.json`.

## Stack

- Vite, React, TypeScript
- Netlify Functions and Netlify Scheduled Functions
- Netlify Blobs for cached results
- OpenAlex Sources and Works APIs
- Vitest and Testing Library

## Install

```bash
npm install
```

## Data Files

The source CSV belongs at:

```bash
src/data/nursing_journals_codex_ready.csv
```

The CSV is the authoritative source. A copy of the original prompt and companion JSON inspected for this build are stored in `docs/`.

## Local Pipeline

Normalize the journal manifest:

```bash
npm run normalize
```

Resolve OpenAlex sources:

```bash
npm run resolve:sources
```

Fetch the latest works:

```bash
npm run fetch:latest
```

Generated files:

- `src/data/journals.json`
- `src/data/openalex-source-map.json`
- `src/data/unresolved-journals.csv`
- `public/data/latest.json`
- `public/data/status.json`

If OpenAlex is unavailable, `fetch:latest` writes a clear empty fallback payload instead of crashing the app.

## Run Locally

```bash
npm run dev
```

For Netlify Functions and local Blobs behavior, run through Netlify Dev after installing the Netlify CLI:

```bash
netlify dev
```

## Manual Refresh

Set a non-default `REFRESH_TOKEN`, then call:

```bash
curl "https://YOUR_SITE.netlify.app/api/refresh?token=YOUR_TOKEN"
```

or:

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" "https://YOUR_SITE.netlify.app/api/refresh"
```

The endpoint never returns the secret value.

## Environment Variables

Copy `.env.example` for local development:

```bash
OPENALEX_API_KEY=
REFRESH_TOKEN=change-me
RECENT_DAYS=90
MAX_RESULTS=1000
```

`OPENALEX_API_KEY` is optional locally. Production hourly refreshes should use an OpenAlex API key, or at least a polite-pool contact variable such as `OPENALEX_MAILTO`, to reduce rate-limit risk.

## Netlify Deploy

`netlify.toml` configures:

- build command: `npm run normalize && npm run build`
- publish directory: `dist`
- functions directory: `netlify/functions`
- scheduled function: `update-latest` with `@hourly`
- API redirects for `/api/latest`, `/api/status`, and `/api/refresh`

Set environment variables in the Netlify UI or CLI before production deploy.

## Checks

```bash
npm run normalize
npm run resolve:sources
npm run fetch:latest
npm run lint
npm run test
npm run build
```

## Limitations

OpenAlex source matching is probabilistic because the manifest intentionally starts with blank OpenAlex and ISSN fields. Exact or high-confidence title matches are accepted automatically; low-confidence matches are accepted only when they are the only plausible journal source and are flagged. Remaining unresolved or warning rows are documented in `src/data/unresolved-journals.csv`.

OpenAlex may index ahead-of-print articles, corrections, or records with incomplete abstracts. The UI keeps those records readable and transparent but does not replace scholarly review of each citation.
