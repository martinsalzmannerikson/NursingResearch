import { getStore } from "@netlify/blobs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getEnv } from "./env.js";
import { fetchLatestWorks, latestFallback, STORE_NAME } from "../../../scripts/lib/openalex.mjs";

type SourceMapDocument = {
  sources?: unknown[];
};

async function loadSourceMap() {
  try {
    const sourceMapPath = path.join(process.cwd(), "src/data/openalex-source-map.json");
    const parsed = JSON.parse(await readFile(sourceMapPath, "utf8")) as SourceMapDocument;
    return parsed.sources ?? [];
  } catch (error) {
    console.warn(`Could not read source map: ${(error as Error).message}`);
    return [];
  }
}

export async function runLatestUpdate() {
  const sourceMap = await loadSourceMap();
  const days = Number(getEnv("RECENT_DAYS", "90"));
  const maxResults = Number(getEnv("MAX_RESULTS", "1000"));
  let latest;
  const fetchLatest = fetchLatestWorks as (
    entries: unknown[],
    options: Record<string, unknown>
  ) => Promise<{
    status: { errors: string[] };
    items: unknown[];
  }>;
  const makeFallback = latestFallback as (options: Record<string, unknown>) => {
    status: { errors: string[] };
    items: unknown[];
  };

  try {
    latest = await fetchLatest(sourceMap, {
      days,
      maxResults,
      env: {
        OPENALEX_API_KEY: getEnv("OPENALEX_API_KEY"),
        OPENALEX_MAILTO: getEnv("OPENALEX_MAILTO")
      },
      maxPagesPerChunk: 2
    });
  } catch (error) {
    latest = makeFallback({
      sourceMap,
      errors: [`OpenAlex update failed: ${(error as Error).message}`],
      days,
      maxResults
    });
  }

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
    ok: latest.status.errors.length === 0 || latest.items.length > 0,
    blobStored,
    status: latest.status,
    itemCount: latest.items.length
  };
}
