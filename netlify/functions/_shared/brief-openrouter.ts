import { getEnv } from "./env.js";
import { capText, parseOpenRouterJson, type ArticleExtraction, type BriefArticleInput } from "./brief-utils.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_OPENROUTER_TIMEOUT_MS = 20_000;
const DEFAULT_OPENROUTER_MAX_MODEL_ATTEMPTS = 4;
const FREE_MODEL_FALLBACKS = [
  "openai/gpt-oss-20b:free",
  "qwen/qwen3-next-80b-a3b-instruct:free",
  "z-ai/glm-4.5-air:free",
  "nvidia/nemotron-3-nano-30b-a3b:free",
  "minimax/minimax-m2.5:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "openai/gpt-oss-120b:free",
  "deepseek/deepseek-v4-flash:free"
];

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

function fallbackSummary(
  articles: BriefArticleInput[],
  extractions: ArticleExtraction[],
  reasons: string[]
): { parsed: SummaryJson; raw: string; model: string } {
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
  const abstractFallbackCount = extractions.filter((item) => item.sourceStatus !== "oa_fulltext_sections_used").length;
  const parsed: SummaryJson = {
    executiveSummary:
      "OpenRouter was unavailable during this job, so this brief uses a conservative deterministic fallback. It summarizes only the supplied article sections or abstracts and should be read as a source-status-aware findings aid rather than a model-generated synthesis.",
    keyFindings: articleNotes.map((note, index) => `${index + 1}. ${note.title}: ${capText(note.findingsUsed, 360)}`),
    methodologicalProfile: articleNotes.map((note, index) => `${index + 1}. ${note.title}: ${note.designMethods}`),
    implicationsForNursingResearch: [
      "Use these notes to identify candidate findings and methods for closer reading; do not treat fallback wording as a substitute for full article appraisal.",
      "Where only abstracts or failed full-text extraction are available, claims should remain cautious and non-causal unless the abstract itself supports stronger wording."
    ],
    limitationsOfEvidenceBase: [
      `OpenRouter did not provide a usable response. Fallback reason count: ${reasons.length}.`,
      `${fullTextCount} record(s) used reliable OA full-text sections; ${abstractFallbackCount} record(s) used abstract or extraction-failure fallback text.`,
      "The fallback does not infer cross-study themes beyond the supplied text and source-status metadata."
    ],
    articleNotes,
    sourceStatusSummary: [
      "Deterministic fallback used because OpenRouter free endpoints were unavailable, blocked, rate-limited, timed out, or returned invalid JSON.",
      ...reasons.slice(0, 3).map((reason) => capText(reason, 260))
    ]
  };
  return {
    parsed,
    raw: JSON.stringify({ fallback: true, reasons, parsed }),
    model: "deterministic-fallback"
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
    if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${text}`);
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

function modelCandidates(primaryModel: string) {
  return [
    ...new Set(
      [primaryModel, ...FREE_MODEL_FALLBACKS]
        .map((model) => model.trim())
        .filter((candidate) => candidate && !/^google\/gemma-4-\d+b.*(?::free)?$/i.test(candidate))
    )
  ];
}

function isRetryableModelError(error: unknown) {
  return /no endpoints?|guardrail|data policy|privacy|model not found|provider returned error|temporarily|rate.?limit|upstream|timed out|timeout|abort|404|429|503/i.test(
    (error as Error).message
  );
}

export async function summarizeWithOpenRouter(
  articles: BriefArticleInput[],
  extractions: ArticleExtraction[],
  onProgress?: (message: string) => Promise<void> | void
) {
  const apiKey = getEnv("OPENROUTER_API_KEY");
  const model = process.env.OPENROUTER_MODEL?.trim();
  if (!apiKey || !model) {
    const reason = !apiKey
      ? "OPENROUTER_API_KEY is not set; deterministic fallback synthesis was used."
      : "OPENROUTER_MODEL is not set; deterministic fallback synthesis was used.";
    await onProgress?.(reason);
    return fallbackSummary(articles, extractions, [reason]);
  }

  const siteUrl = getEnv("OPENROUTER_SITE_URL");
  const appTitle = getEnv("OPENROUTER_APP_TITLE", "Nursing Research Monitor");
  const timeoutMs = Number(getEnv("OPENROUTER_REQUEST_TIMEOUT_MS", String(DEFAULT_OPENROUTER_TIMEOUT_MS))) || DEFAULT_OPENROUTER_TIMEOUT_MS;
  const maxModelAttempts =
    Number(getEnv("OPENROUTER_MAX_MODEL_ATTEMPTS", String(DEFAULT_OPENROUTER_MAX_MODEL_ATTEMPTS))) ||
    DEFAULT_OPENROUTER_MAX_MODEL_ATTEMPTS;

  let parsed;
  let raw = "";
  let usedModel = model;
  const modelErrors: string[] = [];

  for (const candidateModel of modelCandidates(model).slice(0, Math.max(1, maxModelAttempts))) {
    const baseBody = {
      model: candidateModel,
      messages: buildMessages(articles, extractions),
      temperature: 0.2,
      max_tokens: 3000,
      provider: {
        data_collection: "allow",
        allow_fallbacks: true
      }
    };
    try {
      usedModel = candidateModel;
      await onProgress?.(`Trying OpenRouter model ${candidateModel}.`);
      try {
        const data = await callOpenRouter(
          { ...baseBody, response_format: { type: "json_object" } },
          apiKey,
          siteUrl,
          appTitle,
          timeoutMs
        );
        raw = data.choices?.[0]?.message?.content || "";
      } catch (error) {
        if (!/response_format|json_object|schema|unsupported|400/i.test((error as Error).message)) throw error;
        await onProgress?.(`Retrying ${candidateModel} without JSON response_format.`);
        const data = await callOpenRouter(baseBody, apiKey, siteUrl, appTitle, timeoutMs);
        raw = data.choices?.[0]?.message?.content || "";
      }
      if (!raw) throw new Error("OpenRouter returned an empty response.");
      try {
        parsed = parseOpenRouterJson(raw);
      } catch (error) {
        modelErrors.push(`${candidateModel}: OpenRouter response JSON parsing failed: ${(error as Error).message}`);
        await onProgress?.(`OpenRouter model ${candidateModel} returned invalid JSON; trying the next free model.`);
        raw = "";
        continue;
      }
      break;
    } catch (error) {
      modelErrors.push(`${candidateModel}: ${(error as Error).message}`);
      if (!isRetryableModelError(error)) throw error;
      await onProgress?.(`OpenRouter model ${candidateModel} was unavailable; trying the next free model.`);
    }
  }

  if (!parsed) {
    const reason = `No OpenRouter free model endpoint was available within ${Math.max(
      1,
      maxModelAttempts
    )} attempt(s). Tried: ${modelErrors.join(" | ")}`;
    console.error(reason);
    await onProgress?.("OpenRouter was unavailable; generating deterministic fallback brief.");
    return fallbackSummary(articles, extractions, modelErrors);
  }

  return {
    parsed,
    raw,
    model: usedModel
  };
}
