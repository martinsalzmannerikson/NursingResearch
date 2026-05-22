import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { jsonResponse } from "./_shared/env.js";
import { readStaticJson } from "./_shared/static.js";
import { STORE_NAME } from "../../scripts/lib/openalex.mjs";

const cacheHeaders = {
  "Cache-Control": "public, max-age=60, stale-while-revalidate=600"
};

export default async (request: Request) => {
  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405, headers: cacheHeaders });
  }

  try {
    const store = getStore({ name: STORE_NAME, consistency: "strong" });
    const status = await store.get("status.json", { type: "json" });
    if (status) return jsonResponse(status, { headers: cacheHeaders });
  } catch (error) {
    console.warn(`Blob status read failed: ${(error as Error).message}`);
  }

  const fallback = await readStaticJson("public/data/status.json");
  return jsonResponse(fallback ?? { errors: ["No status available."] }, { headers: cacheHeaders });
};

export const config: Config = {};
