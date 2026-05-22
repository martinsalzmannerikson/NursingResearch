import type { Config } from "@netlify/functions";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { requireRefreshToken } from "./_shared/auth.js";
import { getEnv, jsonResponse } from "./_shared/env.js";
import {
  getMonitorStore,
  loadSourceMapDocument,
  SOURCE_MAP_KEY,
  SOURCE_MAP_PARTIAL_KEY,
  SOURCE_RESOLUTION_PROGRESS_KEY,
  SOURCE_RESOLUTION_STATUS_KEY,
  UNRESOLVED_JOURNALS_KEY,
  UNRESOLVED_JOURNALS_PARTIAL_KEY
} from "./_shared/source-map.js";
import {
  isOpenAlexStopErrorMessage,
  resolveJournalSource,
  sourceMapStats,
  unresolvedRows
} from "../../scripts/lib/openalex.mjs";

type JournalManifest = {
  journals?: Array<Record<string, unknown>>;
};

type SourceMapEntry = {
  journal_id: string;
  journal_name: string;
  status: string;
  confidence: number;
  warning: string;
  openalex_source_id: string;
  openalex_source_key: string;
  display_name: string;
  issn_l: string;
  issn: string[];
  host_organization: string;
  works_count: number;
  candidates: unknown[];
  journal: Record<string, unknown>;
};

type ProgressDocument = {
  currentIndex: number;
  nextStartIndex: number;
  totalJournalCount: number;
  batchSize: number;
  processed: number;
  remaining: number;
  resolvedSourceCount: number;
  unresolvedJournalCount: number;
  completed: boolean;
  startedAt: string;
  updatedAt: string;
  lastCompletedJournal: string;
  stoppedEarly: boolean;
  error: string;
};

const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_SAFETY_TIMEOUT_MS = 20_000;

function sleep(ms: number) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function clampNumber(value: string, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

async function loadJournals() {
  const manifestPath = path.join(process.cwd(), "src/data/journals.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as JournalManifest;
  return (manifest.journals ?? []).filter((journal) => journal.include_in_monitor !== false);
}

function unresolvedEntry(journal: Record<string, unknown>, warning: string): SourceMapEntry {
  return {
    journal_id: String(journal.journal_id ?? ""),
    journal_name: String(journal.journal_name ?? ""),
    journal,
    status: "unresolved",
    confidence: 0,
    warning,
    openalex_source_id: "",
    openalex_source_key: "",
    display_name: "",
    issn_l: "",
    issn: [],
    host_organization: "",
    works_count: 0,
    candidates: []
  };
}

function hasAcceptedSource(entry: SourceMapEntry | undefined) {
  return Boolean(entry?.openalex_source_id && ["resolved_high", "resolved_medium"].includes(entry.status));
}

function entryByJournalId(entries: unknown[]) {
  return new Map(
    entries
      .filter((entry): entry is SourceMapEntry => Boolean(entry && typeof entry === "object"))
      .map((entry) => [String(entry.journal_id ?? ""), entry])
  );
}

function buildEntries(journals: Record<string, unknown>[], existingEntries: unknown[]) {
  const existingById = entryByJournalId(existingEntries);
  return journals.map((journal) => {
    const journalId = String(journal.journal_id ?? "");
    return existingById.get(journalId) ?? unresolvedEntry(journal, "Resolution pending; rerun the protected source resolver to continue.");
  });
}

function summarize(entries: SourceMapEntry[]) {
  return sourceMapStats(entries) as {
    totalJournalCount: number;
    resolvedHighCount: number;
    resolvedMediumCount: number;
    resolvedLowCount: number;
    resolvedSourceCount: number;
    unresolvedJournalCount: number;
  };
}

function progressBody(options: {
  currentIndex: number;
  nextStartIndex: number;
  totalJournalCount: number;
  batchSize: number;
  processed: number;
  entries: SourceMapEntry[];
  completed: boolean;
  startedAt: string;
  updatedAt: string;
  lastCompletedJournal: string;
  stoppedEarly: boolean;
  error: string;
}): ProgressDocument & {
  resolvedHighCount: number;
  resolvedMediumCount: number;
  resolvedLowCount: number;
} {
  const stats = summarize(options.entries);
  return {
    currentIndex: options.currentIndex,
    nextStartIndex: options.nextStartIndex,
    totalJournalCount: options.totalJournalCount,
    batchSize: options.batchSize,
    processed: options.processed,
    remaining: Math.max(0, options.totalJournalCount - options.nextStartIndex),
    resolvedSourceCount: stats.resolvedSourceCount,
    unresolvedJournalCount: stats.unresolvedJournalCount,
    resolvedHighCount: stats.resolvedHighCount,
    resolvedMediumCount: stats.resolvedMediumCount,
    resolvedLowCount: stats.resolvedLowCount,
    completed: options.completed,
    startedAt: options.startedAt,
    updatedAt: options.updatedAt,
    lastCompletedJournal: options.lastCompletedJournal,
    stoppedEarly: options.stoppedEarly,
    error: options.error
  };
}

async function loadBlobJson<T>(key: string) {
  try {
    const store = await getMonitorStore();
    return (await store.get(key, { type: "json" })) as T | null;
  } catch {
    return null;
  }
}

export default async (request: Request) => {
  if (!["GET", "POST"].includes(request.method)) {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  const authError = requireRefreshToken(request);
  if (authError) return authError;

  const apiKey = getEnv("OPENALEX_API_KEY");
  const mailto = getEnv("OPENALEX_MAILTO");
  if (!apiKey || !mailto) {
    const missingKeys = [
      !apiKey ? "OPENALEX_API_KEY" : "",
      !mailto ? "OPENALEX_MAILTO" : ""
    ].filter(Boolean);
    return jsonResponse(
      {
        error: `Missing required OpenAlex environment variables: ${missingKeys.join(", ")}.`,
        missingKeys
      },
      { status: 503 }
    );
  }

  const batchSize = clampNumber(getEnv("OPENALEX_RESOLVE_BATCH_SIZE", String(DEFAULT_BATCH_SIZE)), DEFAULT_BATCH_SIZE, 1, 50);
  const delayMs = clampNumber(getEnv("OPENALEX_RESOLVE_DELAY_MS", "750"), 750, 0, 10_000);
  const safetyTimeoutMs = clampNumber(
    getEnv("OPENALEX_RESOLVE_TIME_BUDGET_MS", String(DEFAULT_SAFETY_TIMEOUT_MS)),
    DEFAULT_SAFETY_TIMEOUT_MS,
    5_000,
    DEFAULT_SAFETY_TIMEOUT_MS
  );
  const startedAt = new Date().toISOString();
  const deadline = Date.now() + safetyTimeoutMs;
  const journals = await loadJournals();
  const totalJournalCount = journals.length;
  const store = await getMonitorStore();
  const previousProgress = await loadBlobJson<ProgressDocument>(SOURCE_RESOLUTION_PROGRESS_KEY);
  const sourceInfo = await loadSourceMapDocument();
  const partialDocument = await loadBlobJson<{ sources?: unknown[] }>(SOURCE_MAP_PARTIAL_KEY);
  const seedEntries = previousProgress?.completed
    ? sourceInfo.sources
    : partialDocument?.sources ?? sourceInfo.sources;
  const entries = buildEntries(journals, seedEntries);
  const finalMapCompleted = sourceInfo.sourceMapStage === "final" && sourceInfo.document.metadata?.completed === true;

  let currentIndex = Math.max(0, Math.min(totalJournalCount, previousProgress?.nextStartIndex ?? 0));
  let nextStartIndex = currentIndex;
  let processed = 0;
  let stoppedEarly = false;
  let error = "";
  let lastCompletedJournal = previousProgress?.lastCompletedJournal ?? "";

  if ((previousProgress?.completed || finalMapCompleted) && sourceInfo.stats.resolvedSourceCount > 0) {
    const finishedAt = new Date().toISOString();
    const responseBody = progressBody({
      currentIndex: totalJournalCount,
      nextStartIndex: totalJournalCount,
      totalJournalCount,
      batchSize,
      processed: 0,
      entries,
      completed: true,
      startedAt: previousProgress?.startedAt ?? String(sourceInfo.document.metadata?.started_at ?? startedAt),
      updatedAt: finishedAt,
      lastCompletedJournal,
      stoppedEarly: false,
      error: ""
    });
    await store.setJSON(SOURCE_RESOLUTION_STATUS_KEY, responseBody);
    return jsonResponse(responseBody);
  }

  const batchEnd = Math.min(totalJournalCount, currentIndex + batchSize);
  for (let index = currentIndex; index < batchEnd; index += 1) {
    if (Date.now() >= deadline) {
      stoppedEarly = true;
      error = "Resolver safety timeout reached; call /api/resolve-sources again to continue.";
      break;
    }

    const journal = journals[index];
    const existing = entries[index];
    if (hasAcceptedSource(existing)) {
      lastCompletedJournal = String(journal.journal_name ?? "");
      nextStartIndex = index + 1;
      continue;
    }

    try {
      entries[index] = (await resolveJournalSource(journal, {
        env: { OPENALEX_API_KEY: apiKey, OPENALEX_MAILTO: mailto },
        delayMs,
        acceptLowConfidence: false,
        retries: 0
      })) as SourceMapEntry;
      processed += 1;
      lastCompletedJournal = String(journal.journal_name ?? "");
      nextStartIndex = index + 1;

      if (isOpenAlexStopErrorMessage(entries[index].warning)) {
        stoppedEarly = true;
        error = entries[index].warning;
        break;
      }
    } catch (caught) {
      const message = (caught as Error).message;
      entries[index] = unresolvedEntry(journal, `OpenAlex source resolution failed: ${message}`);
      processed += 1;
      lastCompletedJournal = String(journal.journal_name ?? "");
      nextStartIndex = index + 1;
      if (isOpenAlexStopErrorMessage(message)) {
        stoppedEarly = true;
        error = message;
        break;
      }
    }

    if (index < batchEnd - 1 && Date.now() + delayMs < deadline) {
      await sleep(delayMs);
    }
  }

  const completed = nextStartIndex >= totalJournalCount && !stoppedEarly;
  const finishedAt = new Date().toISOString();
  const responseBody = progressBody({
    currentIndex,
    nextStartIndex,
    totalJournalCount,
    batchSize,
    processed,
    entries,
    completed,
    startedAt: previousProgress?.startedAt ?? startedAt,
    updatedAt: finishedAt,
    lastCompletedJournal,
    stoppedEarly,
    error
  });
  const sourceMapDocument = {
    metadata: {
      generated_at: finishedAt,
      started_at: responseBody.startedAt,
      source: completed ? "netlify-protected-batch-resolver" : "netlify-protected-batch-resolver-partial",
      ...responseBody
    },
    sources: entries
  };
  const unresolvedDocument = {
    metadata: {
      generated_at: finishedAt,
      source: completed ? "netlify-protected-batch-resolver" : "netlify-protected-batch-resolver-partial",
      ...responseBody
    },
    journals: unresolvedRows(entries)
  };

  if (completed) {
    await store.setJSON(SOURCE_MAP_KEY, sourceMapDocument);
    await store.setJSON(UNRESOLVED_JOURNALS_KEY, unresolvedDocument);
    await store.setJSON(SOURCE_RESOLUTION_STATUS_KEY, responseBody);
    await store.delete(SOURCE_MAP_PARTIAL_KEY);
    await store.delete(UNRESOLVED_JOURNALS_PARTIAL_KEY);
    await store.delete(SOURCE_RESOLUTION_PROGRESS_KEY);
  } else {
    await store.setJSON(SOURCE_MAP_PARTIAL_KEY, sourceMapDocument);
    await store.setJSON(UNRESOLVED_JOURNALS_PARTIAL_KEY, unresolvedDocument);
    await store.setJSON(SOURCE_RESOLUTION_PROGRESS_KEY, responseBody);
    await store.setJSON(SOURCE_RESOLUTION_STATUS_KEY, responseBody);
  }

  return jsonResponse(responseBody, { status: stoppedEarly ? 206 : 200 });
};

export const config: Config = {};
