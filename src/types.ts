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
  lastArticleFetchAt?: string | null;
  lastSourceResolutionAt?: string | null;
  activeSourceMap?: "blob" | "static" | null;
  itemCount: number;
  totalJournalCount?: number;
  resolvedSourceCount: number;
  unresolvedJournalCount: number;
  sourceResolutionEnabled?: boolean;
  sourceResolutionMode?: string;
  sourceResolutionProgress?: number | null;
  sourceResolutionCompleted?: boolean;
  sourceResolutionRemaining?: number | null;
  updateFrequency?: "daily";
  schedule?: string;
  errors: string[];
  openAlexErrors?: string[];
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

export type BriefJobStatus = {
  jobId: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: {
    step:
      | "queued"
      | "checking_open_access"
      | "retrieving_fulltext"
      | "extracting_sections"
      | "summarising"
      | "generating_pdf"
      | "completed"
      | "failed";
    message: string;
    completed: number;
    total: number;
  };
  sourceStatusSummary?: {
    oaFullTextUsed: number;
    abstractOnly: number;
    fulltextFoundButExtractionFailed: number;
    noDoi: number;
    insufficientData: number;
  } | null;
  articleSources?: Array<{
    title: string;
    doi: string;
    sourceStatus: string;
    oaStatus: string;
    sectionsUsed: string[];
    extractionWarnings: string[];
    isRetracted: boolean;
  }>;
  errors: string[];
  modelUsed?: string | null;
  downloadAvailable: boolean;
  downloadUrl: string | null;
};
