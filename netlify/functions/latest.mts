import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { jsonResponse } from "./_shared/env.js";
import { readStaticJson } from "./_shared/static.js";
import { loadSourceMapDocument } from "./_shared/source-map.js";
import { STORE_NAME } from "../../scripts/lib/openalex.mjs";

type LatestPayload = {
  status?: Record<string, unknown>;
  items?: unknown[];
  [key: string]: unknown;
};

const cacheHeaders = {
  "Cache-Control": "public, max-age=60, stale-while-revalidate=600"
};

async function getBlobJson<T>(key: string) {
  try {
    const store = getStore({ name: STORE_NAME, consistency: "strong" });
    return (await store.get(key, { type: "json" })) as T | null;
  } catch (error) {
    console.warn(`Blob read failed for ${key}: ${(error as Error).message}`);
    return null;
  }
}

export default async (request: Request) => {
  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405, headers: cacheHeaders });
  }

  const blobLatest = await getBlobJson<LatestPayload>("latest.json");
  const staticLatest = await readStaticJson<LatestPayload>("public/data/latest.json");
  const latest = blobLatest ?? staticLatest ?? { status: { errors: ["No latest dataset available."] }, items: [] };
  const blobStatus = await getBlobJson<Record<string, unknown>>("status.json");
  const sourceInfo = await loadSourceMapDocument();
  const progress = sourceInfo.progress;

  return jsonResponse(
    {
      ...latest,
      status: {
        ...(latest.status ?? {}),
        ...(blobStatus ?? {}),
        activeSourceMap: sourceInfo.source,
        totalJournalCount: sourceInfo.stats.totalJournalCount,
        resolvedSourceCount: sourceInfo.stats.resolvedSourceCount,
        unresolvedJournalCount: sourceInfo.stats.unresolvedJournalCount,
        lastSourceResolutionAt: sourceInfo.generatedAt || null,
        sourceResolutionProgress: progress?.nextStartIndex ?? progress?.currentIndex ?? null,
        sourceResolutionCompleted: Boolean(progress?.completed),
        sourceResolutionRemaining: progress?.remaining ?? null,
        updateFrequency: "daily",
        schedule: "0 5 * * *"
      }
    },
    { headers: cacheHeaders }
  );
};

export const config: Config = {};
