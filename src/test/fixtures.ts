import type { LatestPayload, ResearchItem } from "../types";

export const itemA: ResearchItem = {
  id: "10.1000/a",
  title: "Digital nursing education improves clinical reasoning",
  doi: "https://doi.org/10.1000/a",
  openalex_id: "https://openalex.org/W1",
  publication_date: "2026-05-01",
  publication_year: 2026,
  authors: ["Anna Berg", "Lina Holm", "Nora Vik", "Sara Lund"],
  journal_name: "Journal of Advanced Nursing",
  journal_id: "journal-of-advanced-nursing",
  publisher: "Wiley",
  wos_core: "SCIE; SSCI",
  is_wos_core: true,
  is_scopus: true,
  norwegian_level: "Nivå 2",
  abstract: "A study of education and clinical reasoning among nursing students.",
  url: "https://doi.org/10.1000/a",
  oa_url: "https://example.test/fulltext",
  is_oa: true,
  cited_by_count: 9,
  source_api: "OpenAlex",
  fetched_at: "2026-05-22T12:00:00Z"
};

export const itemB: ResearchItem = {
  ...itemA,
  id: "10.1000/b",
  title: "Pressure injury prevention in community care",
  doi: "https://doi.org/10.1000/b",
  openalex_id: "https://openalex.org/W2",
  publication_date: "2026-04-15",
  publication_year: 2026,
  authors: ["Jonas Nilsson"],
  journal_name: "Wound Practice and Research",
  journal_id: "wound-practice-and-research",
  publisher: "Cambridge Media",
  wos_core: "",
  is_wos_core: false,
  is_scopus: false,
  norwegian_level: "",
  abstract: "Community care prevention article.",
  url: "https://doi.org/10.1000/b",
  oa_url: "",
  is_oa: false,
  cited_by_count: 2
};

export const latestPayload: LatestPayload = {
  metadata: {
    generated_at: "2026-05-22T12:00:00Z",
    source_api: "OpenAlex",
    recentDays: 90,
    maxResults: 1000,
    fallback: false
  },
  status: {
    lastUpdated: "2026-05-22T12:00:00Z",
    lastArticleFetchAt: "2026-05-22T12:00:00Z",
    lastSourceResolutionAt: "2026-05-22T11:00:00Z",
    activeSourceMap: "blob",
    itemCount: 2,
    totalJournalCount: 366,
    resolvedSourceCount: 300,
    unresolvedJournalCount: 66,
    sourceResolutionEnabled: false,
    sourceResolutionMode: "github-actions-or-local-script",
    sourceResolutionProgress: 366,
    sourceResolutionCompleted: true,
    sourceResolutionRemaining: 0,
    updateFrequency: "daily",
    schedule: "0 5 * * *",
    errors: []
  },
  items: [itemA, itemB]
};
