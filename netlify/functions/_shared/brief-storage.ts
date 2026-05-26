import { getStore } from "@netlify/blobs";
import { BRIEF_JOB_STORE, BRIEF_PDF_STORE, type ArticleExtraction, type BriefArticleInput, type SourceCoverage } from "./brief-utils.js";

export type BriefJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "completed_with_fallback"
  | "failed"
  | "failed_model_unavailable"
  | "failed_empty_model_response"
  | "failed_no_usable_article_text";

export type BriefProgressStep =
  | "queued"
  | "checking_open_access"
  | "retrieving_fulltext"
  | "extracting_sections"
  | "summarising"
  | "generating_pdf"
  | "completed"
  | "failed";

export type BriefJob = {
  jobId: string;
  status: BriefJobStatus;
  createdAt: string;
  updatedAt: string;
  articles: BriefArticleInput[];
  progress: {
    step: BriefProgressStep;
    message: string;
    completed: number;
    total: number;
  };
  errors: string[];
  articleSources?: ArticleExtraction[];
  sourceStatusSummary?: SourceCoverage;
  summary?: unknown;
  rawModelResponse?: string;
  modelUsed?: string;
  fallbackReason?: string;
  debugSummary?: BriefDebugSummary;
  pdfKey?: string;
  resultKey?: string;
};

export type BriefDebugSummary = {
  modelUsed?: string | null;
  fallbackModels?: string[];
  inputArticleCount?: number;
  promptCharLength?: number;
  articleInputCharLength?: number;
  openRouterStatus?: number | null;
  openRouterFinishReason?: string | null;
  openRouterChoiceCount?: number;
  openRouterContentLength?: number;
  openRouterEmptyContent?: boolean;
  markdownSectionLengths?: Record<string, number>;
  pdfRenderSectionLengths?: Record<string, number>;
  pdfRenderCounts?: {
    titleExists: boolean;
    synthesisLength: number;
    keyFindingsCount: number;
    methodologicalBasisLength: number;
    implicationsCount: number;
    cautionsCount: number;
    articleSourceNotesCount: number;
  };
  failurePoint?: string;
  modelPreview?: string;
};

export function jobStore() {
  return getStore({ name: BRIEF_JOB_STORE, consistency: "strong" });
}

export function pdfStore() {
  return getStore({ name: BRIEF_PDF_STORE, consistency: "strong" });
}

export async function getJob(jobId: string) {
  return (await jobStore().get(`${jobId}.json`, { type: "json" })) as BriefJob | null;
}

export async function saveJob(job: BriefJob) {
  job.updatedAt = new Date().toISOString();
  await jobStore().setJSON(`${job.jobId}.json`, job);
  return job;
}

export async function updateJob(jobId: string, patch: Partial<BriefJob>) {
  const current = await getJob(jobId);
  if (!current) throw new Error(`Job not found: ${jobId}`);
  return saveJob({ ...current, ...patch });
}

export async function updateProgress(jobId: string, step: BriefProgressStep, message: string, completed = 0, total = 0) {
  const job = await getJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);
  job.status = step === "completed" ? "completed" : step === "failed" ? "failed" : "running";
  job.progress = { step, message, completed, total };
  return saveJob(job);
}
