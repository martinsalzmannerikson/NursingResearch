import { getStore } from "@netlify/blobs";
import { getEnv } from "./env.js";
import { extendStatus, loadSourceMapDocument } from "./source-map.js";
import { fetchLatestWorks, latestFallback, STORE_NAME } from "../../../scripts/lib/openalex.mjs";

export async function runLatestUpdate() {
  const sourceInfo = await loadSourceMapDocument();
  const sourceMap = sourceInfo.sources;
  const days = Number(getEnv("RECENT_DAYS", "90"));
  const maxResults = Number(getEnv("MAX_RESULTS", "1000"));
  const maxPagesPerChunk = Number(getEnv("OPENALEX_MAX_PAGES_PER_CHUNK", "1"));
  let latest;
  const fetchLatest = fetchLatestWorks as (
    entries: unknown[],
    options: Record<string, unknown>
  ) => Promise<{
    status: { errors: string[] };
    items: unknown[];
    metadata?: Record<string, unknown>;
  }>;
  const makeFallback = latestFallback as (options: Record<string, unknown>) => {
    status: { errors: string[] };
    items: unknown[];
    metadata?: Record<string, unknown>;
  };

  const sourceErrors = [...sourceInfo.errors];
  if (sourceInfo.stats.resolvedSourceCount === 0) {
    latest = makeFallback({
      sourceMap,
      errors: [
        `No resolved OpenAlex source IDs in ${sourceInfo.source} source map. Resolve sources with npm run resolve:sources or the GitHub Actions workflow, then commit src/data/openalex-source-map.json.`
      ],
      days,
      maxResults
    });
    latest.metadata = {
      ...(latest.metadata ?? {}),
      diagnosticFallback: true,
      activeSourceMap: sourceInfo.source
    };
  } else {
    try {
      latest = await fetchLatest(sourceMap, {
        days,
        maxResults,
        env: {
          OPENALEX_API_KEY: getEnv("OPENALEX_API_KEY"),
          OPENALEX_MAILTO: getEnv("OPENALEX_MAILTO")
        },
        maxPagesPerChunk
      });
    } catch (error) {
      latest = makeFallback({
        sourceMap,
        errors: [`OpenAlex update failed: ${(error as Error).message}`],
        days,
        maxResults
      });
      latest.metadata = {
        ...(latest.metadata ?? {}),
        diagnosticFallback: true,
        activeSourceMap: sourceInfo.source
      };
    }
  }

  const articleFetchAt = String(latest.metadata?.generated_at ?? new Date().toISOString());
  const errors = [...new Set([...(latest.status.errors ?? []), ...sourceErrors])];
  latest.status = extendStatus(latest.status, sourceInfo, latest.items.length, articleFetchAt, errors);

  let blobStored = false;
  try {
    const store = getStore({ name: STORE_NAME, consistency: "strong" });
    await store.setJSON("latest.json", latest);
    await store.setJSON("status.json", latest.status);
    blobStored = true;
  } catch (error) {
    latest.status.errors = [
      ...(latest.status.errors || []),
      `Netlify Blobs write failed; static fallback remains active: ${(error as Error).message}`
    ];
  }

  return {
    ok: blobStored && sourceInfo.stats.resolvedSourceCount > 0 && (errors.length === 0 || latest.items.length > 0),
    blobStored,
    activeSourceMap: sourceInfo.source,
    status: latest.status,
    itemCount: latest.items.length
  };
}
