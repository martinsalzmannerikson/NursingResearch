import type { Config } from "@netlify/functions";
import { jsonResponse } from "./_shared/env.js";
import { MAX_ARTICLES_PER_BRIEF, normalizeArticleInput, type BriefArticleInput } from "./_shared/brief-utils.js";
import { saveJob, type BriefJob } from "./_shared/brief-storage.js";

const MAX_BODY_BYTES = 120_000;

async function parseBody(request: Request) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new Error("Request body is too large.");
  return JSON.parse(text) as { articles?: BriefArticleInput[] };
}

async function invokeBackground(request: Request, jobId: string) {
  const url = new URL("/.netlify/functions/process-summary-background", request.url);
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId })
  });
}

export default async (request: Request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  let body: { articles?: BriefArticleInput[] };
  try {
    body = await parseBody(request);
  } catch (error) {
    return jsonResponse({ error: `Invalid JSON: ${(error as Error).message}` }, { status: 400 });
  }

  const articles = Array.isArray(body.articles) ? body.articles.map(normalizeArticleInput) : [];
  if (articles.length === 0) return jsonResponse({ error: "Select at least one article." }, { status: 400 });
  if (articles.length > MAX_ARTICLES_PER_BRIEF) {
    return jsonResponse({ error: `Select no more than ${MAX_ARTICLES_PER_BRIEF} articles.` }, { status: 400 });
  }

  const now = new Date().toISOString();
  const jobId = crypto.randomUUID();
  const job: BriefJob = {
    jobId,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    articles,
    progress: {
      step: "queued",
      message: "Queued for controlled DOI/OpenAlex processing.",
      completed: 0,
      total: articles.length
    },
    errors: []
  };
  await saveJob(job);

  try {
    await invokeBackground(request, jobId);
  } catch (error) {
    console.error(`Background invocation failed for ${jobId}:`, error);
  }

  return jsonResponse({ jobId, status: "queued" }, { status: 202 });
};

export const config: Config = {};
