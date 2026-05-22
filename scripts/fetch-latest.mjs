import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchLatestWorks, latestFallback } from "./lib/openalex.mjs";

const sourceMapPath = path.resolve("src/data/openalex-source-map.json");
const latestPath = path.resolve("public/data/latest.json");
const statusPath = path.resolve("public/data/status.json");

let sourceMap = [];
const errors = [];

try {
  const sourceMapJson = JSON.parse(await readFile(sourceMapPath, "utf8"));
  sourceMap = sourceMapJson.sources || [];
} catch (error) {
  errors.push(`Could not read ${sourceMapPath}: ${error.message}`);
}

if (!process.env.OPENALEX_API_KEY) {
  console.warn("OPENALEX_API_KEY is not set. Continuing with unauthenticated OpenAlex requests.");
}

let latest;
try {
  latest = await fetchLatestWorks(sourceMap, {
    days: Number(process.env.RECENT_DAYS || 90),
    maxResults: Number(process.env.MAX_RESULTS || 1000)
  });
} catch (error) {
  latest = latestFallback({
    sourceMap,
    errors: [...errors, `OpenAlex fetch failed: ${error.message}`],
    days: Number(process.env.RECENT_DAYS || 90),
    maxResults: Number(process.env.MAX_RESULTS || 1000)
  });
}

if (errors.length) {
  latest.status.errors = [...new Set([...(latest.status.errors || []), ...errors])];
}

await mkdir(path.dirname(latestPath), { recursive: true });
await writeFile(latestPath, `${JSON.stringify(latest, null, 2)}\n`, "utf8");
await writeFile(statusPath, `${JSON.stringify(latest.status, null, 2)}\n`, "utf8");

console.log(`Fetched ${latest.items.length} latest works -> ${path.relative(process.cwd(), latestPath)}`);
if (latest.status.errors?.length) {
  console.warn(`Completed with ${latest.status.errors.length} warning(s):`);
  for (const error of latest.status.errors) console.warn(`- ${error}`);
}
