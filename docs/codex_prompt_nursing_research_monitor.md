# Prompt to paste into ChatGPT Codex 5.5 Pro

You are working in a GitHub repository. Build a production-ready Netlify web app called **Nursing Research Monitor**.

## Input data

Use the attached CSV file as the source journal manifest:

`nursing_journals_codex_ready.csv`

Place it in:

`src/data/nursing_journals_codex_ready.csv`

The CSV contains 366 nursing, omvårdnad, sykepleie, midwifery, palliative care, wound care, psychiatric nursing, critical care nursing, nursing education, nursing management and related care journals. Important columns:

- `journal_id`
- `journal_name`
- `journal_name_normalized`
- `title_variants`
- `publisher`
- `wos_core`
- `is_wos_core`
- `is_scopus`
- `norwegian_level`
- `norwegian_level_numeric`
- `include_in_monitor`
- `openalex_source_id`
- `issn_l`
- `issn_print`
- `issn_online`
- `source_resolution_status`
- `openalex_source_search_hint`

The OpenAlex/ISSN fields are blank by design. Your job is to build code that resolves them and caches the results.

## Target

Create a site that monitors the latest research from all journals in the CSV and updates once per day on Netlify.

The functional structure should resemble this reference page: a retro terminal-like research monitor with a prominent header, status line, research item feed, filters, and “load more” behavior. Do not clone the code or branding. Recreate the structure and behavior in an original implementation.

The visual style should resemble an old terminal / retro command-line interface: black CRT-like background, subtle scanlines, pixel/monospace typography, cyan/green/purple terminal accents, block cursor, command prompt line, status bars, and slightly rounded terminal panels. Avoid GitHub or Copilot branding. Use a generic retro terminal identity.

Suggested title:

`OMVÅRDNAD / NURSING RESEARCH MONITOR`

Suggested terminal header elements:

- `**** NURSING RESEARCH TERMINAL V1 ****`
- `LOAD "NURSING-RES",8,1`
- `SEARCHING... {visibleCount} ITEMS`
- `READY. CLR UPDATED: {lastUpdated} SOURCE: OPENALEX FILTER: JOURNAL + DOI`
- prompt line: `> search journals, titles, authors, abstracts`

## Architecture

Use a modern, maintainable TypeScript stack:

- Vite
- React
- TypeScript
- Netlify Functions
- Netlify Scheduled Functions
- Netlify Blobs for cached latest results
- Vitest for unit tests
- Playwright or a lightweight browser smoke test if feasible

Do not use a backend database. Use Netlify Blobs as the key/value store for the cached results.

## Data pipeline

Use OpenAlex as the primary source. Implement scripts/functions that do the following.

### 1. Normalize journals

Create:

`scripts/normalize-journals.mjs`

It should:

- read `src/data/nursing_journals_codex_ready.csv`
- validate required columns
- convert booleans/numeric fields properly
- write `src/data/journals.json`
- preserve all journal metadata
- expose all title variants as an array
- fail loudly on malformed CSV

### 2. Resolve OpenAlex sources

Create:

`scripts/resolve-openalex-sources.mjs`

It should:

- read `src/data/journals.json`
- for each unresolved journal, search OpenAlex Sources using `title_variants`
- prefer sources where `type === "journal"`
- score candidates by exact normalized title match, title variant match, ISSN match if available, publisher similarity, and works count
- write `src/data/openalex-source-map.json`
- write `src/data/unresolved-journals.csv`
- mark each row as `resolved_high`, `resolved_medium`, `resolved_low`, or `unresolved`
- do not accept low-confidence matches automatically unless they are the only plausible journal source; record a warning
- include `openalex_source_id`, `display_name`, `issn_l`, `issn`, `host_organization`, `works_count`, and `confidence`

Make this robust. Some journal names include alternative or translated titles, acronyms, commas, colons, and non-English characters.

### 3. Fetch latest works

Create:

`scripts/fetch-latest.mjs`

It should:

- read `src/data/openalex-source-map.json`
- collect resolved OpenAlex source IDs
- query OpenAlex Works in chunks of no more than 100 source IDs per request
- use filters roughly equivalent to:
  - primary source is one of the resolved journal source IDs
  - publication date is within a configurable recent window, default 90 days
  - type is article or review when possible
  - exclude retracted works when possible
- sort by publication date descending
- select only the fields needed by the UI
- reconstruct abstracts from `abstract_inverted_index`
- deduplicate by DOI first, then OpenAlex ID
- attach the matched journal metadata from the CSV
- cap output to the newest 1,000 items
- write `public/data/latest.json`

Each item should have:

- `id`
- `title`
- `doi`
- `openalex_id`
- `publication_date`
- `publication_year`
- `authors`
- `journal_name`
- `journal_id`
- `publisher`
- `wos_core`
- `is_wos_core`
- `is_scopus`
- `norwegian_level`
- `abstract`
- `url`
- `oa_url`
- `is_oa`
- `cited_by_count`
- `source_api`
- `fetched_at`

### 4. Netlify scheduled update

Create a scheduled function:

`netlify/functions/update-latest.mts`

It should:

- run daily using `export const config = { schedule: "0 5 * * *" }`
- fetch the latest works using the same logic as `scripts/fetch-latest.mjs`
- store the JSON result in Netlify Blobs under a stable key, for example:
  - store: `nursing-research-monitor`
  - key: `latest.json`
- also store a small status blob:
  - key: `status.json`
  - fields: `lastUpdated`, `itemCount`, `resolvedSourceCount`, `unresolvedJournalCount`, `errors`
- respect Netlify Scheduled Function time limits by batching OpenAlex calls efficiently
- log unresolved journals and API failures clearly
- never crash the site if OpenAlex is unavailable; keep serving the last successful blob or static fallback

### 5. Latest API function

Create:

`netlify/functions/latest.mts`

It should:

- return the blob `latest.json` if it exists
- otherwise return `public/data/latest.json`
- include cache headers with a short browser TTL and a stale-while-revalidate strategy
- include `status.json` metadata in the response or expose a second endpoint `/api/status`

### 6. Manual refresh function

Create:

`netlify/functions/refresh.mts`

It should:

- require a secret query param or bearer token using `REFRESH_TOKEN`
- run the same update logic
- return a clear JSON status
- never expose secret values

## UI requirements

Build a single-page React interface.

### Layout

Use these regions:

1. Terminal boot/header panel
2. Status/dashboard strip
3. Search and filter command panel
4. Publication feed
5. Journal/source diagnostics drawer
6. Footer with methodology and data-source note

### Filters

Implement filters for:

- free-text search across title, authors, abstract, journal
- journal name
- publisher
- Web of Science status: All, SCIE, SSCI, ESCI, Not WoS
- Scopus: All, Yes, No
- Norska listan: All, Level 1, Level 2, Not listed
- open access: All, OA only
- publication date: 7, 30, 90, 180 days
- sort: newest first, most cited, journal A-Z

### Publication cards

Each card should show:

- title
- authors, compacted after 3 authors
- journal name
- publication date
- DOI as link when present
- OpenAlex link
- OA/fulltext link when available
- badges: WoS, Scopus, Norska nivå, OA
- abstract preview with expand/collapse
- “Copy APA-ish citation” button

### Terminal interaction

Make the interface feel like a terminal without harming usability:

- command input updates the search field
- animated block cursor
- “LOAD MORE” button
- keyboard shortcut `/` focuses search
- keyboard shortcut `Esc` clears command/search
- aria labels and accessible color contrast
- responsive layout for mobile

## Styling

Create the look from scratch.

Use:

- black background
- CRT glow, subtle scanlines
- monospace font stack; optionally include a web-safe pixel-like header using CSS only
- cyan/green/purple accents
- thin terminal borders
- “phosphor” text shadows, but not so much that reading suffers
- card layout that remains academically readable

Do not copy the GitHub Copilot logo, wordmark, or exact artwork. The goal is a generic retro research terminal.

## Reliability and testing

You must not stop after scaffolding. Build, test, inspect, fix, and rerun.

Required checks:

1. `npm install`
2. `npm run normalize`
3. `npm run resolve:sources`
4. `npm run fetch:latest`
5. `npm run lint`
6. `npm run test`
7. `npm run build`

Add scripts to `package.json` for each command.

If any command fails, diagnose, fix the code, and rerun the command. Repeat until the app builds successfully and produces data.

Add unit tests for:

- CSV parsing
- title normalization
- OpenAlex abstract reconstruction
- DOI/OpenAlex deduplication
- filter logic
- APA-ish citation formatting

Add at least one smoke test that verifies:

- the home page renders
- the monitor title appears
- publication cards render when `latest.json` has data
- empty states render if there are no articles

Also test that the Netlify functions compile.

## Environment variables

Create `.env.example` with:

```bash
OPENALEX_API_KEY=
REFRESH_TOKEN=change-me
RECENT_DAYS=90
MAX_RESULTS=1000
```

If `OPENALEX_API_KEY` is absent, allow local development with unauthenticated OpenAlex requests, but warn that an API key is recommended for production-scale daily operation.

## Netlify configuration

Create `netlify.toml` with:

- build command: `npm run normalize && npm run build`
- publish directory: `dist`
- functions directory: `netlify/functions`
- any redirects needed so `/api/latest`, `/api/status`, and `/api/refresh` map to Netlify Functions

Make sure the scheduled function is deployed and configured.

## README

Write a README that explains:

- what the app does
- how to install and run locally
- how to attach the CSV
- how to resolve OpenAlex sources
- how to run the daily update locally/manually
- how to deploy on Netlify
- how to set environment variables
- what limitations remain, especially unresolved journal-source matches

## Acceptance criteria

The project is complete only when:

- the site builds with `npm run build`
- the UI is usable and visually matches the retro terminal brief
- the CSV is parsed correctly
- `public/data/latest.json` is generated successfully, or a clear fallback dataset is generated if no network is available
- Netlify functions compile
- scheduled update code exists and uses `0 5 * * *`
- the app handles API failures gracefully
- tests pass
- there are no TODO placeholders for core functionality
- unresolved journal matches are documented in `src/data/unresolved-journals.csv` or equivalent
- the final answer summarizes exactly what was built, what commands were run, and any remaining unresolved source matches

Do not ask me for clarification unless the repository is missing the CSV file. Make the best production-quality implementation now.
