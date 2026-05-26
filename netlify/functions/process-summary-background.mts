import type { Config } from "@netlify/functions";
import { jsonResponse } from "./_shared/env.js";
import { resolveArticleEvidence } from "./_shared/brief-openalex.js";
import { EmptyModelResponseError, OpenRouterModelUnavailableError, summarizeWithOpenRouter } from "./_shared/brief-openrouter.js";
import { buildBriefRenderModel, generateFindingsBriefPdf } from "./_shared/brief-pdf.js";
import { cleanBriefText, sourceCoverage, type ArticleExtraction } from "./_shared/brief-utils.js";
import { getJob, pdfStore, saveJob, updateProgress, type BriefDebugSummary } from "./_shared/brief-storage.js";

const MODEL_UNAVAILABLE_MESSAGE =
  "AI synthesis could not be generated. The selected OpenRouter model was unavailable or blocked by privacy/data policy settings. Try another model or adjust OpenRouter privacy settings.";
const EMPTY_MODEL_RESPONSE_MESSAGE = "AI synthesis could not be generated because the selected model returned an empty response.";
const NO_USABLE_TEXT_MESSAGE =
  "No usable article text was available for the selected records. Try selecting articles with abstracts or OA full text.";

export class NoUsableArticleTextError extends Error {
  debugSummary: BriefDebugSummary;

  constructor(debugSummary: BriefDebugSummary) {
    super(NO_USABLE_TEXT_MESSAGE);
    this.name = "NoUsableArticleTextError";
    this.debugSummary = debugSummary;
  }
}

export function failureStateForBriefError(error: unknown) {
  const modelUnavailable = error instanceof OpenRouterModelUnavailableError;
  const emptyModelResponse = error instanceof EmptyModelResponseError;
  const noUsableArticleText = error instanceof NoUsableArticleTextError;
  return {
    status: modelUnavailable
      ? ("failed_model_unavailable" as const)
      : emptyModelResponse
        ? ("failed_empty_model_response" as const)
        : noUsableArticleText
          ? ("failed_no_usable_article_text" as const)
          : ("failed" as const),
    message: modelUnavailable
      ? MODEL_UNAVAILABLE_MESSAGE
      : emptyModelResponse
        ? EMPTY_MODEL_RESPONSE_MESSAGE
        : noUsableArticleText
          ? NO_USABLE_TEXT_MESSAGE
          : "Brief generation failed.",
    errorMessage: modelUnavailable
      ? (error as OpenRouterModelUnavailableError).friendlyMessage
      : emptyModelResponse
        ? (error as EmptyModelResponseError).friendlyMessage
        : (error as Error).message,
    fallbackReason: modelUnavailable ? (error as OpenRouterModelUnavailableError).details : undefined,
    debugSummary:
      modelUnavailable && (error as OpenRouterModelUnavailableError).debugSummary
        ? (error as OpenRouterModelUnavailableError).debugSummary
        : emptyModelResponse && (error as EmptyModelResponseError).debugSummary
          ? (error as EmptyModelResponseError).debugSummary
          : noUsableArticleText
          ? (error as NoUsableArticleTextError).debugSummary
          : undefined
  };
}

export function hasUsableArticleText(extractions: ArticleExtraction[]) {
  return extractions.some((item) =>
    [item.methodsText, item.findingsText, item.conclusionsText, item.abstract].some((text) => cleanBriefText(text || "").length > 0)
  );
}

function noUsableTextDebug(extractions: ArticleExtraction[]): BriefDebugSummary {
  return {
    inputArticleCount: extractions.length,
    failurePoint: "before_openrouter_no_usable_article_text"
  };
}

function pdfRenderDiagnostics(markdown: string) {
  const renderModel = buildBriefRenderModel(markdown);
  return {
    renderModel,
    debug: {
      pdfRenderSectionLengths: renderModel.sectionLengths,
      pdfRenderCounts: {
        titleExists: renderModel.titleExists,
        synthesisLength: renderModel.synthesis.length,
        keyFindingsCount: renderModel.keyFindings.length,
        methodologicalBasisLength: renderModel.methodologicalBasis.length,
        implicationsCount: renderModel.implications.length,
        cautionsCount: renderModel.cautions.length,
        articleSourceNotesCount: renderModel.articleSourceNotes.length
      }
    }
  };
}

async function processJob(jobId: string) {
  const job = await getJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  try {
    await updateProgress(jobId, "checking_open_access", "Checking OpenAlex OA status by DOI.", 0, job.articles.length);
    const extractions = [];
    for (const [index, article] of job.articles.entries()) {
      await updateProgress(jobId, "retrieving_fulltext", `Retrieving controlled OA source ${index + 1}/${job.articles.length}.`, index, job.articles.length);
      const extraction = await resolveArticleEvidence(article);
      extractions.push(extraction);
      const current = await getJob(jobId);
      if (current) {
        current.articleSources = [...extractions];
        current.sourceStatusSummary = sourceCoverage(extractions);
        await saveJob(current);
      }
    }

    await updateProgress(jobId, "extracting_sections", "Extracted allowed source sections or abstract fallbacks.", extractions.length, job.articles.length);
    if (!hasUsableArticleText(extractions)) {
      const debugSummary = noUsableTextDebug(extractions);
      const current = await getJob(jobId);
      if (current) {
        current.debugSummary = debugSummary;
        await saveJob(current);
      }
      console.log("Brief job stopped before OpenRouter: no usable article text.", { jobId, debugSummary });
      throw new NoUsableArticleTextError(debugSummary);
    }
    await updateProgress(jobId, "summarising", "Sending capped evidence package to OpenRouter.", extractions.length, job.articles.length);
    const summary = await summarizeWithOpenRouter(job.articles, extractions, async (message) => {
      await updateProgress(jobId, "summarising", message, extractions.length, job.articles.length);
    }, {
      jobId
    });

    await updateProgress(jobId, "generating_pdf", "Generating Nursing Research Monitor PDF brief.", extractions.length, job.articles.length);
    const { renderModel, debug: renderDebug } = pdfRenderDiagnostics(summary.markdown);
    const debugSummary: BriefDebugSummary = {
      ...summary.debugSummary,
      ...renderDebug
    };
    console.log("PDF render diagnostics:", {
      jobId,
      titleExists: renderModel.titleExists,
      synthesisLength: renderModel.synthesis.length,
      keyFindingsCount: renderModel.keyFindings.length,
      methodologicalBasisLength: renderModel.methodologicalBasis.length,
      implicationsCount: renderModel.implications.length,
      cautionsCount: renderModel.cautions.length,
      articleSourceNotesCount: renderModel.articleSourceNotes.length,
      sectionLengths: renderModel.sectionLengths,
      mode: renderModel.mode
    });
    if (renderModel.mode === "empty") {
      throw new EmptyModelResponseError(EMPTY_MODEL_RESPONSE_MESSAGE, { ...debugSummary, failurePoint: "before_pdf_empty_markdown" });
    }
    const pdf = generateFindingsBriefPdf({
      articles: job.articles,
      extractions,
      markdown: summary.markdown,
      synthesisMode: summary.fallback ? "fallback" : "model"
    });
    const pdfKey = `${jobId}.pdf`;
    await pdfStore().set(pdfKey, pdf, {
      metadata: {
        contentType: "application/pdf",
        generatedAt: new Date().toISOString()
      }
    });

    const completed = await getJob(jobId);
    if (!completed) throw new Error(`Job disappeared before completion: ${jobId}`);
    completed.status = summary.fallback ? "completed_with_fallback" : "completed";
    completed.progress = {
      step: "completed",
      message: summary.fallback ? "Fallback notes are ready." : "AI Findings Brief ready.",
      completed: job.articles.length,
      total: job.articles.length
    };
    completed.articleSources = extractions;
    completed.sourceStatusSummary = sourceCoverage(extractions);
    completed.summary = summary.markdown;
    completed.rawModelResponse = summary.raw;
    completed.modelUsed = summary.model;
    completed.fallbackReason = summary.fallbackReason;
    completed.debugSummary = debugSummary;
    if (summary.fallback && summary.errorSummary?.length) {
      completed.errors = [...new Set([...completed.errors, ...summary.errorSummary])];
    }
    completed.pdfKey = pdfKey;
    await saveJob(completed);
  } catch (error) {
    const failed = await getJob(jobId);
    if (failed) {
      const failure = failureStateForBriefError(error);
      failed.status = failure.status;
      failed.progress = {
        step: "failed",
        message: failure.message,
        completed: failed.articleSources?.length ?? 0,
        total: failed.articles.length
      };
      failed.errors = [...failed.errors, failure.errorMessage];
      if (failure.fallbackReason) failed.fallbackReason = failure.fallbackReason;
      if (failure.debugSummary) failed.debugSummary = { ...(failed.debugSummary ?? {}), ...failure.debugSummary };
      const rawModelResponse = (error as Error & { rawModelResponse?: string }).rawModelResponse;
      if (rawModelResponse) failed.rawModelResponse = rawModelResponse;
      await saveJob(failed);
    }
    console.error(`Brief job failed ${jobId}:`, error);
  }
}

export default async (request: Request) => {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  const body = (await request.json().catch(() => ({}))) as { jobId?: string };
  if (!body.jobId) return jsonResponse({ error: "jobId is required" }, { status: 400 });
  await processJob(body.jobId);
  return jsonResponse({ ok: true });
};

export const config: Config = {};
