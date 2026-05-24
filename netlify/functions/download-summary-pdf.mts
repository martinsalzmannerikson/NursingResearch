import type { Config } from "@netlify/functions";
import { jsonResponse } from "./_shared/env.js";
import { getJob, pdfStore } from "./_shared/brief-storage.js";

export default async (request: Request) => {
  if (request.method !== "GET") return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  const jobId = new URL(request.url).searchParams.get("jobId") || "";
  if (!jobId) return jsonResponse({ error: "jobId is required" }, { status: 400 });

  const job = await getJob(jobId);
  if (!job || job.status !== "completed" || !job.pdfKey) {
    return jsonResponse({ error: "PDF is not available for this job." }, { status: 404 });
  }

  const pdf = await pdfStore().get(job.pdfKey, { type: "arrayBuffer" });
  if (!pdf) return jsonResponse({ error: "PDF blob was not found." }, { status: 404 });

  return new Response(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="nursing-research-monitor-findings-brief-${jobId}.pdf"`,
      "Cache-Control": "private, max-age=60"
    }
  });
};

export const config: Config = {};
