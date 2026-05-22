import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { requireRefreshToken } from "./_shared/auth.js";
import { getEnv, jsonResponse } from "./_shared/env.js";
import { loadSourceMapDocument } from "./_shared/source-map.js";
import {
  isOpenAlexStopErrorMessage,
  resolveJournalSource,
  sourceMapStats,
  STORE_NAME,
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

const DEFAULT_RESOLVE_TIME_BUDGET_MS = 50_000;

function sleep(ms: number) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
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

function countByStatus(entries: SourceMapEntry[]) {
  const stats = sourceMapStats(entries) as {
    totalJournalCount: number;
    resolvedHighCount: number;
    resolvedMediumCount: number;
    resolvedLowCount: number;
    unresolvedJournalCount: number;
  };
  return stats;
}

function hasAcceptedSource(entry: SourceMapEntry | undefined) {
  return Boolean(entry?.openalex_source_id && ["resolved_high", "resolved_medium"].includes(entry.status));
}

function existingOrPendingEntry(
  journal: Record<string, unknown>,
  existing: SourceMapEntry | undefined,
  warning = "Resolution pending; rerun the protected source resolver to continue."
) {
  return existing ?? unresolvedEntry(journal, warning);
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
    return jsonResponse(
      {
        error: "OPENALEX_API_KEY and OPENALEX_MAILTO must be configured before resolving sources."
      },
      { status: 503 }
    );
  }

  const delayMs = Number(getEnv("OPENALEX_RESOLVE_DELAY_MS", "750"));
  const timeBudgetMs = Math.max(
    5_000,
    Number(getEnv("OPENALEX_RESOLVE_TIME_BUDGET_MS", String(DEFAULT_RESOLVE_TIME_BUDGET_MS)))
  );
  const deadline = Date.now() + timeBudgetMs;
  const startedAt = new Date().toISOString();
  const journals = await loadJournals();
  const existingSourceMap = await loadSourceMapDocument();
  const existingByJournalId = new Map(
    existingSourceMap.sources.map((entry) => [String(entry.journal_id ?? ""), entry as SourceMapEntry])
  );
  const entries: SourceMapEntry[] = [];
  let stoppedEarly = false;
  let error = "";
  let lastResolvedJournal = "";
  let processedJournalCount = 0;
  let reusedResolvedJournalCount = 0;

  for (const [index, journal] of journals.entries()) {
    const journalId = String(journal.journal_id ?? "");
    const existing = existingByJournalId.get(journalId);
    if (hasAcceptedSource(existing)) {
      entries.push(existing as SourceMapEntry);
      reusedResolvedJournalCount += 1;
      continue;
    }

    if (stoppedEarly) {
      entries.push(
        existingOrPendingEntry(journal, existing, "Resolution skipped after OpenAlex rate-limit, budget, or time stop.")
      );
      continue;
    }

    if (Date.now() >= deadline) {
      stoppedEarly = true;
      error = "Resolver time budget reached; call /api/resolve-sources again to continue.";
      entries.push(existingOrPendingEntry(journal, existing));
      continue;
    }

    try {
      const entry = (await resolveJournalSource(journal, {
        env: { OPENALEX_API_KEY: apiKey, OPENALEX_MAILTO: mailto },
        delayMs,
        acceptLowConfidence: false,
        retries: 0
      })) as SourceMapEntry;
      entries.push(entry);
      lastResolvedJournal = String(journal.journal_name ?? "");
      processedJournalCount += 1;

      if (isOpenAlexStopErrorMessage(entry.warning)) {
        stoppedEarly = true;
        error = entry.warning;
      }
    } catch (caught) {
      const message = (caught as Error).message;
      entries.push(unresolvedEntry(journal, `OpenAlex source resolution failed: ${message}`));
      lastResolvedJournal = String(journal.journal_name ?? "");
      processedJournalCount += 1;
      if (isOpenAlexStopErrorMessage(message)) {
        stoppedEarly = true;
        error = message;
      }
    }

    if (!stoppedEarly && delayMs > 0 && index < journals.length - 1) {
      await sleep(delayMs);
    }
  }

  const finishedAt = new Date().toISOString();
  const stats = countByStatus(entries);
  const responseBody = {
    totalJournalCount: stats.totalJournalCount,
    resolvedHighCount: stats.resolvedHighCount,
    resolvedMediumCount: stats.resolvedMediumCount,
    resolvedLowCount: stats.resolvedLowCount,
    unresolvedJournalCount: stats.unresolvedJournalCount,
    stoppedEarly,
    error,
    lastResolvedJournal,
    processedJournalCount,
    reusedResolvedJournalCount
  };

  const sourceMapDocument = {
    metadata: {
      generated_at: finishedAt,
      started_at: startedAt,
      source: "netlify-protected-resolver",
      ...responseBody
    },
    sources: entries
  };

  const unresolvedDocument = {
    metadata: {
      generated_at: finishedAt,
      source: "netlify-protected-resolver",
      ...responseBody
    },
    journals: unresolvedRows(entries)
  };

  const store = getStore({ name: STORE_NAME, consistency: "strong" });
  await store.setJSON("openalex-source-map.json", sourceMapDocument);
  await store.setJSON("unresolved-journals.json", unresolvedDocument);
  await store.setJSON("source-resolution-status.json", responseBody);

  return jsonResponse(responseBody, { status: stoppedEarly ? 206 : 200 });
};

export const config: Config = {};
