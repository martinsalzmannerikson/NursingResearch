import { getEnv } from "./env.js";
import { capText, parseOpenRouterJson, type ArticleExtraction, type BriefArticleInput } from "./brief-utils.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_OPENROUTER_TIMEOUT_MS = 20_000;

type SummaryJson = {
  executiveSummary: string;
  keyFindings: string[];
  methodologicalProfile: string[];
  implicationsForNursingResearch: string[];
  limitationsOfEvidenceBase: string[];
  articleNotes: Array<{
    title: string;
    note: string;
    sourceStatus: string;
    designMethods: string;
    findingsUsed: string;
    evidenceWeight: "Low" | "Med" | "High";
  }>;
  sourceStatusSummary: string[];
};

type SummaryResult = {
  parsed: SummaryJson;
  raw: string;
  model: string;
  fallback: boolean;
  fallbackReason?: string;
  errorSummary?: string[];
};

class OpenRouterRequestError extends Error {
  status: number;
  body: string;
  model: string;

  constructor(status: number, body: string, model: string) {
    super(`OpenRouter ${status}: ${body}`);
    this.status = status;
    this.body = body;
    this.model = model;
  }
}

function articleEvidence(article: BriefArticleInput, extraction: ArticleExtraction) {
  return {
    title: article.title || extraction.title,
    authors: article.authors || [],
    year: article.year || article.publicationYear || article.publication_year || "",
    journal: article.journal || article.journal_name || article.source || "",
    doi: extraction.doi,
    sourceStatus: extraction.sourceStatus,
    sectionsUsed: extraction.sectionsUsed,
    extractionWarnings: extraction.extractionWarnings,
    isRetracted: extraction.isRetracted,
    methods: capText(extraction.methodsText, 2500),
    findings: capText(extraction.findingsText, 7000),
    conclusions: capText(extraction.conclusionsText, 2500),
    abstractFallback:
      extraction.sourceStatus === "oa_fulltext_sections_used" ? "" : capText(extraction.abstract, 2500)
  };
}

function titleOf(article: BriefArticleInput, extraction: ArticleExtraction) {
  return article.title || extraction.title || "Untitled article";
}

function sourceStatusLabel(extraction: ArticleExtraction) {
  if (extraction.sourceStatus === "oa_fulltext_sections_used") return "OA full text sections used";
  if (extraction.sourceStatus === "fulltext_found_but_extraction_failed") return "OA full text found, but extraction failed; abstract fallback used";
  if (extraction.sourceStatus === "abstract_only") return "Abstract only";
  if (extraction.sourceStatus === "no_doi") return "No DOI; abstract fallback used";
  return "Insufficient data";
}

function evidenceBasis(extraction: ArticleExtraction) {
  const basis = [];
  if (extraction.methodsText) basis.push("methods");
  if (extraction.findingsText) basis.push("findings/results");
  if (extraction.conclusionsText) basis.push("conclusions");
  if (!basis.length && extraction.abstract) basis.push("abstract");
  return basis.length ? basis.join(", ") : "no usable source text";
}

function sourceText(extraction: ArticleExtraction) {
  return capText(
    extraction.findingsText ||
      extraction.conclusionsText ||
      extraction.methodsText ||
      extraction.abstract ||
      "No usable article text was available.",
    700
  );
}

function methodText(extraction: ArticleExtraction) {
  if (extraction.methodsText) return capText(extraction.methodsText, 420);
  if (extraction.abstract) return "Method details are limited to the supplied abstract.";
  return "Method details were not available.";
}

function friendlyOpenRouterMessage(error: unknown) {
  if (error instanceof OpenRouterRequestError) {
    if (error.status === 429) {
      return "OpenRouter rate limit: the selected model/provider is temporarily rate-limited. Try again later or choose a model/provider with available capacity.";
    }
    if (error.status === 404 && /privacy|data policy|no endpoints?/i.test(error.body)) {
      return "OpenRouter could not find an endpoint compatible with the current privacy/data policy settings. Check OpenRouter privacy settings or choose another model/provider.";
    }
    if (error.status === 401 || error.status === 403) {
      return "OpenRouter rejected the request. Check the server-side API key and model/provider access.";
    }
    return `OpenRouter returned HTTP ${error.status}. A fallback brief was generated.`;
  }
  const message = (error as Error).message || "Unknown OpenRouter error.";
  if (/timed out|timeout|abort/i.test(message)) {
    return "OpenRouter timed out before returning a usable synthesis. A fallback brief was generated.";
  }
  if (/json|parse/i.test(message)) {
    return "OpenRouter returned a response that was not valid JSON. A fallback brief was generated.";
  }
  if (/OPENROUTER_MODEL/i.test(message)) {
    return "OPENROUTER_MODEL is not set. A fallback brief was generated.";
  }
  if (/OPENROUTER_API_KEY/i.test(message)) {
    return "OPENROUTER_API_KEY is not set. A fallback brief was generated.";
  }
  return "OpenRouter did not return a usable synthesis. A fallback brief was generated.";
}

function fallbackSummary(
  articles: BriefArticleInput[],
  extractions: ArticleExtraction[],
  friendlyReasons: string[]
): SummaryResult {
  const reasons = [...new Set(friendlyReasons)].filter(Boolean);
  const articleNotes = articles.map((article, index) => {
    const extraction = extractions[index];
    return {
      title: extraction ? titleOf(article, extraction) : article.title || "Untitled article",
      note: extraction
        ? `Based on ${evidenceBasis(extraction)}. ${sourceText(extraction)}`
        : "No extraction record was available for this article.",
      sourceStatus: extraction ? sourceStatusLabel(extraction) : "Insufficient data",
      designMethods: extraction ? methodText(extraction) : "Method details were not available.",
      findingsUsed: extraction ? sourceText(extraction) : "No findings text was available.",
      evidenceWeight: extraction?.sourceStatus === "oa_fulltext_sections_used" ? ("Med" as const) : ("Low" as const)
    };
  });
  const fullTextCount = extractions.filter((item) => item.sourceStatus === "oa_fulltext_sections_used").length;
  const fallbackCount = extractions.filter((item) => item.sourceStatus !== "oa_fulltext_sections_used").length;
  const parsed: SummaryJson = {
    executiveSummary:
      "This brief was generated using fallback extraction notes because the selected OpenRouter model did not return a usable synthesis. It summarizes only the supplied article sections or abstracts and should be read as a source-status-aware findings aid, not as a full AI-generated synthesis.",
    keyFindings: articleNotes.map((note, index) => `${index + 1}. ${note.title}: ${capText(note.findingsUsed, 360)}`),
    methodologicalProfile: articleNotes.map((note, index) => `${index + 1}. ${note.title}: ${note.designMethods}`),
    implicationsForNursingResearch: [
      "Use these notes to identify candidate findings and methods for closer reading; do not treat fallback wording as a substitute for full article appraisal.",
      "Where only abstracts or failed full-text extraction are available, claims should remain cautious and non-causal unless the abstract itself supports stronger wording."
    ],
    limitationsOfEvidenceBase: [
      "The selected OpenRouter model did not return a usable synthesis, so cross-study interpretation is intentionally limited.",
      `${fullTextCount} record(s) used reliable OA full-text sections; ${fallbackCount} record(s) used abstract or extraction-failure fallback text.`,
      "Provider error details are kept out of this PDF; the user-facing job status contains a concise explanation."
    ],
    articleNotes,
    sourceStatusSummary: [
      "Fallback extraction notes were used because the selected OpenRouter model was unavailable or did not return usable JSON.",
      ...reasons.slice(0, 2)
    ]
  };
  return {
    parsed,
    raw: JSON.stringify({ fallback: true, reasons, parsed }),
    model: "deterministic-fallback",
    fallback: true,
    fallbackReason: reasons[0] || "The selected OpenRouter model did not return a usable synthesis.",
    errorSummary: reasons
  };
}

function buildMessages(articles: BriefArticleInput[], extractions: ArticleExtraction[]) {
  const evidence = articles.map((article, index) => articleEvidence(article, extractions[index]));
  return [
    {
      role: "system",
      content:
        "You produce cautious academic JSON summaries for nursing research. Use only supplied Methods, Results/Findings, Conclusions, or Abstract fallback. Do not invent study details. Do not use introduction, background, literature review, or discussion unless a supplied section is explicitly marked as a combined findings/discussion section. Be explicit when a claim is based on abstract only. Return valid JSON only."
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          task:
            "Create an AI-assisted findings brief. Include executiveSummary, keyFindings, methodologicalProfile, implicationsForNursingResearch, limitationsOfEvidenceBase, articleNotes, and sourceStatusSummary. Return articleNotes in the same order as the supplied evidence, with cautious designMethods, findingsUsed, and evidenceWeight fields.",
          outputShape: {
            executiveSummary: "string",
            keyFindings: ["string"],
            methodologicalProfile: ["string"],
            implicationsForNursingResearch: ["string"],
            limitationsOfEvidenceBase: ["string"],
            articleNotes: [
              {
                title: "string",
                note: "string",
                sourceStatus: "string",
                designMethods: "string",
                findingsUsed: "string",
                evidenceWeight: "Low | Med | High"
              }
            ],
            sourceStatusSummary: ["string"]
          },
          evidence
        },
        null,
        2
      )
    }
  ];
}

async function callOpenRouter(
  body: Record<string, unknown>,
  apiKey: string,
  siteUrl: string,
  appTitle: string,
  timeoutMs: number
) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "X-OpenRouter-Title": appTitle || "Nursing Research Monitor"
  };
  if (siteUrl) headers["HTTP-Referer"] = siteUrl;

  console.log("Using OpenRouter model:", body.model);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) throw new OpenRouterRequestError(response.status, text, String(body.model || ""));
    return JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> };
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      throw new Error(`OpenRouter request timed out after ${timeoutMs} ms for model ${String(body.model)}.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function summarizeWithOpenRouter(
  articles: BriefArticleInput[],
  extractions: ArticleExtraction[],
  onProgress?: (message: string) => Promise<void> | void
): Promise<SummaryResult> {
  const apiKey = getEnv("OPENROUTER_API_KEY");
  const model = process.env.OPENROUTER_MODEL?.trim();
  if (!apiKey || !model) {
    const reason = friendlyOpenRouterMessage(new Error(!apiKey ? "OPENROUTER_API_KEY is not set." : "OPENROUTER_MODEL is not set."));
    await onProgress?.(reason);
    return fallbackSummary(articles, extractions, [reason]);
  }

  const siteUrl = getEnv("OPENROUTER_SITE_URL");
  const appTitle = getEnv("OPENROUTER_APP_TITLE", "Nursing Research Monitor");
  const timeoutMs = Number(getEnv("OPENROUTER_REQUEST_TIMEOUT_MS", String(DEFAULT_OPENROUTER_TIMEOUT_MS))) || DEFAULT_OPENROUTER_TIMEOUT_MS;
  const baseBody = {
    model,
    messages: buildMessages(articles, extractions),
    temperature: 0.2,
    max_tokens: 3000,
    provider: {
      data_collection: "allow",
      allow_fallbacks: true
    }
  };

  try {
    await onProgress?.(`Trying OpenRouter model ${model}.`);
    let data;
    try {
      data = await callOpenRouter({ ...baseBody, response_format: { type: "json_object" } }, apiKey, siteUrl, appTitle, timeoutMs);
    } catch (error) {
      if (!/response_format|json_object|schema|unsupported|400/i.test((error as Error).message)) throw error;
      await onProgress?.(`Retrying ${model} without JSON response_format.`);
      data = await callOpenRouter(baseBody, apiKey, siteUrl, appTitle, timeoutMs);
    }
    const raw = data.choices?.[0]?.message?.content || "";
    if (!raw) throw new Error("OpenRouter returned an empty response.");
    try {
      return {
        parsed: parseOpenRouterJson(raw),
        raw,
        model,
        fallback: false,
        errorSummary: []
      };
    } catch (error) {
      console.error("OpenRouter returned invalid JSON:", error, raw.slice(0, 1000));
      const reason = friendlyOpenRouterMessage(new Error(`OpenRouter response JSON parsing failed: ${(error as Error).message}`));
      await onProgress?.("OpenRouter returned invalid JSON; generating fallback evidence notes.");
      return fallbackSummary(articles, extractions, [reason]);
    }
  } catch (error) {
    console.error("OpenRouter synthesis failed:", error);
    const reason = friendlyOpenRouterMessage(error);
    await onProgress?.("OpenRouter was unavailable; generating fallback evidence notes.");
    return fallbackSummary(articles, extractions, [reason]);
  }
}
