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

Source resolution must run outside Netlify. Use either the local script:

```bash
npm run normalize
npm run resolve:sources
git add src/data/journals.json src/data/openalex-source-map.json src/data/unresolved-journals.csv
git commit -m "Update OpenAlex source map"
git push
```

or run the GitHub Actions workflow **Resolve OpenAlex Sources** from the repository Actions tab. The workflow uses `OPENALEX_API_KEY` and `OPENALEX_MAILTO` GitHub secrets, writes `src/data/openalex-source-map.json`, and commits the updated static source map.

After at least one source has been resolved and committed, set a non-default `REFRESH_TOKEN`, then call:

```bash
curl "https://YOUR_SITE.netlify.app/api/refresh?token=YOUR_TOKEN"
```

or:

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" "https://YOUR_SITE.netlify.app/api/refresh"
```

The endpoint never returns the secret value.
`/api/resolve-sources` is intentionally disabled on Netlify to avoid consuming function runtime.
`/api/journal-latest?journal=JOURNAL_NAME&days=180` performs a lightweight, cached OpenAlex lookup for one resolved
journal. The frontend uses it when a journal filter is selected so journal-specific lists are not limited by the global
dashboard cache.

## Environment Variables

Copy `.env.example` for local development:

```bash
OPENALEX_API_KEY=
OPENALEX_MAILTO=
REFRESH_TOKEN=change-me
RECENT_DAYS=180
MAX_RESULTS=5000
OPENALEX_MAX_PAGES_PER_CHUNK=10
OPENALEX_RESOLVE_DELAY_MS=750
MAX_ARTICLES_PER_BRIEF=6
OPENROUTER_API_KEY=
OPENROUTER_MODEL=openai/gpt-5-mini
OPENROUTER_FALLBACK_MODELS=
OPENROUTER_REQUEST_TIMEOUT_MS=30000
OPENROUTER_SITE_URL=
OPENROUTER_APP_TITLE=Nursing Research Monitor
ALLOW_DETERMINISTIC_FALLBACK_PDF=false
```

`OPENALEX_API_KEY`, `OPENALEX_MAILTO`, and `OPENALEX_RESOLVE_DELAY_MS` are used by local/GitHub Actions source resolution. Netlify production does not run source resolution.
`OPENROUTER_API_KEY` and `OPENROUTER_MODEL` are used for AI findings brief jobs. The recommended production model is `openai/gpt-5-mini`, and the selected model is read server-side only.
`OPENROUTER_FALLBACK_MODELS` is optional. If set, it is parsed as a comma-separated priority list and sent to OpenRouter as a `models` array after the primary model.
`OPENROUTER_REQUEST_TIMEOUT_MS` controls how long the server waits for a usable model response.
`ALLOW_DETERMINISTIC_FALLBACK_PDF` defaults to `false`. When false, model failure returns a clear error and no PDF; when explicitly true, a fallback-notes PDF may be generated.

## Netlify Deploy

`netlify.toml` configures:

- build command: `npm run normalize && npm run build`
- publish directory: `dist`
- functions directory: `netlify/functions`
- scheduled function: `update-latest` with `0 5 * * *` for daily updates at 05:00 UTC
- API redirects for `/api/latest`, `/api/status`, `/api/journal-latest`, `/api/refresh`, and AI brief job endpoints
- `/api/resolve-sources` returns a static disabled response and does not invoke a function

Set environment variables in the Netlify UI or CLI before production deploy.

## Production Operating Sequence

A. Add GitHub repository secrets for the source-resolution workflow:

```bash
OPENALEX_API_KEY
OPENALEX_MAILTO
```

B. Run **Resolve OpenAlex Sources** in GitHub Actions, or run `npm run resolve:sources` locally and commit:

```bash
src/data/openalex-source-map.json
src/data/unresolved-journals.csv
```

C. Add Netlify environment variables:

```bash
REFRESH_TOKEN
RECENT_DAYS=180
MAX_RESULTS=5000
OPENALEX_MAX_PAGES_PER_CHUNK=10
MAX_ARTICLES_PER_BRIEF=6
OPENROUTER_API_KEY
OPENROUTER_MODEL=openai/gpt-5-mini
OPENROUTER_FALLBACK_MODELS=openai/gpt-5-nano,mistralai/mistral-small-3.2-24b-instruct
OPENROUTER_REQUEST_TIMEOUT_MS=30000
OPENROUTER_SITE_URL=https://nursing-research-monitor.netlify.app
OPENROUTER_APP_TITLE=Nursing Research Monitor
ALLOW_DETERMINISTIC_FALLBACK_PDF=false
```

D. Deploy production.

E. Run article refresh manually:

```text
https://nursing-research-monitor.netlify.app/api/refresh?token=YOUR_REFRESH_TOKEN
```

F. Check:

```text
https://nursing-research-monitor.netlify.app/api/status
https://nursing-research-monitor.netlify.app/api/latest
```

G. Confirm that the scheduled function updates once per day at 05:00 UTC.

## AI Findings Brief MVP

Users can select up to `MAX_ARTICLES_PER_BRIEF` articles and generate a PDF findings brief. The workflow is job based:

- `POST /api/start-summary-job` validates selected article metadata, stores a queued job in Netlify Blobs, and invokes the background function.
- `process-summary-background` checks DOI-first OpenAlex metadata, retrieves only legal OA locations reported by OpenAlex, extracts allowed Methods/Findings/Conclusions sections when reliable, sends a compact evidence package to the selected OpenRouter model, and stores the generated PDF in Netlify Blobs only when a usable Markdown synthesis is returned.
- If OpenRouter is unavailable, blocked by privacy/data-policy settings, rate-limited, or returns unusable output, the job becomes `failed_model_unavailable` and no PDF is created by default.
- `GET /api/get-summary-status?jobId=...` returns job progress and source-status summaries without returning extracted article text.
- `GET /api/download-summary-pdf?jobId=...` downloads the generated PDF.

Fallback hierarchy:

1. DOI + legal OA full text + reliable section extraction.
2. DOI + legal OA full text but extraction failed, with warning and abstract fallback.
3. Abstract only.
4. Insufficient data, clearly marked in the article source notes.

The app never uses subscription bypasses or Sci-Hub-style access. PDF parsing is conservative in this MVP: unsupported or unparsable full text falls back to abstract and records an extraction warning.

Local testing for brief jobs should use Netlify Dev so Blobs and background functions are available:

```bash
netlify dev
```

Set `OPENROUTER_API_KEY` and `OPENROUTER_MODEL=openai/gpt-5-mini` in the Netlify Dev environment before generating a live model-based brief. Optional: set `OPENROUTER_FALLBACK_MODELS` to explicitly allow additional paid/accessible models. The app does not silently inject free fallback models.

PDF visual QA: generate a brief locally through Netlify Dev or production, open the downloaded PDF in a normal PDF viewer, and confirm it has a light background, dark readable body text, complete main headings, no raw provider errors, and no workflow/audit page.

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
