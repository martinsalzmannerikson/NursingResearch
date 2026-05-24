import type { Config } from "@netlify/functions";
import { jsonResponse } from "./_shared/env.js";
import { getJob } from "./_shared/brief-storage.js";

export default async (request: Request) => {
  if (request.method !== "GET") return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  const jobId = new URL(request.url).searchParams.get("jobId") || "";
  if (!jobId) return jsonResponse({ error: "jobId is required" }, { status: 400 });

  const job = await getJob(jobId);
  if (!job) return jsonResponse({ error: "Job not found" }, { status: 404 });

  return jsonResponse({
    jobId,
    status: job.status,
    progress: job.progress,
    sourceStatusSummary: job.sourceStatusSummary ?? null,
    articleSources: (job.articleSources ?? []).map((source, index) => ({
      index,
      doi: source.doi,
      title: source.title,
      sourceStatus: source.sourceStatus,
      oaStatus: source.oaStatus,
      sourceUrl: source.sourceUrl,
      license: source.license,
      sectionsUsed: source.sectionsUsed,
      extractionWarnings: source.extractionWarnings,
      isRetracted: source.isRetracted
    })),
    errors: job.errors,
    downloadAvailable: job.status === "completed" && Boolean(job.pdfKey),
    downloadUrl: job.status === "completed" && job.pdfKey ? `/api/download-summary-pdf?jobId=${encodeURIComponent(jobId)}` : null
  });
};

export const config: Config = {};
