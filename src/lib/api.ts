import type { LatestPayload } from "../types";

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

async function fetchJson(fetchImpl: typeof fetch, url: string) {
  const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
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
