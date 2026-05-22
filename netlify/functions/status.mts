import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { jsonResponse } from "./_shared/env.js";
import { readStaticJson } from "./_shared/static.js";
import { loadSourceMapDocument } from "./_shared/source-map.js";
import { STORE_NAME } from "../../scripts/lib/openalex.mjs";

const cacheHeaders = {
  "Cache-Control": "public, max-age=60, stale-while-revalidate=600"
};

function cleanStatusErrors(errors: string[], resolvedSourceCount: number) {
  if (resolvedSourceCount === 0) return errors;
  return errors.filter((error) => !/No resolved OpenAlex source IDs|No resolved source IDs/i.test(error));
}

export default async (request: Request) => {
  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405, headers: cacheHeaders });
  }

  const sourceInfo = await loadSourceMapDocument();
  let articleStatus: Record<string, unknown> = {};
  try {
    const store = getStore({ name: STORE_NAME, consistency: "strong" });
    const status = await store.get("status.json", { type: "json" });
    if (status && typeof status === "object") articleStatus = status as Record<string, unknown>;
  } catch (error) {
    console.warn(`Blob status read failed: ${(error as Error).message}`);
  }

  if (Object.keys(articleStatus).length === 0) {
    articleStatus = (await readStaticJson<Record<string, unknown>>("public/data/status.json")) ?? {};
  }

  const errors = cleanStatusErrors(
    [
      ...((Array.isArray(articleStatus.errors) ? articleStatus.errors : []) as string[]),
      ...sourceInfo.errors
    ],
    sourceInfo.stats.resolvedSourceCount
  );
  const lastArticleFetchAt = String(articleStatus.lastArticleFetchAt ?? articleStatus.lastUpdated ?? "") || null;

  return jsonResponse(
    {
      ...articleStatus,
      activeSourceMap: sourceInfo.source,
      resolvedSourceCount: sourceInfo.stats.resolvedSourceCount,
      unresolvedJournalCount: sourceInfo.stats.unresolvedJournalCount,
      lastSourceResolutionAt: sourceInfo.generatedAt || null,
      lastArticleFetchAt,
      itemCount: Number(articleStatus.itemCount ?? 0),
      totalJournalCount: sourceInfo.stats.totalJournalCount,
      sourceResolutionEnabled: false,
      sourceResolutionMode: "github-actions-or-local-script",
      sourceResolutionProgress: null,
      sourceResolutionCompleted: sourceInfo.stats.resolvedSourceCount > 0,
      sourceResolutionRemaining: sourceInfo.stats.unresolvedJournalCount,
      updateFrequency: "daily",
      schedule: "0 5 * * *",
      errors,
      openAlexErrors: errors
    },
    { headers: cacheHeaders }
  );
};

export const config: Config = {};
