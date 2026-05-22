import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  resolveJournalSource,
  sourceMapStats,
  unresolvedCsv
} from "./lib/openalex.mjs";

const inputPath = path.resolve("src/data/journals.json");
const sourceMapPath = path.resolve("src/data/openalex-source-map.json");
const unresolvedPath = path.resolve("src/data/unresolved-journals.csv");

const manifest = JSON.parse(await readFile(inputPath, "utf8"));
const journals = manifest.journals.filter((journal) => journal.include_in_monitor);
const entries = [];
let disabledReason = "";
const delayMs = Number(process.env.OPENALEX_RESOLVE_DELAY_MS || 750);

console.log(`Resolving OpenAlex sources for ${journals.length} journals.`);
if (!process.env.OPENALEX_API_KEY) {
  console.warn("OPENALEX_API_KEY is not set. Continuing with unauthenticated OpenAlex requests.");
}
if (!process.env.OPENALEX_MAILTO) {
  console.warn("OPENALEX_MAILTO is not set. Set it for polite OpenAlex API usage.");
}

for (const [index, journal] of journals.entries()) {
  const entry = await resolveJournalSource(journal, {
    disabledReason,
    delayMs,
    acceptLowConfidence: false,
    env: process.env
  });
  entries.push(entry);
  const status = entry.openalex_source_id ? `${entry.status} ${entry.openalex_source_key}` : "unresolved";
  console.log(`[${index + 1}/${journals.length}] ${journal.journal_name}: ${status}`);
  if (!disabledReason && /insufficient budget|rate limit exceeded/i.test(entry.warning || "")) {
    disabledReason = "OpenAlex API budget/rate limit was exhausted; skipped remaining source searches.";
    console.warn(disabledReason);
  }
}

const stats = sourceMapStats(entries);
await writeFile(
  sourceMapPath,
  `${JSON.stringify(
    {
      metadata: {
        generated_at: new Date().toISOString(),
        source_manifest: "src/data/journals.json",
        ...stats
      },
      sources: entries
    },
    null,
    2
  )}\n`,
  "utf8"
);
await writeFile(unresolvedPath, unresolvedCsv(entries), "utf8");

console.log(
  `Resolved ${stats.resolvedSourceCount}/${stats.totalJournalCount} sources; ${stats.unresolvedJournalCount} unresolved.`
);
console.log(`Wrote ${path.relative(process.cwd(), sourceMapPath)} and ${path.relative(process.cwd(), unresolvedPath)}`);
