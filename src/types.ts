export type ResearchItem = {
  id: string;
  title: string;
  doi: string;
  openalex_id: string;
  publication_date: string;
  publication_year: number | null;
  authors: string[];
  journal_name: string;
  journal_id: string;
  publisher: string;
  wos_core: string;
  is_wos_core: boolean;
  is_scopus: boolean;
  norwegian_level: string;
  abstract: string;
  url: string;
  oa_url: string;
  is_oa: boolean;
  cited_by_count: number;
  source_api: string;
  fetched_at: string;
};

export type MonitorStatus = {
  lastUpdated: string | null;
  itemCount: number;
  resolvedSourceCount: number;
  unresolvedJournalCount: number;
  errors: string[];
};

export type LatestPayload = {
  metadata?: {
    generated_at?: string | null;
    source_api?: string;
    recentDays?: number;
    maxResults?: number;
    fallback?: boolean;
    message?: string;
  };
  status: MonitorStatus;
  diagnostics?: Record<string, unknown>;
  items: ResearchItem[];
};

export type WosFilter = "all" | "SCIE" | "SSCI" | "ESCI" | "not-wos";
export type TriStateFilter = "all" | "yes" | "no";
export type NorwegianFilter = "all" | "1" | "2" | "not-listed";
export type SortMode = "newest" | "cited" | "journal";

export type MonitorFilters = {
  query: string;
  journal: string;
  publisher: string;
  wos: WosFilter;
  scopus: TriStateFilter;
  norwegian: NorwegianFilter;
  oa: "all" | "oa";
  days: 7 | 30 | 90 | 180;
  sort: SortMode;
};
