import { createHash } from "node:crypto";
import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { getEnv, jsonResponse } from "./_shared/env.js";

const STORE_NAME = "article-abstract-cache";
const CROSSREF_BASE_URL = "https://api.crossref.org";
const EUROPE_PMC_BASE_URL = "https://www.ebi.ac.uk/europepmc/webservices/rest";
const PUBMED_BASE_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const MAX_HTML_BYTES = 600_000;
const FETCH_TIMEOUT_MS = 12_000;

type AbstractResult = {
  abstract: string;
  source: string;
  sourceUrl: string;
  cached: boolean;
  errors?: string[];
};

function normalizeDoi(value = "") {
  return value
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .toLowerCase();
}

function safeUrl(value = "") {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

function cacheKey(identifier: string) {
  return `abstracts/v4/${createHash("sha256").update(identifier).digest("hex")}.json`;
}

function decodeEntities(value = "") {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " "
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower in named) return named[lower];
    if (lower.startsWith("#x")) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
    return " ";
  });
}

function stripHtml(value = "") {
  return decodeEntities(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function attr(tag: string, name: string) {
  const pattern = new RegExp(`${name}\\s*=\\s*(['"])(.*?)\\1`, "i");
  return decodeEntities(tag.match(pattern)?.[2] ?? "");
}

function plausibleAbstract(value = "") {
  const text = stripHtml(value);
  if (text.length < 80) return "";
  if (!/[.!?]/.test(text) || text.split(/\s+/).length < 14) return "";
  if (/^(cookie|javascript|enable cookies|access denied|just a moment)/i.test(text)) return "";
  return text.slice(0, 3500);
}

function firstJsonLdAbstract(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstJsonLdAbstract(item);
      if (found) return found;
    }
    return "";
  }
  const record = value as Record<string, unknown>;
  for (const key of ["abstract", "description"]) {
    const field = record[key];
    if (typeof field === "string") {
      const found = plausibleAbstract(field);
      if (found) return found;
    }
    if (Array.isArray(field)) {
      const found = firstJsonLdAbstract(field);
      if (found) return found;
    }
  }
  return firstJsonLdAbstract(record["@graph"]);
}

export function extractAbstractFromHtml(html: string) {
  const metaCandidates: string[] = [];
  const preferredNames = new Set([
    "citation_abstract",
    "dc.description",
    "dcterms.abstract",
    "dcterms.description",
    "description",
    "og:description",
    "twitter:description"
  ]);

  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const name = (attr(tag, "name") || attr(tag, "property")).toLowerCase();
    const content = attr(tag, "content");
    if (preferredNames.has(name) && content) metaCandidates.push(content);
  }

  for (const candidate of metaCandidates) {
    const found = plausibleAbstract(candidate);
    if (found) return found;
  }

  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*['"]application\/ld\+json['"][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const found = firstJsonLdAbstract(JSON.parse(decodeEntities(match[1])));
      if (found) return found;
    } catch {
      // Ignore malformed publisher JSON-LD and continue with deterministic HTML extraction.
    }
  }

  const explicitAbstractContainer =
    html.match(
      /<(section|div|article)\b(?=[^>]*(?:class|id)\s*=\s*['"][^'"]*(?:abstractBrief|article__abstract|abstract|summary)[^'"]*['"])[^>]*>([\s\S]{80,16000}?)<\/\1>/i
    )?.[2] ?? "";
  const explicitAbstract = plausibleAbstract(explicitAbstractContainer);
  if (explicitAbstract) return explicitAbstract;

  const headingAbstract =
    html.match(
      /<h[1-6]\b[^>]*>\s*(?:abstract|summary)\s*<\/h[1-6]>([\s\S]{80,16000}?)(?=<h[1-6]\b|<section\b|<article\b|$)/i
    )?.[1] ?? "";
  const headingText = plausibleAbstract(headingAbstract);
  if (headingText) return headingText;

  const sectionMatch =
    html.match(/<(section|div|article)\b[^>]*(abstract|summary)[^>]*>([\s\S]{80,16000}?)<\/\1>/i)?.[3] ?? "";
  return plausibleAbstract(sectionMatch);
}

async function fetchHtml(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.1",
        "User-Agent": "NursingResearchMonitor/1.0 abstract metadata fetcher"
      }
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const contentType = response.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml\+xml|text\/plain/i.test(contentType)) {
      throw new Error(`unsupported content type ${contentType || "unknown"}`);
    }
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_HTML_BYTES) throw new Error("HTML response too large");
    if (!response.body) return { html: await response.text(), finalUrl: response.url || url };

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (received < MAX_HTML_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      received += value.length;
      if (received > MAX_HTML_BYTES) throw new Error("HTML response too large");
      chunks.push(value);
    }
    const merged = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return { html: new TextDecoder("utf-8").decode(merged), finalUrl: response.url || url };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCrossrefAbstract(doi: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const mailto = getEnv("OPENALEX_MAILTO");
  const userAgent = mailto
    ? `NursingResearchMonitor/1.0 (mailto:${mailto})`
    : "NursingResearchMonitor/1.0 DOI metadata fetcher";
  try {
    const response = await fetch(`${CROSSREF_BASE_URL}/works/${encodeURIComponent(doi)}`, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": userAgent
      }
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const payload = (await response.json()) as {
      message?: {
        abstract?: string;
        URL?: string;
        resource?: { primary?: { URL?: string } };
      };
    };
    const abstract = plausibleAbstract(payload.message?.abstract ?? "");
    if (!abstract) throw new Error("no Crossref abstract metadata found");
    return {
      abstract,
      sourceUrl: payload.message?.resource?.primary?.URL || payload.message?.URL || `https://doi.org/${doi}`
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchEuropePmcAbstract(doi: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const url = new URL(`${EUROPE_PMC_BASE_URL}/search`);
    url.searchParams.set("query", `DOI:"${doi}"`);
    url.searchParams.set("format", "json");
    url.searchParams.set("resultType", "core");
    url.searchParams.set("pageSize", "1");
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "NursingResearchMonitor/1.0 DOI metadata fetcher"
      }
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const payload = (await response.json()) as {
      resultList?: {
        result?: Array<{
          abstractText?: string;
          fullTextUrlList?: { fullTextUrl?: Array<{ url?: string }> };
          doi?: string;
        }>;
      };
    };
    const record = payload.resultList?.result?.[0];
    const abstract = plausibleAbstract(record?.abstractText ?? "");
    if (!abstract) throw new Error("no Europe PMC abstract metadata found");
    const sourceUrl = record?.fullTextUrlList?.fullTextUrl?.find((entry) => safeUrl(entry.url))?.url || `https://doi.org/${doi}`;
    return { abstract, sourceUrl };
  } finally {
    clearTimeout(timer);
  }
}

export function extractPubMedAbstract(xml: string) {
  const parts: string[] = [];
  for (const match of xml.matchAll(/<AbstractText\b([^>]*)>([\s\S]*?)<\/AbstractText>/gi)) {
    const label = attr(match[1], "Label");
    const text = stripHtml(match[2]);
    if (!text) continue;
    parts.push(label ? `${label}: ${text}` : text);
  }
  return plausibleAbstract(parts.join(" "));
}

async function fetchPubMedAbstract(doi: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const searchUrl = new URL(`${PUBMED_BASE_URL}/esearch.fcgi`);
    searchUrl.searchParams.set("db", "pubmed");
    searchUrl.searchParams.set("retmode", "json");
    searchUrl.searchParams.set("term", `${doi}[doi]`);
    const searchResponse = await fetch(searchUrl, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "NursingResearchMonitor/1.0 DOI metadata fetcher"
      }
    });
    if (!searchResponse.ok) throw new Error(`${searchResponse.status} ${searchResponse.statusText}`);
    const searchPayload = (await searchResponse.json()) as { esearchresult?: { idlist?: string[] } };
    const pubmedId = searchPayload.esearchresult?.idlist?.[0] ?? "";
    if (!pubmedId) throw new Error("no PubMed record found for DOI");

    const fetchUrl = new URL(`${PUBMED_BASE_URL}/efetch.fcgi`);
    fetchUrl.searchParams.set("db", "pubmed");
    fetchUrl.searchParams.set("retmode", "xml");
    fetchUrl.searchParams.set("id", pubmedId);
    const fetchResponse = await fetch(fetchUrl, {
      signal: controller.signal,
      headers: {
        Accept: "application/xml,text/xml",
        "User-Agent": "NursingResearchMonitor/1.0 DOI metadata fetcher"
      }
    });
    if (!fetchResponse.ok) throw new Error(`${fetchResponse.status} ${fetchResponse.statusText}`);
    const abstract = extractPubMedAbstract(await fetchResponse.text());
    if (!abstract) throw new Error("no PubMed abstract metadata found");
    return { abstract, sourceUrl: `https://pubmed.ncbi.nlm.nih.gov/${pubmedId}/` };
  } finally {
    clearTimeout(timer);
  }
}

export default async (request: Request) => {
  if (request.method !== "GET") return jsonResponse({ error: "Method not allowed" }, { status: 405 });

  const url = new URL(request.url);
  const doi = normalizeDoi(url.searchParams.get("doi") ?? "");
  const doiUrl = doi ? `https://doi.org/${doi}` : "";
  const candidates = [
    { source: "full_text", url: safeUrl(url.searchParams.get("oaUrl") ?? "") },
    { source: "doi", url: doiUrl },
    { source: "article_url", url: safeUrl(url.searchParams.get("url") ?? "") }
  ].filter((candidate) => candidate.url && !/openalex\.org/i.test(candidate.url));

  const deduped = candidates.filter(
    (candidate, index, all) => all.findIndex((other) => other.url.toLowerCase() === candidate.url.toLowerCase()) === index
  );
  const identifier = doi || deduped[0]?.url || "";
  if (!identifier) return jsonResponse({ abstract: "", source: "", sourceUrl: "", cached: false });

  const store = getStore({ name: STORE_NAME, consistency: "strong" });
  const key = cacheKey(identifier);
  const cached = (await store.get(key, { type: "json" })) as AbstractResult | null;
  if (cached?.abstract) return jsonResponse({ ...cached, cached: true });

  const errors: string[] = [];
  if (doi) {
    try {
      const crossref = await fetchCrossrefAbstract(doi);
      const result: AbstractResult = {
        abstract: crossref.abstract,
        source: "doi_metadata",
        sourceUrl: crossref.sourceUrl,
        cached: false
      };
      await store.setJSON(key, result);
      return jsonResponse(result);
    } catch (error) {
      errors.push(`doi_metadata: ${(error as Error).message}`);
    }

    try {
      const europePmc = await fetchEuropePmcAbstract(doi);
      const result: AbstractResult = {
        abstract: europePmc.abstract,
        source: "doi_metadata",
        sourceUrl: europePmc.sourceUrl,
        cached: false
      };
      await store.setJSON(key, result);
      return jsonResponse(result);
    } catch (error) {
      errors.push(`doi_metadata_europepmc: ${(error as Error).message}`);
    }

    try {
      const pubmed = await fetchPubMedAbstract(doi);
      const result: AbstractResult = {
        abstract: pubmed.abstract,
        source: "doi_metadata",
        sourceUrl: pubmed.sourceUrl,
        cached: false
      };
      await store.setJSON(key, result);
      return jsonResponse(result);
    } catch (error) {
      errors.push(`doi_metadata_pubmed: ${(error as Error).message}`);
    }
  }

  for (const candidate of deduped) {
    try {
      const { html, finalUrl } = await fetchHtml(candidate.url);
      const abstract = extractAbstractFromHtml(html);
      if (!abstract) throw new Error("no abstract metadata found");
      const result: AbstractResult = {
        abstract,
        source: candidate.source,
        sourceUrl: finalUrl,
        cached: false
      };
      await store.setJSON(key, result);
      return jsonResponse(result);
    } catch (error) {
      errors.push(`${candidate.source}: ${(error as Error).message}`);
    }
  }

  const result: AbstractResult = { abstract: "", source: "", sourceUrl: "", cached: false, errors: errors.slice(0, 3) };
  return jsonResponse(result);
};

export const config: Config = {};
