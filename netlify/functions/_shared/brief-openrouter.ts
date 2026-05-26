import { getEnv } from "./env.js";
import { capText, parseOpenRouterJson, type ArticleExtraction, type BriefArticleInput } from "./brief-utils.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
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
            "Create an AI-assisted findings brief. Include executiveSummary, keyFindings, methodologicalProfile, implicationsForNursingResearch, limitationsOfEvidenceBase, articleNotes, and sourceStatusSummary.",
          outputShape: {
            executiveSummary: "string",
            keyFindings: ["string"],
            methodologicalProfile: ["string"],
            implicationsForNursingResearch: ["string"],
            limitationsOfEvidenceBase: ["string"],
            articleNotes: [{ title: "string", note: "string", sourceStatus: "string" }],
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

async function callOpenRouter(body: Record<string, unknown>, apiKey: string, siteUrl: string, appTitle: string) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "X-OpenRouter-Title": appTitle || "Nursing Research Monitor"
  };
  if (siteUrl) headers["HTTP-Referer"] = siteUrl;

  console.log("Using OpenRouter model:", body.model);
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${text}`);
  return JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> };
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
  return /no endpoints?|guardrail|data policy|privacy|model not found|provider returned error|temporarily|rate.?limit|upstream|404|429|503/i.test(
    (error as Error).message
  );
}

export async function summarizeWithOpenRouter(articles: BriefArticleInput[], extractions: ArticleExtraction[]) {
  const apiKey = getEnv("OPENROUTER_API_KEY");
  const model = process.env.OPENROUTER_MODEL?.trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set.");
  if (!model) throw new Error("OPENROUTER_MODEL is not set. Set it in Netlify environment variables.");

  const siteUrl = getEnv("OPENROUTER_SITE_URL");
  const appTitle = getEnv("OPENROUTER_APP_TITLE", "Nursing Research Monitor");

  let data;
  let usedModel = model;
  const modelErrors: string[] = [];

  for (const candidateModel of modelCandidates(model)) {
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
      try {
        data = await callOpenRouter({ ...baseBody, response_format: { type: "json_object" } }, apiKey, siteUrl, appTitle);
      } catch (error) {
        if (!/response_format|json_object|schema|unsupported|400/i.test((error as Error).message)) throw error;
        data = await callOpenRouter(baseBody, apiKey, siteUrl, appTitle);
      }
      break;
    } catch (error) {
      modelErrors.push(`${candidateModel}: ${(error as Error).message}`);
      if (!isRetryableModelError(error)) throw error;
    }
  }

  if (!data) {
    throw new Error(`No OpenRouter free model endpoint was available. Tried: ${modelErrors.join(" | ")}`);
  }

  const content = data.choices?.[0]?.message?.content || "";
  if (!content) throw new Error("OpenRouter returned an empty response.");
  let parsed;
  try {
    parsed = parseOpenRouterJson(content);
  } catch (error) {
    throw Object.assign(new Error(`OpenRouter response JSON parsing failed: ${(error as Error).message}`), {
      rawModelResponse: content
    });
  }
  return {
    parsed,
    raw: content,
    model: usedModel
  };
}
