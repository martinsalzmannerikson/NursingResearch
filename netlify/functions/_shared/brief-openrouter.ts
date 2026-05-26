import { getEnv } from "./env.js";
import { cleanBriefText, stripMarkupTags, type ArticleExtraction, type BriefArticleInput } from "./brief-utils.js";
import type { BriefDebugSummary } from "./brief-storage.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_OPENROUTER_TIMEOUT_MS = 30_000;
const MODEL_UNAVAILABLE_MESSAGE =
  "AI synthesis could not be generated. The selected OpenRouter model was unavailable or blocked by privacy/data policy settings. Try another model or adjust OpenRouter privacy settings.";
const REQUIRED_MARKDOWN_SECTIONS = [
  "Synthesis in brief",
  "Main findings across the selected articles",
  "Methodological basis",
  "Implications for nursing research",
  "Cautions",
  "Article source notes"
];

export type SummaryResult = {
  markdown: string;
  raw: string;
  model: string;
  fallback: boolean;
  fallbackReason?: string;
  errorSummary?: string[];
  debugSummary: BriefDebugSummary;
};

export type OpenRouterBriefDiagnostics = {
  debugSummary: BriefDebugSummary;
  markdownSectionLengths: Record<string, number>;
};

export class OpenRouterModelUnavailableError extends Error {
  friendlyMessage: string;
  details: string;
  debugSummary?: BriefDebugSummary;

  constructor(friendlyMessage = MODEL_UNAVAILABLE_MESSAGE, details = "", debugSummary?: BriefDebugSummary) {
    super(friendlyMessage);
    this.name = "OpenRouterModelUnavailableError";
    this.friendlyMessage = friendlyMessage;
    this.details = details;
    this.debugSummary = debugSummary;
  }
}

export class EmptyModelResponseError extends Error {
  friendlyMessage: string;
  debugSummary?: BriefDebugSummary;

  constructor(message = "The selected OpenRouter model returned an empty response.", debugSummary?: BriefDebugSummary) {
    super(message);
    this.name = "EmptyModelResponseError";
    this.friendlyMessage = message;
    this.debugSummary = debugSummary;
  }
}

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

function allowDeterministicFallbackPdf() {
  return /^true$/i.test(process.env.ALLOW_DETERMINISTIC_FALLBACK_PDF || "");
}

function parseFallbackModels() {
  return (process.env.OPENROUTER_FALLBACK_MODELS || "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item && item !== "undefined" && item !== "null");
}

export function configuredOpenRouterModels() {
  return {
    model: process.env.OPENROUTER_MODEL?.trim() || "",
    fallbackModels: parseFallbackModels()
  };
}

function sourceBasis(extraction: ArticleExtraction) {
  if (extraction.sourceStatus === "oa_fulltext_sections_used") return "OA full text sections";
  if (extraction.sourceStatus === "abstract_only") return "abstract only";
  if (extraction.sourceStatus === "fulltext_found_but_extraction_failed") {
    return "full text found but extraction failed, abstract used";
  }
  if (extraction.sourceStatus === "no_doi") return "no DOI, abstract used when available";
  return "insufficient data";
}

function yearOf(article: BriefArticleInput) {
  return article.year || article.publicationYear || article.publication_year || "";
}

function compactArticleEvidence(article: BriefArticleInput, extraction: ArticleExtraction) {
  const fullTextSections = extraction.sourceStatus === "oa_fulltext_sections_used";
  return {
    title: cleanBriefText(article.title || extraction.title || "Untitled article", 280),
    year: yearOf(article),
    journal: cleanBriefText(article.journal || article.journal_name || article.source || "", 160),
    doi: cleanBriefText(extraction.doi || article.doi || "", 160),
    sourceBasis: sourceBasis(extraction),
    sectionsUsed: extraction.sectionsUsed.map((section) => cleanBriefText(section, 80)).filter(Boolean),
    methodText: cleanBriefText(extraction.methodsText, 900),
    findingsText: cleanBriefText(extraction.findingsText, 1600),
    conclusionText: cleanBriefText(extraction.conclusionsText, 700),
    abstractText: fullTextSections ? "" : cleanBriefText(extraction.abstract || article.abstract || "", 900),
    extractionWarnings: extraction.extractionWarnings.map((warning) => cleanBriefText(warning, 120)).slice(0, 2)
  };
}

function articleEvidenceJson(articles: BriefArticleInput[], extractions: ArticleExtraction[]) {
  return articles.map((article, index) => compactArticleEvidence(article, extractions[index]));
}

function evidenceDiagnostics(evidence: ReturnType<typeof articleEvidenceJson>) {
  return evidence.map((article) => ({
    titleLength: article.title.length,
    abstractLength: article.abstractText.length,
    methodTextLength: article.methodText.length,
    findingsTextLength: article.findingsText.length,
    conclusionTextLength: article.conclusionText.length,
    sourceBasis: article.sourceBasis,
    sectionsUsed: article.sectionsUsed
  }));
}

export function buildOpenRouterMessages(articles: BriefArticleInput[], extractions: ArticleExtraction[]) {
  const evidence = articleEvidenceJson(articles, extractions);
  return [
    {
      role: "system",
      content:
        "You are writing a concise academic evidence brief for nursing researchers. Use only the supplied article material. Prefer Methods, Results/Findings, and Conclusions when available. If only an abstract is available, treat it cautiously. Do not invent details. Do not cite sections that were not supplied. Do not use article background text as findings unless the record is abstract-only and this limitation is stated."
    },
    {
      role: "user",
      content: [
        "Create a concise AI Findings Brief from the selected articles below. Synthesize across articles where possible. Do not write a technical report about the workflow. Do not mention OpenRouter. Do not mention fallback. Return simple Markdown only.",
        "Return a complete Markdown brief. Do not leave any section blank. If evidence is limited, write a cautious sentence explaining the limitation rather than omitting the section.",
        "Even when only abstracts are available, provide a cautious synthesis based on the abstracts, clearly marking this limitation.",
        "",
        "Use exactly these headings:",
        "# AI Findings Brief",
        "",
        "## Synthesis in brief",
        "One concise paragraph, 120-180 words.",
        "",
        "## Main findings across the selected articles",
        "3-5 bullet points. Each bullet should synthesize across articles where possible, not simply repeat one article at a time.",
        "",
        "## Methodological basis",
        "A short paragraph describing the kinds of evidence used, for example qualitative interview study, protocol paper, abstract-only record, OA full-text record.",
        "",
        "## Implications for nursing research",
        "2-4 bullet points.",
        "",
        "## Cautions",
        "2-4 bullet points. Mention abstract-only or extraction-failed articles here, but do not let this dominate the whole report.",
        "",
        "## Article source notes",
        "One short line per selected article: Title; year; source basis; sections used.",
        "",
        "Do not include JSON, raw HTML tags, code fences, provider errors, fallback language, or app architecture details.",
        "",
        "Selected articles:",
        JSON.stringify(evidence, null, 2)
      ].join("\n")
    }
  ];
}

export function createOpenRouterRequestBody(articles: BriefArticleInput[], extractions: ArticleExtraction[]) {
  const { model, fallbackModels } = configuredOpenRouterModels();
  const messages = buildOpenRouterMessages(articles, extractions);
  const body: Record<string, unknown> = {
    messages,
    temperature: 0.2,
    max_tokens: 1800
  };
  if (fallbackModels.length) body.models = [model, ...fallbackModels];
  else body.model = model;
  const evidence = articleEvidenceJson(articles, extractions);
  const promptCharLength = messages.reduce((total, message) => total + message.content.length, 0);
  const articleInputCharLength = JSON.stringify(evidence).length;
  return {
    body,
    model,
    fallbackModels,
    promptCharLength,
    articleInputCharLength,
    articleDiagnostics: evidenceDiagnostics(evidence)
  };
}

function friendlyOpenRouterMessage(error: unknown) {
  if (error instanceof OpenRouterRequestError) {
    if (error.status === 429) {
      return "OpenRouter rate limit: the selected model/provider is temporarily rate-limited. Try again later or choose a model/provider with available capacity.";
    }
    if (error.status === 404 && /privacy|data policy|no endpoints?|guardrail/i.test(error.body)) {
      return "OpenRouter could not find an endpoint compatible with the current privacy/data policy settings. Check OpenRouter privacy settings or choose another model/provider.";
    }
    if (error.status === 401 || error.status === 403) {
      return "OpenRouter rejected the request. Check the server-side API key and model/provider access.";
    }
    return `OpenRouter returned HTTP ${error.status}.`;
  }
  const message = (error as Error).message || "Unknown OpenRouter error.";
  if (/timed out|timeout|abort/i.test(message)) return "OpenRouter timed out before returning a usable synthesis.";
  if (/OPENROUTER_MODEL/i.test(message)) {
    return "OPENROUTER_MODEL is not set. Set it to an accessible OpenRouter model such as openai/gpt-5-mini.";
  }
  if (/OPENROUTER_API_KEY/i.test(message)) return "OPENROUTER_API_KEY is not set on the server.";
  if (/markdown|heading|empty|usable/i.test(message)) return "The selected model did not return a usable Markdown synthesis.";
  return "OpenRouter did not return a usable synthesis.";
}

function sanitizeMarkdown(markdown: string) {
  const cleaned = stripMarkupTags(markdown.replace(/```[\s\S]*?```/g, " "))
    .replace(/[\u2018\u2019\u201a]/g, "'")
    .replace(/[\u201c\u201d\u201e]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\s+(#{1,3}\s+)/g, "\n\n$1")
    .replace(/\s+(-\s+)/g, "\n$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return normalizeMarkdownHeadings(cleaned);
}

function normalizeMarkdownHeadings(markdown: string) {
  return markdown
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      const headingText = trimmed
        .replace(/^#{1,6}\s*/, "")
        .replace(/^\d+[.)]\s*/, "")
        .replace(/:$/, "")
        .trim()
        .toLowerCase();
      if (/^ai findings brief$/.test(headingText)) return "# AI Findings Brief";
      if (/^synthesis( in brief)?$|^brief synthesis$|^executive synthesis$/.test(headingText)) return "## Synthesis in brief";
      if (/^(main |key )?findings( across (the )?selected articles)?$/.test(headingText)) {
        return "## Main findings across the selected articles";
      }
      if (/^methodological (basis|profile)$|^methods? basis$/.test(headingText)) return "## Methodological basis";
      if (/^implications( for nursing research)?$/.test(headingText)) return "## Implications for nursing research";
      if (/^cautions?$|^limitations?$/.test(headingText)) return "## Cautions";
      if (/^article (source )?notes?$|^source notes?$/.test(headingText)) return "## Article source notes";
      return line;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function markdownSectionLengths(markdown: string) {
  const lengths: Record<string, number> = {};
  let current = "unsectioned";
  for (const rawLine of sanitizeMarkdown(markdown).split(/\n+/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      current = heading[1].trim();
      lengths[current] ??= 0;
      continue;
    }
    lengths[current] = (lengths[current] ?? 0) + line.length;
  }
  return lengths;
}

function validateMarkdown(markdown: string, debugSummary?: BriefDebugSummary) {
  if (!markdown.trim()) throw new EmptyModelResponseError("The selected OpenRouter model returned an empty response.", debugSummary);
  if (/openrouter|provider returned|guardrail|data policy|no endpoints available/i.test(markdown)) {
    throw new Error("OpenRouter response contained provider status text instead of a synthesis.");
  }
}

function deterministicFallbackMarkdown(articles: BriefArticleInput[], extractions: ArticleExtraction[]) {
  const lines = [
    "# Fallback Evidence Notes",
    "",
    "## Synthesis in brief",
    "A language-model synthesis was not available. These notes list only the extracted source material and should not be read as a cross-article AI synthesis.",
    "",
    "## Main findings across the selected articles"
  ];
  extractions.forEach((extraction, index) => {
    const article = articles[index];
    const text = cleanBriefText(extraction.findingsText || extraction.conclusionsText || extraction.abstract || "No usable source text.", 260);
    lines.push(`- ${cleanBriefText(article?.title || extraction.title || "Untitled article", 140)}: ${text}`);
  });
  lines.push("", "## Methodological basis");
  lines.push("The source basis varies by article and may include OA full-text sections, abstracts, or insufficient data.");
  lines.push("", "## Implications for nursing research");
  lines.push("- Use these notes only to decide which source records merit closer reading.");
  lines.push("- Avoid treating fallback notes as a synthesized evidence brief.");
  lines.push("", "## Cautions");
  lines.push("- The selected language model did not return a usable synthesis.");
  lines.push("- Abstract-only and insufficient-data records require cautious interpretation.");
  lines.push("", "## Article source notes");
  extractions.forEach((extraction, index) => {
    const article = articles[index];
    lines.push(
      `- ${cleanBriefText(article?.title || extraction.title || "Untitled article", 140)}; ${yearOf(article || {}) || "n.d."}; ${sourceBasis(
        extraction
      )}; sections used: ${extraction.sectionsUsed.join(", ") || "none"}.`
    );
  });
  return lines.join("\n");
}

async function callOpenRouter(
  body: Record<string, unknown>,
  apiKey: string,
  siteUrl: string,
  appTitle: string,
  timeoutMs: number,
  primaryModel: string
) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "X-OpenRouter-Title": appTitle || "Nursing Research Monitor"
  };
  if (siteUrl) headers["HTTP-Referer"] = siteUrl;

  console.log("Using OpenRouter model:", primaryModel);
  console.log("OpenRouter request shape:", {
    primaryModel,
    fallbackModels: Array.isArray(body.models) ? (body.models as string[]).slice(1) : [],
    strictJsonSchemaDisabled: true,
    providerRestrictionsDisabled: true
  });

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
    if (!response.ok) throw new OpenRouterRequestError(response.status, text, primaryModel);
    const parsed = JSON.parse(text) as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }>; model?: string };
    const content = parsed.choices?.[0]?.message?.content || "";
    const finishReason = parsed.choices?.[0]?.finish_reason || null;
    const responseDiagnostics = {
      openRouterStatus: response.status,
      openRouterFinishReason: finishReason,
      openRouterChoiceCount: parsed.choices?.length ?? 0,
      openRouterContentLength: content.length,
      openRouterEmptyContent: content.trim().length === 0,
      modelPreview: safePreview(content, 300)
    };
    console.log("OpenRouter response diagnostics:", responseDiagnostics);
    return { ...parsed, diagnostics: responseDiagnostics };
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      throw new Error(`OpenRouter request timed out after ${timeoutMs} ms for model ${primaryModel}.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function safePreview(value: string, max = 300) {
  return cleanBriefText(value, max);
}

export async function summarizeWithOpenRouter(
  articles: BriefArticleInput[],
  extractions: ArticleExtraction[],
  onProgress?: (message: string) => Promise<void> | void,
  options: { jobId?: string } = {}
): Promise<SummaryResult> {
  const apiKey = getEnv("OPENROUTER_API_KEY");
  const { model } = configuredOpenRouterModels();
  if (!apiKey || !model) {
    const reason = friendlyOpenRouterMessage(new Error(!apiKey ? "OPENROUTER_API_KEY is not set." : "OPENROUTER_MODEL is not set."));
    await onProgress?.(reason);
    throw new OpenRouterModelUnavailableError(MODEL_UNAVAILABLE_MESSAGE, reason, {
      modelUsed: model || null,
      inputArticleCount: articles.length,
      failurePoint: !apiKey ? "before_openrouter_missing_api_key" : "before_openrouter_missing_model"
    });
  }

  const siteUrl = getEnv("OPENROUTER_SITE_URL");
  const appTitle = getEnv("OPENROUTER_APP_TITLE", "Nursing Research Monitor");
  const timeoutMs = Number(getEnv("OPENROUTER_REQUEST_TIMEOUT_MS", String(DEFAULT_OPENROUTER_TIMEOUT_MS))) || DEFAULT_OPENROUTER_TIMEOUT_MS;
  const { body, fallbackModels, promptCharLength, articleInputCharLength, articleDiagnostics } = createOpenRouterRequestBody(
    articles,
    extractions
  );
  const debugBase: BriefDebugSummary = {
    modelUsed: model,
    fallbackModels,
    inputArticleCount: articles.length,
    promptCharLength,
    articleInputCharLength
  };
  console.log("OpenRouter preflight diagnostics:", {
    jobId: options?.jobId ?? null,
    selectedArticleCount: articles.length,
    model,
    fallbackModels,
    articles: articleDiagnostics,
    promptCharLength,
    articleInputCharLength
  });

  try {
    await onProgress?.(`Sending compact evidence package to ${model}.`);
    const data = await callOpenRouter(body, apiKey, siteUrl, appTitle, timeoutMs, model);
    const raw = data.choices?.[0]?.message?.content || "";
    const markdown = sanitizeMarkdown(raw);
    const debugSummary: BriefDebugSummary = {
      ...debugBase,
      modelUsed: data.model || model,
      ...data.diagnostics,
      markdownSectionLengths: markdownSectionLengths(markdown)
    };
    const emptySections = REQUIRED_MARKDOWN_SECTIONS.filter((name) => (debugSummary.markdownSectionLengths?.[name] ?? 0) === 0);
    console.log("Markdown parse diagnostics:", {
      jobId: options?.jobId ?? null,
      parsedSectionNames: Object.keys(debugSummary.markdownSectionLengths ?? {}),
      markdownSectionLengths: debugSummary.markdownSectionLengths,
      requiredSectionEmpty: emptySections
    });
    validateMarkdown(markdown, debugSummary);
    return {
      markdown,
      raw,
      model: data.model || model,
      fallback: false,
      errorSummary: [],
      debugSummary
    };
  } catch (error) {
    console.error("OpenRouter synthesis failed:", error);
    const reason = friendlyOpenRouterMessage(error);
    await onProgress?.("AI synthesis could not be generated.");
    if (error instanceof EmptyModelResponseError) throw error;
    const failureDebug: BriefDebugSummary = {
      ...debugBase,
      failurePoint: "openrouter_request_failed"
    };
    if (error instanceof OpenRouterRequestError) {
      failureDebug.openRouterStatus = error.status;
      failureDebug.openRouterContentLength = error.body.length;
      failureDebug.modelPreview = safePreview(error.body, 300);
    }
    if (!allowDeterministicFallbackPdf()) {
      throw new OpenRouterModelUnavailableError(MODEL_UNAVAILABLE_MESSAGE, reason, failureDebug);
    }
    const markdown = deterministicFallbackMarkdown(articles, extractions);
    return {
      markdown,
      raw: markdown,
      model: "deterministic-fallback",
      fallback: true,
      fallbackReason: reason,
      errorSummary: [reason],
      debugSummary: {
        ...debugBase,
        modelUsed: "deterministic-fallback",
        markdownSectionLengths: markdownSectionLengths(markdown),
        failurePoint: "openrouter_unavailable_deterministic_fallback"
      }
    };
  }
}
