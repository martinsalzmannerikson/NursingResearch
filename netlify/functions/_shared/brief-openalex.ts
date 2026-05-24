import { getEnv } from "./env.js";
import {
  BRIEF_CACHE_STORE,
  capText,
  doiCacheKey,
  extractSections,
  normalizeDoi,
  reconstructAbstract,
  type ArticleExtraction,
  type BriefArticleInput
} from "./brief-utils.js";
import { getStore } from "@netlify/blobs";

const OPENALEX_SELECT = [
  "id",
  "doi",
  "display_name",
  "publication_year",
  "publication_date",
  "type",
  "language",
  "is_retracted",
  "primary_location",
  "best_oa_location",
  "open_access",
  "abstract_inverted_index",
  "has_content",
  "content_url",
  "authorships",
  "biblio"
].join(",");

const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 12_000;

type OaChoice = {
  url: string;
  kind: "pdf" | "html" | "content";
  license: string;
  status: "oa_fulltext" | "not_oa" | "unknown";
};

function openAlexUrlForDoi(doi: string) {
  const url = new URL(`/works/doi:${encodeURIComponent(doi)}`, "https://api.openalex.org");
  url.searchParams.set("select", OPENALEX_SELECT);
  const apiKey = getEnv("OPENALEX_API_KEY");
  const mailto = getEnv("OPENALEX_MAILTO");
  if (apiKey) url.searchParams.set("api_key", apiKey);
  if (mailto) url.searchParams.set("mailto", mailto);
  return url;
}

function locationUrl(location: Record<string, unknown> | null | undefined): OaChoice | null {
  if (!location || typeof location !== "object") return null;
  const isOa = Boolean(location.is_oa);
  const pdfUrl = String(location.pdf_url || "");
  const landingPageUrl = String(location.landing_page_url || "");
  if (!isOa) return null;
  if (pdfUrl) {
    return { url: pdfUrl, kind: "pdf", license: String(location.license || ""), status: "oa_fulltext" };
  }
  if (landingPageUrl) {
    return { url: landingPageUrl, kind: "html", license: String(location.license || ""), status: "oa_fulltext" };
  }
  return null;
}

export function chooseOpenAccessSource(work: Record<string, unknown>): OaChoice | null {
  const best = locationUrl(work.best_oa_location as Record<string, unknown> | null);
  if (best) return best;

  const contentUrl = String(work.content_url || "");
  const hasContent = work.has_content as Record<string, unknown> | undefined;
  if (contentUrl && (hasContent?.pdf || hasContent?.grobid_xml)) {
    return { url: contentUrl, kind: hasContent.grobid_xml ? "content" : "pdf", license: "", status: "oa_fulltext" };
  }

  const primary = locationUrl(work.primary_location as Record<string, unknown> | null);
  if (primary) return primary;
  return null;
}

async function fetchJson(url: URL) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`OpenAlex ${response.status}: ${await response.text()}`);
  return (await response.json()) as Record<string, unknown>;
}

async function fetchLimitedText(url: string, expectedKind: OaChoice["kind"]) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept:
          expectedKind === "pdf"
            ? "application/pdf,text/html,application/xhtml+xml;q=0.8,*/*;q=0.5"
            : "text/html,application/xhtml+xml,application/xml,text/plain,*/*;q=0.5"
      }
    });
    if (!response.ok) throw new Error(`Fulltext fetch ${response.status}`);
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_DOWNLOAD_BYTES) throw new Error("Fulltext download exceeded size limit.");
    const contentType = response.headers.get("content-type") || "";
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_DOWNLOAD_BYTES) throw new Error("Fulltext download exceeded size limit.");
    if (/pdf/i.test(contentType) || expectedKind === "pdf") {
      throw new Error("PDF fulltext found, but PDF section parsing is not enabled in this MVP.");
    }
    if (!/html|xml|text/i.test(contentType) && expectedKind !== "content") {
      throw new Error(`Unsupported fulltext content type: ${contentType || "unknown"}`);
    }
    return new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  } finally {
    clearTimeout(timeout);
  }
}

function abstractFrom(article: BriefArticleInput, work?: Record<string, unknown>) {
  return (
    reconstructAbstract(work?.abstract_inverted_index) ||
    String(article.abstract || "") ||
    ""
  );
}

function fallbackExtraction(
  article: BriefArticleInput,
  doi: string,
  sourceStatus: ArticleExtraction["sourceStatus"],
  warnings: string[],
  work?: Record<string, unknown>,
  sourceUrl = "",
  license = ""
): ArticleExtraction {
  const abstract = capText(abstractFrom(article, work), 2500);
  return {
    doi,
    checkedAt: new Date().toISOString(),
    oaStatus:
      sourceStatus === "abstract_only"
        ? "not_oa"
        : sourceStatus === "fulltext_found_but_extraction_failed"
          ? "oa_fulltext"
          : "unknown",
    sourceStatus: abstract ? sourceStatus : "insufficient_data",
    sourceUrl,
    license,
    sectionsUsed: abstract ? ["Abstract"] : [],
    methodsText: "",
    findingsText: "",
    conclusionsText: "",
    abstract,
    extractionWarnings: abstract ? warnings : [...warnings, "no_usable_abstract"],
    confidence: abstract ? "medium" : "low",
    title: String(work?.display_name || article.title || "Untitled article"),
    isRetracted: Boolean(work?.is_retracted)
  };
}

export async function resolveArticleEvidence(article: BriefArticleInput): Promise<ArticleExtraction> {
  const doi = normalizeDoi(article.doi);
  if (!doi) {
    return fallbackExtraction(article, "", "no_doi", ["no_doi"]);
  }

  const cache = getStore({ name: BRIEF_CACHE_STORE, consistency: "strong" });
  const cacheKey = doiCacheKey(doi);
  const cached = (await cache.get(cacheKey, { type: "json" }).catch(() => null)) as ArticleExtraction | null;
  if (cached?.doi) return cached;

  let work: Record<string, unknown>;
  try {
    work = await fetchJson(openAlexUrlForDoi(doi));
  } catch (error) {
    const fallback = fallbackExtraction(article, doi, "abstract_only", [`openalex_lookup_failed: ${(error as Error).message}`]);
    await cache.setJSON(cacheKey, fallback);
    return fallback;
  }

  const oaChoice = chooseOpenAccessSource(work);
  if (!oaChoice) {
    // Academically important: absence of an OpenAlex-reported legal OA location means abstract-only.
    // We do not attempt subscription scraping or paywall bypasses.
    const fallback = fallbackExtraction(article, doi, "abstract_only", ["no_legal_oa_fulltext_found"], work);
    await cache.setJSON(cacheKey, fallback);
    return fallback;
  }

  try {
    const text = await fetchLimitedText(oaChoice.url, oaChoice.kind);
    const extracted = extractSections(text);
    if (extracted.confidence === "low") {
      // Full text was legally reachable, but noisy section extraction would risk misleading synthesis.
      // Store only the abstract fallback and the warning, not the full article text.
      const fallback = fallbackExtraction(
        article,
        doi,
        "fulltext_found_but_extraction_failed",
        ["fulltext_found_but_sections_not_reliably_extracted", ...extracted.extractionWarnings],
        work,
        oaChoice.url,
        oaChoice.license
      );
      await cache.setJSON(cacheKey, fallback);
      return fallback;
    }
    const result: ArticleExtraction = {
      ...extracted,
      doi,
      checkedAt: new Date().toISOString(),
      oaStatus: "oa_fulltext",
      sourceStatus: "oa_fulltext_sections_used",
      sourceUrl: oaChoice.url,
      license: oaChoice.license,
      abstract: capText(abstractFrom(article, work), 2500),
      title: String(work.display_name || article.title || "Untitled article"),
      isRetracted: Boolean(work.is_retracted)
    };
    await cache.setJSON(cacheKey, result);
    return result;
  } catch (error) {
    const fallback = fallbackExtraction(
      article,
      doi,
      "fulltext_found_but_extraction_failed",
      [`fulltext_retrieval_or_parsing_failed: ${(error as Error).message}`],
      work,
      oaChoice.url,
      oaChoice.license
    );
    await cache.setJSON(cacheKey, fallback);
    return fallback;
  }
}
