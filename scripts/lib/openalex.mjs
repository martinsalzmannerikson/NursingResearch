import { normalizeDoi, normalizeTitle, rowsToCsv } from "./csv.mjs";

export const OPENALEX_BASE_URL = "https://api.openalex.org";
export const STORE_NAME = "nursing-research-monitor";

const WORK_SELECT_FIELDS = [
  "id",
  "doi",
  "title",
  "display_name",
  "publication_date",
  "publication_year",
  "authorships",
  "primary_location",
  "locations",
  "abstract_inverted_index",
  "cited_by_count",
  "type",
  "is_retracted",
  "open_access"
].join(",");

export function openAlexKey(id = "") {
  const raw = String(id || "").trim();
  if (!raw) return "";
  const key = raw.split("/").pop() || raw;
  return key.toUpperCase();
}

export function sourceUrlFromKey(key = "") {
  const sourceKey = openAlexKey(key);
  return sourceKey ? `https://openalex.org/${sourceKey}` : "";
}

export function chunkArray(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function tokenSet(value) {
  return new Set(normalizeTitle(value).split(" ").filter((token) => token.length > 1));
}

function tokenOverlapScore(left, right) {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let hits = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) hits += 1;
  }
  return hits / Math.max(leftTokens.size, rightTokens.size);
}

function knownIssns(journal) {
  return [journal.issn_l, journal.issn_print, journal.issn_online]
    .flatMap((value) => String(value || "").split(/[;|,]\s*/))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function confidenceLabel(score) {
  if (score >= 88) return "resolved_high";
  if (score >= 68) return "resolved_medium";
  if (score >= 45) return "resolved_low";
  return "unresolved";
}

export function scoreOpenAlexSource(journal, source) {
  const variants = [...(journal.title_variants || []), journal.journal_name]
    .map((value) => normalizeTitle(value))
    .filter(Boolean);
  const sourceNames = [
    source.display_name,
    source.abbreviated_title,
    ...(source.alternate_titles || [])
  ]
    .map((value) => normalizeTitle(value))
    .filter(Boolean);

  let score = source.type === "journal" ? 20 : -20;
  let reason = source.type === "journal" ? "type=journal" : `type=${source.type || "unknown"}`;

  const exactTitleMatch = sourceNames.some((name) => variants.includes(name));
  if (exactTitleMatch) {
    score += 70;
    reason += "; exact-title";
  } else {
    const partial = Math.max(
      0,
      ...sourceNames.flatMap((sourceName) => variants.map((variant) => tokenOverlapScore(sourceName, variant)))
    );
    if (partial >= 0.88) {
      score += 50;
      reason += "; near-title";
    } else if (partial >= 0.65) {
      score += 32;
      reason += "; partial-title";
    } else if (partial >= 0.45) {
      score += 18;
      reason += "; weak-title";
    }
  }

  const journalIssns = knownIssns(journal);
  const sourceIssns = [source.issn_l, ...(source.issn || [])]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);
  if (journalIssns.length && sourceIssns.some((issn) => journalIssns.includes(issn))) {
    score += 55;
    reason += "; issn";
  }

  const publisherText = [source.host_organization_name, source.host_organization].filter(Boolean).join(" ");
  const publisherScore = tokenOverlapScore(journal.publisher, publisherText);
  if (publisherScore >= 0.65) {
    score += 12;
    reason += "; publisher";
  } else if (publisherScore >= 0.35) {
    score += 6;
    reason += "; publisher-lite";
  }

  const worksCount = Number(source.works_count || 0);
  if (worksCount > 5000) score += 8;
  else if (worksCount > 1000) score += 6;
  else if (worksCount > 100) score += 4;

  const capped = Math.max(0, Math.min(100, Math.round(score)));
  return { score: capped, label: confidenceLabel(capped), reason };
}

function withOpenAlexAuth(url, env = process.env) {
  const apiKey = env.OPENALEX_API_KEY;
  const mailto = env.OPENALEX_MAILTO;
  if (apiKey) url.searchParams.set("api_key", apiKey);
  if (mailto) url.searchParams.set("mailto", mailto);
  return url;
}

export async function fetchJsonWithRetry(url, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const retries = options.retries ?? 2;
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: {
          "User-Agent": "NursingResearchMonitor/1.0 (OpenAlex source resolver)",
          Accept: "application/json",
          ...(options.headers || {})
        }
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        const error = new Error(`OpenAlex ${response.status} ${response.statusText}: ${body.slice(0, 300)}`);
        error.status = response.status;
        error.nonRetryable = response.status < 500 || /insufficient budget|rate limit exceeded/i.test(body);
        throw error;
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (error.nonRetryable) break;
      if (attempt === retries) break;
      await new Promise((resolve) => setTimeout(resolve, 450 * (attempt + 1)));
    }
  }

  throw lastError;
}

export async function searchOpenAlexSources(query, options = {}) {
  const url = withOpenAlexAuth(new URL("/sources", OPENALEX_BASE_URL), options.env);
  url.searchParams.set("search", query);
  url.searchParams.set("filter", "type:journal");
  url.searchParams.set("per-page", String(options.perPage || 10));
  const data = await fetchJsonWithRetry(url, options);
  return Array.isArray(data.results) ? data.results : [];
}

export async function resolveJournalSource(journal, options = {}) {
  if (options.disabledReason) {
    return {
      journal_id: journal.journal_id,
      journal_name: journal.journal_name,
      journal,
      status: "unresolved",
      confidence: 0,
      warning: `OpenAlex resolution skipped: ${options.disabledReason}`,
      openalex_source_id: "",
      openalex_source_key: "",
      display_name: "",
      issn_l: "",
      issn: [],
      host_organization: "",
      works_count: 0,
      candidates: []
    };
  }

  if (journal.openalex_source_id) {
    return {
      journal_id: journal.journal_id,
      journal_name: journal.journal_name,
      journal,
      status: "resolved_high",
      confidence: 100,
      warning: "",
      openalex_source_id: sourceUrlFromKey(journal.openalex_source_id),
      openalex_source_key: openAlexKey(journal.openalex_source_id),
      display_name: journal.journal_name,
      issn_l: journal.issn_l,
      issn: [journal.issn_l, journal.issn_print, journal.issn_online].filter(Boolean),
      host_organization: "",
      works_count: null,
      candidates: []
    };
  }

  const variants = [...new Set([...(journal.title_variants || []), journal.journal_name].filter(Boolean))].slice(0, 5);
  const byId = new Map();
  const errors = [];

  for (const variant of variants) {
    try {
      const candidates = await searchOpenAlexSources(variant, options);
      for (const source of candidates) {
        byId.set(source.id, source);
      }
    } catch (error) {
      errors.push(`${variant}: ${error.message}`);
    }
  }

  const candidates = [...byId.values()]
    .map((source) => {
      const score = scoreOpenAlexSource(journal, source);
      return {
        id: source.id,
        display_name: source.display_name,
        type: source.type,
        issn_l: source.issn_l || "",
        issn: source.issn || [],
        host_organization: source.host_organization_name || source.host_organization || "",
        works_count: source.works_count || 0,
        confidence: score.score,
        status: score.label,
        reason: score.reason
      };
    })
    .sort((left, right) => right.confidence - left.confidence || right.works_count - left.works_count);

  const best = candidates[0];
  const second = candidates[1];
  const onlyPlausibleLow =
    best &&
    best.status === "resolved_low" &&
    candidates.filter((candidate) => candidate.confidence >= 35 && candidate.type === "journal").length === 1;
  const accepted = Boolean(
    best &&
      (best.status === "resolved_high" ||
        best.status === "resolved_medium" ||
        (onlyPlausibleLow && best.confidence >= 45))
  );
  const status = accepted ? best.status : "unresolved";
  const warning = [
    accepted && best.status === "resolved_low"
      ? "Low-confidence source accepted because it was the only plausible journal candidate."
      : "",
    accepted && second && best.confidence - second.confidence < 8
      ? `Close second candidate: ${second.display_name} (${second.confidence}).`
      : "",
    errors.length ? `OpenAlex search errors: ${errors.join(" | ")}` : ""
  ]
    .filter(Boolean)
    .join(" ");

  return {
    journal_id: journal.journal_id,
    journal_name: journal.journal_name,
    journal,
    status,
    confidence: accepted ? best.confidence : 0,
    warning,
    openalex_source_id: accepted ? best.id : "",
    openalex_source_key: accepted ? openAlexKey(best.id) : "",
    display_name: accepted ? best.display_name : "",
    issn_l: accepted ? best.issn_l : "",
    issn: accepted ? best.issn : [],
    host_organization: accepted ? best.host_organization : "",
    works_count: accepted ? best.works_count : 0,
    candidates: candidates.slice(0, 5)
  };
}

export function sourceMapStats(entries) {
  return {
    totalJournalCount: entries.length,
    resolvedSourceCount: entries.filter((entry) => entry.openalex_source_id).length,
    unresolvedJournalCount: entries.filter((entry) => !entry.openalex_source_id).length,
    lowConfidenceCount: entries.filter((entry) => entry.status === "resolved_low").length
  };
}

export function unresolvedRows(entries) {
  return entries
    .filter((entry) => !entry.openalex_source_id || entry.status === "resolved_low" || entry.warning)
    .map((entry) => ({
      journal_id: entry.journal_id,
      journal_name: entry.journal_name,
      publisher: entry.journal?.publisher || "",
      status: entry.status,
      confidence: entry.confidence,
      warning: entry.warning || "",
      best_candidate: entry.candidates?.[0]?.display_name || "",
      best_candidate_confidence: entry.candidates?.[0]?.confidence ?? "",
      best_candidate_id: entry.candidates?.[0]?.id || "",
      openalex_search_hint: entry.journal?.openalex_source_search_hint || ""
    }));
}

export function unresolvedCsv(entries) {
  return rowsToCsv(unresolvedRows(entries), [
    "journal_id",
    "journal_name",
    "publisher",
    "status",
    "confidence",
    "warning",
    "best_candidate",
    "best_candidate_confidence",
    "best_candidate_id",
    "openalex_search_hint"
  ]);
}

export function reconstructAbstract(abstractInvertedIndex) {
  if (!abstractInvertedIndex || typeof abstractInvertedIndex !== "object") return "";
  const words = [];
  for (const [word, positions] of Object.entries(abstractInvertedIndex)) {
    if (!Array.isArray(positions)) continue;
    for (const position of positions) {
      if (Number.isInteger(position) && position >= 0) words[position] = word;
    }
  }
  return words
    .filter((word) => typeof word === "string")
    .join(" ")
    .replace(/\s+([,.;:!?%)])/g, "$1")
    .replace(/([(])\s+/g, "$1")
    .trim();
}

function sourceFromWork(work) {
  if (work.primary_location?.source?.id) return work.primary_location.source;
  const location = (work.locations || []).find((item) => item.source?.id);
  return location?.source || null;
}

function doiUrl(doi) {
  const normalized = normalizeDoi(doi);
  return normalized ? `https://doi.org/${normalized}` : "";
}

export function workToResearchItem(work, sourceByKey, fetchedAt) {
  const source = sourceFromWork(work);
  const sourceKey = openAlexKey(source?.id);
  const mapEntry = sourceByKey.get(sourceKey);
  const journal = mapEntry?.journal || {};
  const doi = doiUrl(work.doi);
  const authors = (work.authorships || [])
    .map((authorship) => authorship.author?.display_name)
    .filter(Boolean);

  return {
    id: normalizeDoi(doi) || openAlexKey(work.id),
    title: work.title || work.display_name || "Untitled OpenAlex work",
    doi,
    openalex_id: work.id || "",
    publication_date: work.publication_date || "",
    publication_year: work.publication_year || null,
    authors,
    journal_name: journal.journal_name || source?.display_name || mapEntry?.display_name || "Unknown journal",
    journal_id: journal.journal_id || mapEntry?.journal_id || sourceKey,
    publisher: journal.publisher || source?.publisher || "",
    wos_core: journal.wos_core || "",
    is_wos_core: Boolean(journal.is_wos_core),
    is_scopus: Boolean(journal.is_scopus),
    norwegian_level: journal.norwegian_level || "",
    abstract: reconstructAbstract(work.abstract_inverted_index),
    url: doi || work.primary_location?.landing_page_url || work.id || "",
    oa_url: work.open_access?.oa_url || work.primary_location?.pdf_url || "",
    is_oa: Boolean(work.open_access?.is_oa),
    cited_by_count: Number(work.cited_by_count || 0),
    source_api: "OpenAlex",
    fetched_at: fetchedAt
  };
}

export function dedupeWorks(items) {
  const seenDoi = new Set();
  const seenOpenAlex = new Set();
  const output = [];

  for (const item of items) {
    const doi = normalizeDoi(item.doi);
    const openalex = String(item.openalex_id || item.id || "").toLowerCase();
    if (doi && seenDoi.has(doi)) continue;
    if (!doi && openalex && seenOpenAlex.has(openalex)) continue;
    if (doi) seenDoi.add(doi);
    if (openalex) seenOpenAlex.add(openalex);
    output.push(item);
  }

  return output;
}

function buildWorksUrl(sourceKeys, cursor, options = {}) {
  const fromDate = options.fromDate;
  const filters = [
    `primary_location.source.id:${sourceKeys.join("|")}`,
    fromDate ? `from_publication_date:${fromDate}` : "",
    options.includeTypeFilter === false ? "" : "type:article|review",
    "is_retracted:false"
  ].filter(Boolean);

  const url = withOpenAlexAuth(new URL("/works", OPENALEX_BASE_URL), options.env);
  url.searchParams.set("filter", filters.join(","));
  url.searchParams.set("sort", "publication_date:desc");
  url.searchParams.set("per-page", String(options.perPage || 200));
  url.searchParams.set("cursor", cursor);
  url.searchParams.set("select", WORK_SELECT_FIELDS);
  return url;
}

export function latestFallback({ sourceMap = [], errors = [], days = 90, maxResults = 1000 } = {}) {
  const stats = sourceMapStats(sourceMap);
  const lastUpdated = new Date().toISOString();
  return {
    metadata: {
      generated_at: lastUpdated,
      source_api: "OpenAlex",
      recentDays: days,
      maxResults,
      fallback: true,
      message: "Live OpenAlex fetch did not produce article data; serving an explicit empty fallback."
    },
    status: {
      lastUpdated,
      itemCount: 0,
      resolvedSourceCount: stats.resolvedSourceCount,
      unresolvedJournalCount: stats.unresolvedJournalCount,
      errors: errors.length ? errors : ["No resolved source IDs or no OpenAlex results were available."]
    },
    diagnostics: stats,
    items: []
  };
}

export async function fetchLatestWorks(sourceMap, options = {}) {
  const days = Number(options.days || process.env.RECENT_DAYS || 90);
  const maxResults = Number(options.maxResults || process.env.MAX_RESULTS || 1000);
  const fetchedAt = new Date().toISOString();
  const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const resolvedEntries = sourceMap.filter((entry) => entry.openalex_source_id && entry.openalex_source_key);
  const sourceByKey = new Map(resolvedEntries.map((entry) => [entry.openalex_source_key, entry]));
  const sourceKeys = [...sourceByKey.keys()];
  const errors = [];

  if (sourceKeys.length === 0) {
    return latestFallback({ sourceMap, errors: ["No resolved OpenAlex source IDs."], days, maxResults });
  }

  const items = [];
  const chunks = chunkArray(sourceKeys, 100);

  for (const sourceChunk of chunks) {
    let cursor = "*";
    const maxPages = Number(options.maxPagesPerChunk || process.env.OPENALEX_MAX_PAGES_PER_CHUNK || 3);
    for (let page = 0; page < maxPages; page += 1) {
      try {
        const url = buildWorksUrl(sourceChunk, cursor, { ...options, fromDate, includeTypeFilter: true });
        const data = await fetchJsonWithRetry(url, options);
        const results = Array.isArray(data.results) ? data.results : [];
        items.push(...results.map((work) => workToResearchItem(work, sourceByKey, fetchedAt)));
        cursor = data.meta?.next_cursor;
        if (!cursor || results.length === 0 || items.length >= maxResults * 2) break;
      } catch {
        try {
          const retryUrl = buildWorksUrl(sourceChunk, cursor, { ...options, fromDate, includeTypeFilter: false });
          const data = await fetchJsonWithRetry(retryUrl, options);
          const results = Array.isArray(data.results) ? data.results : [];
          items.push(...results.map((work) => workToResearchItem(work, sourceByKey, fetchedAt)));
          cursor = data.meta?.next_cursor;
          if (!cursor || results.length === 0) break;
        } catch (retryError) {
          errors.push(`Works fetch failed for ${sourceChunk[0]}..${sourceChunk.at(-1)}: ${retryError.message}`);
          break;
        }
      }
    }
  }

  const sorted = dedupeWorks(items)
    .sort((left, right) => {
      const dateOrder = String(right.publication_date).localeCompare(String(left.publication_date));
      return dateOrder || Number(right.cited_by_count || 0) - Number(left.cited_by_count || 0);
    })
    .slice(0, maxResults);
  const stats = sourceMapStats(sourceMap);

  return {
    metadata: {
      generated_at: fetchedAt,
      source_api: "OpenAlex",
      recentDays: days,
      maxResults,
      fallback: false
    },
    status: {
      lastUpdated: fetchedAt,
      itemCount: sorted.length,
      resolvedSourceCount: stats.resolvedSourceCount,
      unresolvedJournalCount: stats.unresolvedJournalCount,
      errors
    },
    diagnostics: {
      ...stats,
      fetchedSourceChunks: chunks.length,
      fromPublicationDate: fromDate
    },
    items: sorted
  };
}
