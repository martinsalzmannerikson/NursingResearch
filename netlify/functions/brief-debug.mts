import type { Config } from "@netlify/functions";
import { jsonResponse } from "./_shared/env.js";
import { cleanBriefText, sourceCoverage } from "./_shared/brief-utils.js";
import { getJob } from "./_shared/brief-storage.js";

export default async (request: Request) => {
  if (request.method !== "GET") return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  const jobId = new URL(request.url).searchParams.get("jobId") || "";
  if (!jobId) return jsonResponse({ error: "jobId is required" }, { status: 400 });

  const job = await getJob(jobId);
  if (!job) return jsonResponse({ error: "Job not found" }, { status: 404 });

  const debug = job.debugSummary ?? {};
  return jsonResponse({
    status: job.status,
    progress: job.progress,
    sourceCounts: job.sourceStatusSummary ?? sourceCoverage(job.articleSources ?? []),
    debugSummary: debug,
    modelUsed: job.modelUsed ?? debug.modelUsed ?? null,
    modelResponseContentLength: job.rawModelResponse?.length ?? debug.openRouterContentLength ?? 0,
    markdownSectionLengths: debug.markdownSectionLengths ?? null,
    pdfSectionLengths: debug.pdfRenderSectionLengths ?? null,
    modelPreview: cleanBriefText(job.rawModelResponse || debug.modelPreview || "", 500)
  });
};

export const config: Config = {};
