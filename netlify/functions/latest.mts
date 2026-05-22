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

function cleanStatusErrors(status: Record<string, unknown>, resolvedSourceCount: number) {
  if (resolvedSourceCount === 0 || !Array.isArray(status.errors)) return status;
  const errors = (status.errors as string[]).filter(
    (error) => !/No resolved OpenAlex source IDs|No resolved source IDs/i.test(error)
  );
  const openAlexErrors = Array.isArray(status.openAlexErrors)
    ? (status.openAlexErrors as string[]).filter(
        (error) => !/No resolved OpenAlex source IDs|No resolved source IDs/i.test(error)
      )
    : status.openAlexErrors;
  return { ...status, errors, openAlexErrors };
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

  const mergedStatus = cleanStatusErrors(
    {
      ...(latest.status ?? {}),
      ...(blobStatus ?? {}),
      activeSourceMap: sourceInfo.source,
      totalJournalCount: sourceInfo.stats.totalJournalCount,
      resolvedSourceCount: sourceInfo.stats.resolvedSourceCount,
      unresolvedJournalCount: sourceInfo.stats.unresolvedJournalCount,
      lastSourceResolutionAt: sourceInfo.generatedAt || null,
      sourceResolutionEnabled: false,
      sourceResolutionMode: "github-actions-or-local-script",
      sourceResolutionProgress: null,
      sourceResolutionCompleted: sourceInfo.stats.resolvedSourceCount > 0,
      sourceResolutionRemaining: sourceInfo.stats.unresolvedJournalCount,
      updateFrequency: "daily",
      schedule: "0 5 * * *"
    },
    sourceInfo.stats.resolvedSourceCount
  );

  return jsonResponse(
    {
      ...latest,
      status: mergedStatus
    },
    { headers: cacheHeaders }
  );
};

export const config: Config = {};
