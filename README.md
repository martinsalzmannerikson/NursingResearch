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

## Manual Operations

Set a non-default `REFRESH_TOKEN`, then call:

```bash
curl "https://YOUR_SITE.netlify.app/api/refresh?token=YOUR_TOKEN"
```

or:

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" "https://YOUR_SITE.netlify.app/api/refresh"
```

The endpoint never returns the secret value.

Resolve OpenAlex sources before the first article refresh:

```bash
curl "https://YOUR_SITE.netlify.app/api/resolve-sources?token=YOUR_TOKEN"
```

The protected resolver is incremental. Each call processes one small batch, stores progress in Netlify Blobs, and returns `processed`, `remaining`, `resolvedSourceCount`, `unresolvedJournalCount`, `completed`, `nextStartIndex`, and `lastCompletedJournal`. Resolving all 366 journals may require multiple calls:

```bash
curl "https://YOUR_SITE.netlify.app/api/resolve-sources?token=YOUR_TOKEN"
curl "https://YOUR_SITE.netlify.app/api/resolve-sources?token=YOUR_TOKEN"
curl "https://YOUR_SITE.netlify.app/api/resolve-sources?token=YOUR_TOKEN"
```

Continue until `completed` is `true`, then run `/api/refresh`. Article refresh remains disabled until at least one OpenAlex source has been resolved successfully.

## Environment Variables

Copy `.env.example` for local development:

```bash
OPENALEX_API_KEY=
OPENALEX_MAILTO=
REFRESH_TOKEN=change-me
RECENT_DAYS=90
MAX_RESULTS=1000
OPENALEX_MAX_PAGES_PER_CHUNK=1
OPENALEX_RESOLVE_BATCH_SIZE=10
OPENALEX_RESOLVE_DELAY_MS=750
```

`OPENALEX_API_KEY` is optional for static local UI development, but production source resolution and daily refreshes should use both `OPENALEX_API_KEY` and `OPENALEX_MAILTO`.

## Netlify Deploy

`netlify.toml` configures:

- build command: `npm run normalize && npm run build`
- publish directory: `dist`
- functions directory: `netlify/functions`
- scheduled function: `update-latest` with `0 5 * * *` for daily updates at 05:00 UTC
- API redirects for `/api/latest`, `/api/status`, `/api/refresh`, and `/api/resolve-sources`

Set environment variables in the Netlify UI or CLI before production deploy.

## Production Operating Sequence

A. Add Netlify environment variables:

```bash
OPENALEX_API_KEY
OPENALEX_MAILTO
REFRESH_TOKEN
RECENT_DAYS=90
MAX_RESULTS=1000
OPENALEX_MAX_PAGES_PER_CHUNK=1
OPENALEX_RESOLVE_BATCH_SIZE=10
OPENALEX_RESOLVE_DELAY_MS=750
```

B. Deploy production.

C. Run source resolution manually:

```text
https://nursing-research-monitor.netlify.app/api/resolve-sources?token=YOUR_REFRESH_TOKEN
```

Repeat the resolver URL until `completed` is `true` or until `/api/status` reports `sourceResolutionRemaining: 0`.

D. Then run article refresh manually:

```text
https://nursing-research-monitor.netlify.app/api/refresh?token=YOUR_REFRESH_TOKEN
```

E. Check:

```text
https://nursing-research-monitor.netlify.app/api/status
https://nursing-research-monitor.netlify.app/api/latest
```

F. Confirm that the scheduled function updates once per day at 05:00 UTC.

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

OpenAlex source matching is probabilistic because the manifest intentionally starts with blank OpenAlex and ISSN fields. Exact and medium-confidence title matches are accepted automatically; low-confidence candidates are recorded but not silently accepted by the protected Netlify resolver. Remaining unresolved or warning rows are documented in `src/data/unresolved-journals.csv` and, after production resolution, in the Netlify Blob `unresolved-journals.json`.

OpenAlex may index ahead-of-print articles, corrections, or records with incomplete abstracts. The UI keeps those records readable and transparent but does not replace scholarly review of each citation.
