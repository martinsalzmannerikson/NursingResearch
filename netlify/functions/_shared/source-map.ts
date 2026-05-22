import { getStore } from "@netlify/blobs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { STORE_NAME, UPDATE_FREQUENCY, UPDATE_SCHEDULE } from "../../../scripts/lib/openalex.mjs";

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

export type SourceMapSource = "blob" | "static";

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

export async function loadSourceMapDocument() {
  const errors: string[] = [];

  try {
    const store = getStore({ name: STORE_NAME, consistency: "strong" });
    const blobDocument = asSourceMapDocument(await store.get("openalex-source-map.json", { type: "json" }));
    if (blobDocument) {
      const sources = blobDocument.sources ?? [];
      return {
        source: "blob" as SourceMapSource,
        document: blobDocument,
        sources,
        generatedAt: String(blobDocument.metadata?.generated_at ?? ""),
        stats: summarizeSources(sources),
        errors
      };
    }
  } catch (error) {
    errors.push(`Blob source map read failed: ${(error as Error).message}`);
  }

  try {
    const sourceMapPath = path.join(process.cwd(), "src/data/openalex-source-map.json");
    const staticDocument = asSourceMapDocument(JSON.parse(await readFile(sourceMapPath, "utf8")));
    if (staticDocument) {
      const sources = staticDocument.sources ?? [];
      return {
        source: "static" as SourceMapSource,
        document: staticDocument,
        sources,
        generatedAt: String(staticDocument.metadata?.generated_at ?? ""),
        stats: summarizeSources(sources),
        errors
      };
    }
  } catch (error) {
    errors.push(`Static source map read failed: ${(error as Error).message}`);
  }

  return {
    source: "static" as SourceMapSource,
    document: { metadata: {}, sources: [] },
    sources: [],
    generatedAt: "",
    stats: summarizeSources([]),
    errors
  };
}

export function extendStatus(
  status: Record<string, unknown>,
  sourceInfo: Awaited<ReturnType<typeof loadSourceMapDocument>>,
  itemCount: number,
  articleFetchAt: string | null,
  errors: string[]
) {
  return {
    ...status,
    lastUpdated: articleFetchAt ?? status.lastUpdated ?? null,
    lastArticleFetchAt: articleFetchAt,
    activeSourceMap: sourceInfo.source,
    resolvedSourceCount: sourceInfo.stats.resolvedSourceCount,
    unresolvedJournalCount: sourceInfo.stats.unresolvedJournalCount,
    lastSourceResolutionAt: sourceInfo.generatedAt || null,
    itemCount,
    updateFrequency: UPDATE_FREQUENCY,
    schedule: UPDATE_SCHEDULE,
    errors,
    openAlexErrors: errors
  };
}
