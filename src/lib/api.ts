import type { BriefJobStatus, LatestPayload, ResearchItem } from "../types";

const fallbackStatus = {
  lastUpdated: null,
  itemCount: 0,
  resolvedSourceCount: 0,
  unresolvedJournalCount: 0,
  errors: ["Unable to load monitor data."]
};

function normalizePayload(payload: Partial<LatestPayload>): LatestPayload {
  return {
    metadata: payload.metadata ?? {},
    status: {
      ...fallbackStatus,
      ...(payload.status ?? {}),
      itemCount: payload.items?.length ?? payload.status?.itemCount ?? 0,
      errors: payload.status?.errors ?? []
    },
    diagnostics: payload.diagnostics ?? {},
    items: payload.items ?? []
  };
}

async function fetchJson(fetchImpl: typeof fetch, url: string, signal?: AbortSignal) {
  const response = await fetchImpl(url, { headers: { Accept: "application/json" }, signal });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

export async function loadLatestData(fetchImpl: typeof fetch = fetch): Promise<LatestPayload> {
  try {
    return normalizePayload(await fetchJson(fetchImpl, "/api/latest"));
  } catch {
    try {
      return normalizePayload(await fetchJson(fetchImpl, "/data/latest.json"));
    } catch (staticError) {
      return normalizePayload({
        status: {
          ...fallbackStatus,
          errors: [`Could not load /api/latest or /data/latest.json: ${(staticError as Error).message}`]
        },
        items: []
      });
    }
  }
}

export async function loadJournalData(
  journal: string,
  days: number,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<LatestPayload> {
  const params = new URLSearchParams({ journal, days: String(days) });
  return normalizePayload(await fetchJson(fetchImpl, `/api/journal-latest?${params}`, signal));
}

export async function startSummaryJob(items: ResearchItem[], fetchImpl: typeof fetch = fetch) {
  const response = await fetchImpl("/api/start-summary-job", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      articles: items.map((item) => ({
        id: item.id,
        title: item.title,
        authors: item.authors,
        publicationDate: item.publication_date,
        year: item.publication_year,
        journal: item.journal_name,
        doi: item.doi,
        abstract: item.abstract,
        url: item.url || item.openalex_id
      }))
    })
  });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || `${response.status} ${response.statusText}`);
  return (await response.json()) as { jobId: string; status: "queued" };
}

export async function loadSummaryStatus(jobId: string, fetchImpl: typeof fetch = fetch): Promise<BriefJobStatus> {
  return fetchJson(fetchImpl, `/api/get-summary-status?jobId=${encodeURIComponent(jobId)}`) as Promise<BriefJobStatus>;
}
