import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseJournalCsv } from "./lib/csv.mjs";

const inputPath = path.resolve("src/data/nursing_journals_codex_ready.csv");
const outputPath = path.resolve("src/data/journals.json");

const csvText = await readFile(inputPath, "utf8");
const journals = parseJournalCsv(csvText);

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `${JSON.stringify(
    {
      metadata: {
        generated_at: new Date().toISOString(),
        source_file: "src/data/nursing_journals_codex_ready.csv",
        journal_count: journals.length,
        required_columns_validated: true
      },
      journals
    },
    null,
    2
  )}\n`,
  "utf8"
);

console.log(`Normalized ${journals.length} journals -> ${path.relative(process.cwd(), outputPath)}`);
