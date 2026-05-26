import { getEnv } from "./env.js";

export const MAX_ARTICLES_PER_BRIEF = Number(getEnv("MAX_ARTICLES_PER_BRIEF", "6")) || 6;
export const BRIEF_JOB_STORE = "ai-brief-jobs";
export const BRIEF_PDF_STORE = "ai-brief-pdfs";
export const BRIEF_CACHE_STORE = "ai-brief-article-cache";

export type BriefArticleInput = {
  id?: string;
  title?: string;
  authors?: string[];
  year?: number | null;
  publicationYear?: number | null;
  publication_year?: number | null;
  publicationDate?: string;
  publication_date?: string;
  journal?: string;
  journal_name?: string;
  source?: string;
  doi?: string;
  abstract?: string;
  url?: string;
  openalex_id?: string;
};

export type SectionExtraction = {
  methodsText: string;
  findingsText: string;
  conclusionsText: string;
  sectionsUsed: string[];
  extractionWarnings: string[];
  confidence: "high" | "medium" | "low";
};

export type ArticleExtraction = SectionExtraction & {
  doi: string;
  checkedAt: string;
  oaStatus: "oa_fulltext" | "not_oa" | "unknown";
  sourceStatus:
    | "oa_fulltext_sections_used"
    | "abstract_only"
    | "fulltext_found_but_extraction_failed"
    | "no_doi"
    | "insufficient_data";
  sourceUrl: string;
  license: string;
  abstract: string;
  title: string;
  isRetracted: boolean;
};

export type SourceCoverage = {
  oaFullTextUsed: number;
  abstractOnly: number;
  fulltextFoundButExtractionFailed: number;
  noDoi: number;
  insufficientData: number;
};

export function normalizeDoi(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .trim()
    .toLowerCase();
}

export function doiCacheKey(doi: string) {
  return `doi-${normalizeDoi(doi).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.json`;
}

export function capText(value: string, max: number) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max).trim()}...` : clean;
}

export function reconstructAbstract(abstractInvertedIndex: unknown) {
  if (!abstractInvertedIndex || typeof abstractInvertedIndex !== "object") return "";
  const words: string[] = [];
  for (const [word, positions] of Object.entries(abstractInvertedIndex as Record<string, unknown>)) {
    if (!Array.isArray(positions)) continue;
    for (const position of positions) {
      if (Number.isInteger(position) && position >= 0) words[position] = word;
    }
  }
  return words
    .filter(Boolean)
    .join(" ")
    .replace(/\s+([,.;:!?%)])/g, "$1")
    .replace(/([(])\s+/g, "$1")
    .trim();
}

function plainSectionsFromHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(h[1-6])[^>]*>/gi, "\n@@HEADING@@")
    .replace(/<\/(h[1-6])>/gi, "\n")
    .replace(/<\/(section|article|p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function headingKind(heading: string): "methods" | "findings" | "conclusions" | "combined" | "stop" | null {
  const clean = heading.toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
  if (/^(references|acknowledg|supplementary|appendix)/.test(clean)) return "stop";
  if (/^(introduction|background|literature review|discussion|implications)/.test(clean)) return "stop";
  if (/results? and discussion|findings? and discussion/.test(clean)) return "combined";
  if (/^(methods?|methodology|materials and methods)\b/.test(clean)) return "methods";
  if (/^(results?|findings?|results and findings)\b/.test(clean)) return "findings";
  if (/^(conclusions?|concluding remarks)\b/.test(clean)) return "conclusions";
  return null;
}

export function extractSections(rawText: string): SectionExtraction {
  const text = rawText.includes("<") && rawText.includes(">") ? plainSectionsFromHtml(rawText) : rawText;
  const warnings: string[] = [];
  const buckets = { methods: "", findings: "", conclusions: "" };
  const used = new Set<string>();
  let current: keyof typeof buckets | null = null;
  let skip = false;

  for (const rawLine of text.split(/\n+/)) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line) continue;
    const heading = line.startsWith("@@HEADING@@") ? line.replace("@@HEADING@@", "").trim() : line;
    const kind = line.startsWith("@@HEADING@@") ? headingKind(heading) : null;
    if (kind) {
      if (kind === "stop") {
        current = null;
        skip = true;
        continue;
      }
      skip = false;
      if (kind === "combined") {
        current = "findings";
        used.add(heading || "Results and discussion");
        warnings.push("combined_findings_discussion_section");
        continue;
      }
      current = kind;
      used.add(heading || kind);
      continue;
    }
    if (!current || skip) continue;
    buckets[current] = `${buckets[current]} ${line}`.trim();
  }

  const extraction: SectionExtraction = {
    methodsText: capText(buckets.methods, 2500),
    findingsText: capText(buckets.findings, 7000),
    conclusionsText: capText(buckets.conclusions, 2500),
    sectionsUsed: [...used],
    extractionWarnings: [...new Set(warnings)],
    confidence: buckets.findings && (buckets.methods || buckets.conclusions) ? "high" : buckets.findings ? "medium" : "low"
  };
  return extraction;
}

export function sourceCoverage(items: Array<Pick<ArticleExtraction, "sourceStatus">>): SourceCoverage {
  return {
    oaFullTextUsed: items.filter((item) => item.sourceStatus === "oa_fulltext_sections_used").length,
    abstractOnly: items.filter((item) => item.sourceStatus === "abstract_only").length,
    fulltextFoundButExtractionFailed: items.filter((item) => item.sourceStatus === "fulltext_found_but_extraction_failed").length,
    noDoi: items.filter((item) => item.sourceStatus === "no_doi").length,
    insufficientData: items.filter((item) => item.sourceStatus === "insufficient_data").length
  };
}

export function normalizeArticleInput(article: BriefArticleInput) {
  return {
    id: String(article.id || article.openalex_id || article.doi || crypto.randomUUID()),
    title: String(article.title || "Untitled article").slice(0, 700),
    authors: Array.isArray(article.authors) ? article.authors.map(String).slice(0, 20) : [],
    year: Number(article.year || article.publicationYear || article.publication_year || 0) || null,
    publicationDate: String(article.publicationDate || article.publication_date || ""),
    journal: String(article.journal || article.journal_name || article.source || ""),
    doi: normalizeDoi(article.doi),
    abstract: capText(String(article.abstract || ""), 2500),
    url: String(article.url || "")
  };
}

export function parseOpenRouterJson(content: string) {
  const trimmed = content.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("OpenRouter response did not contain JSON.");
    return JSON.parse(match[0]);
  }
}
