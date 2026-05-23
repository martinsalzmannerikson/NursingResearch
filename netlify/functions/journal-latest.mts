import type { Config } from "@netlify/functions";
import { jsonResponse } from "./_shared/env.js";
import { loadSourceMapDocument, type SourceMapEntry } from "./_shared/source-map.js";
import { fetchLatestWorks } from "../../scripts/lib/openalex.mjs";

const cacheHeaders = {
  "Cache-Control": "public, max-age=300, stale-while-revalidate=3600"
};

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function requestedDays(value: string | null) {
  const days = Number(value || 180);
  if (!Number.isFinite(days)) return 180;
  return Math.min(365, Math.max(7, days));
}

function findJournalSource(sources: SourceMapEntry[], journalQuery: string) {
  const query = normalizeText(journalQuery);
  if (!query) return null;
  const resolved = sources.filter((entry) => entry.openalex_source_id && entry.openalex_source_key);
  return (
    resolved.find((entry) => normalizeText(entry.journal_id) === query) ??
    resolved.find((entry) => normalizeText(entry.journal_name) === query) ??
    resolved.find((entry) => normalizeText(entry.display_name) === query) ??
    resolved.find((entry) => normalizeText(entry.journal_name).includes(query)) ??
    resolved.find((entry) => normalizeText(entry.display_name).includes(query)) ??
    null
  );
}

export default async (request: Request) => {
  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405, headers: cacheHeaders });
  }

  const url = new URL(request.url);
  const journal = url.searchParams.get("journal") ?? url.searchParams.get("journal_id") ?? "";
  const days = requestedDays(url.searchParams.get("days"));
  const sourceInfo = await loadSourceMapDocument();
  const source = findJournalSource(sourceInfo.sources, journal);

  if (!source) {
    return jsonResponse(
      {
        status: {
          lastUpdated: null,
          itemCount: 0,
          resolvedSourceCount: sourceInfo.stats.resolvedSourceCount,
          unresolvedJournalCount: sourceInfo.stats.unresolvedJournalCount,
          activeSourceMap: sourceInfo.source,
          errors: [`No resolved OpenAlex source found for journal: ${journal || "(blank)"}`],
          openAlexErrors: []
        },
        items: []
      },
      { status: 404, headers: cacheHeaders }
    );
  }

  const latest = await (fetchLatestWorks as (
    entries: SourceMapEntry[],
    options: Record<string, unknown>
  ) => Promise<Record<string, unknown>>)([source], {
    days,
    maxResults: 1000,
    maxPagesPerChunk: 5,
    env: {
      OPENALEX_API_KEY: process.env.OPENALEX_API_KEY,
      OPENALEX_MAILTO: process.env.OPENALEX_MAILTO
    }
  });

  const payload = latest as {
    metadata?: Record<string, unknown>;
    status?: Record<string, unknown>;
    items?: unknown[];
    [key: string]: unknown;
  };

  return jsonResponse(
    {
      ...payload,
      metadata: {
        ...(payload.metadata ?? {}),
        journalQuery: journal,
        activeSourceMap: sourceInfo.source
      },
      status: {
        ...(payload.status ?? {}),
        activeSourceMap: sourceInfo.source,
        resolvedSourceCount: sourceInfo.stats.resolvedSourceCount,
        unresolvedJournalCount: sourceInfo.stats.unresolvedJournalCount,
        totalJournalCount: sourceInfo.stats.totalJournalCount,
        selectedJournal: source.journal_name || source.display_name,
        itemCount: payload.items?.length ?? 0
      }
    },
    { headers: cacheHeaders }
  );
};

export const config: Config = {};
