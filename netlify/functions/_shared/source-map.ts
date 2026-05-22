import { getStore } from "@netlify/blobs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { STORE_NAME, UPDATE_FREQUENCY, UPDATE_SCHEDULE } from "../../../scripts/lib/openalex.mjs";

export const SOURCE_MAP_KEY = "openalex-source-map.json";
export const SOURCE_MAP_PARTIAL_KEY = "openalex-source-map.partial.json";
export const UNRESOLVED_JOURNALS_KEY = "unresolved-journals.json";
export const UNRESOLVED_JOURNALS_PARTIAL_KEY = "unresolved-journals.partial.json";
export const SOURCE_RESOLUTION_PROGRESS_KEY = "source-resolution-progress.json";
export const SOURCE_RESOLUTION_STATUS_KEY = "source-resolution-status.json";

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

export type SourceResolutionProgress = {
  currentIndex?: number;
  nextStartIndex?: number;
  totalJournalCount?: number;
  batchSize?: number;
  processed?: number;
  remaining?: number;
  resolvedSourceCount?: number;
  unresolvedJournalCount?: number;
  completed?: boolean;
  startedAt?: string;
  updatedAt?: string;
  lastCompletedJournal?: string;
  stoppedEarly?: boolean;
  error?: string;
};

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

function asProgressDocument(value: unknown): SourceResolutionProgress | null {
  if (!value || typeof value !== "object") return null;
  return value as SourceResolutionProgress;
}

export async function getMonitorStore() {
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

export async function loadSourceResolutionProgress() {
  try {
    const store = await getMonitorStore();
    return (
      asProgressDocument(await store.get(SOURCE_RESOLUTION_PROGRESS_KEY, { type: "json" })) ??
      asProgressDocument(await store.get(SOURCE_RESOLUTION_STATUS_KEY, { type: "json" }))
    );
  } catch (error) {
    console.warn(`Blob source resolution progress read failed: ${(error as Error).message}`);
    return null;
  }
}

export async function loadSourceMapDocument() {
  const errors: string[] = [];

  try {
    const store = await getMonitorStore();
    const progress =
      asProgressDocument(await store.get(SOURCE_RESOLUTION_PROGRESS_KEY, { type: "json" })) ??
      asProgressDocument(await store.get(SOURCE_RESOLUTION_STATUS_KEY, { type: "json" }));
    const partialDocument = asSourceMapDocument(await store.get(SOURCE_MAP_PARTIAL_KEY, { type: "json" }));
    const blobDocument = asSourceMapDocument(await store.get(SOURCE_MAP_KEY, { type: "json" }));
    if (progress && !progress.completed && partialDocument) {
      const partialSources = partialDocument.sources ?? [];
      const partialStats = summarizeSources(partialSources);
      const finalStats = summarizeSources(blobDocument?.sources ?? []);
      if (partialStats.resolvedSourceCount > finalStats.resolvedSourceCount) {
        return {
          source: "blob" as SourceMapSource,
          document: partialDocument,
          sources: partialSources,
          generatedAt: String(partialDocument.metadata?.generated_at ?? progress.updatedAt ?? ""),
          stats: partialStats,
          progress,
          sourceMapStage: "partial",
          errors
        };
      }
    }

    if (blobDocument) {
      const sources = blobDocument.sources ?? [];
      return {
        source: "blob" as SourceMapSource,
        document: blobDocument,
        sources,
        generatedAt: String(blobDocument.metadata?.generated_at ?? ""),
        progress,
        sourceMapStage: "final",
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
        progress: await loadSourceResolutionProgress(),
        sourceMapStage: "static",
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
    progress: await loadSourceResolutionProgress(),
    sourceMapStage: "static",
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
    totalJournalCount: sourceInfo.stats.totalJournalCount,
    resolvedSourceCount: sourceInfo.stats.resolvedSourceCount,
    unresolvedJournalCount: sourceInfo.stats.unresolvedJournalCount,
    lastSourceResolutionAt: sourceInfo.generatedAt || null,
    itemCount,
    sourceResolutionProgress: sourceInfo.progress?.nextStartIndex ?? sourceInfo.progress?.currentIndex ?? null,
    sourceResolutionCompleted: Boolean(sourceInfo.progress?.completed),
    sourceResolutionRemaining: sourceInfo.progress?.remaining ?? null,
    updateFrequency: UPDATE_FREQUENCY,
    schedule: UPDATE_SCHEDULE,
    errors,
    openAlexErrors: errors
  };
}
