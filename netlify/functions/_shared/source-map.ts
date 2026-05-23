import { getStore } from "@netlify/blobs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { STORE_NAME, UPDATE_FREQUENCY, UPDATE_SCHEDULE } from "../../../scripts/lib/openalex.mjs";

export const SOURCE_MAP_KEY = "openalex-source-map.json";

export type SourceMapEntry = {
  journal_id?: string;
  journal_name?: string;
  status?: string;
  confidence?: number;
  warning?: string;
  openalex_source_id?: string;
  openalex_source_key?: string;
  [key: string]: unknown;
};

export type SourceMapDocument = {
  metadata?: Record<string, unknown>;
  sources?: SourceMapEntry[];
};

export type SourceMapSource = "static" | "blob";

export function summarizeSources(entries: SourceMapEntry[]) {
  return {
    totalJournalCount: entries.length,
    resolvedHighCount: entries.filter((entry) => entry.status === "resolved_high").length,
    resolvedMediumCount: entries.filter((entry) => entry.status === "resolved_medium").length,
    resolvedLowCount: entries.filter((entry) => entry.status === "resolved_low").length,
    resolvedSourceCount: entries.filter((entry) => Boolean(entry.openalex_source_id)).length,
    unresolvedJournalCount: entries.filter((entry) => !entry.openalex_source_id).length
  };
}

function asSourceMapDocument(value: unknown): SourceMapDocument | null {
  if (!value || typeof value !== "object") return null;
  const document = value as SourceMapDocument;
  return Array.isArray(document.sources) ? document : null;
}

async function loadStaticSourceMap(errors: string[]) {
  try {
    const sourceMapPath = path.join(process.cwd(), "src/data/openalex-source-map.json");
    return asSourceMapDocument(JSON.parse(await readFile(sourceMapPath, "utf8")));
  } catch (error) {
    errors.push(`Static source map read failed: ${(error as Error).message}`);
    return null;
  }
}

async function loadBlobSourceMap(errors: string[]) {
  try {
    const store = getStore({ name: STORE_NAME, consistency: "strong" });
    return asSourceMapDocument(await store.get(SOURCE_MAP_KEY, { type: "json" }));
  } catch (error) {
    errors.push(`Blob source map read failed: ${(error as Error).message}`);
    return null;
  }
}

function sourceInfo(source: SourceMapSource, document: SourceMapDocument, errors: string[]) {
  const sources = document.sources ?? [];
  return {
    source,
    document,
    sources,
    generatedAt: String(document.metadata?.generated_at ?? ""),
    sourceMapStage: "final",
    stats: summarizeSources(sources),
    errors
  };
}

export async function loadSourceMapDocument() {
  const errors: string[] = [];
  const staticDocument = await loadStaticSourceMap(errors);
  const blobDocument = await loadBlobSourceMap(errors);

  const staticResolved = staticDocument ? summarizeSources(staticDocument.sources ?? []).resolvedSourceCount : 0;
  const blobResolved = blobDocument ? summarizeSources(blobDocument.sources ?? []).resolvedSourceCount : 0;

  if (staticDocument && staticResolved > 0) return sourceInfo("static", staticDocument, errors);
  if (blobDocument && blobResolved > 0) return sourceInfo("blob", blobDocument, errors);
  if (staticDocument) return sourceInfo("static", staticDocument, errors);
  if (blobDocument) return sourceInfo("blob", blobDocument, errors);

  return sourceInfo("static", { metadata: {}, sources: [] }, errors);
}

export function extendStatus(
  status: Record<string, unknown>,
  sourceInfoValue: Awaited<ReturnType<typeof loadSourceMapDocument>>,
  itemCount: number,
  articleFetchAt: string | null,
  errors: string[]
) {
  return {
    ...status,
    lastUpdated: articleFetchAt ?? status.lastUpdated ?? null,
    lastArticleFetchAt: articleFetchAt,
    activeSourceMap: sourceInfoValue.source,
    totalJournalCount: sourceInfoValue.stats.totalJournalCount,
    resolvedSourceCount: sourceInfoValue.stats.resolvedSourceCount,
    unresolvedJournalCount: sourceInfoValue.stats.unresolvedJournalCount,
    lastSourceResolutionAt: sourceInfoValue.generatedAt || null,
    itemCount,
    sourceResolutionEnabled: false,
    sourceResolutionMode: "github-actions-or-local-script",
    sourceResolutionProgress: null,
    sourceResolutionCompleted: sourceInfoValue.stats.resolvedSourceCount > 0,
    sourceResolutionRemaining: sourceInfoValue.stats.unresolvedJournalCount,
    updateFrequency: UPDATE_FREQUENCY,
    schedule: UPDATE_SCHEDULE,
    errors,
    openAlexErrors: errors
  };
}
