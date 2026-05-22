import {
  ChevronDown,
  ChevronUp,
  Clipboard,
  Database,
  ExternalLink,
  Filter,
  RefreshCw,
  Terminal
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { loadLatestData } from "./lib/api";
import {
  compactAuthors,
  defaultFilters,
  filterAndSortItems,
  formatApaCitation,
  formatDateTime,
  uniqueSorted
} from "./lib/monitor";
import type { LatestPayload, MonitorFilters, ResearchItem } from "./types";

const visibleStep = 25;

function badgeLabel(item: ResearchItem) {
  const badges = [];
  if (item.wos_core) badges.push(item.wos_core);
  if (item.is_scopus) badges.push("Scopus");
  if (item.norwegian_level) badges.push(item.norwegian_level);
  if (item.is_oa) badges.push("OA");
  return badges;
}

function useLatestData(initialData?: LatestPayload) {
  const [data, setData] = useState<LatestPayload | null>(initialData ?? null);
  const [loading, setLoading] = useState(!initialData);

  const refresh = async () => {
    setLoading(true);
    const next = await loadLatestData();
    setData(next);
    setLoading(false);
  };

  useEffect(() => {
    if (!initialData) void refresh();
  }, [initialData]);

  return { data, loading, refresh };
}

type AppProps = {
  initialData?: LatestPayload;
};

export default function App({ initialData }: AppProps) {
  const { data, loading, refresh } = useLatestData(initialData);
  const [filters, setFilters] = useState<MonitorFilters>(defaultFilters);
  const [visibleCount, setVisibleCount] = useState(visibleStep);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const items = useMemo(() => data?.items ?? [], [data]);
  const journals = useMemo(() => uniqueSorted(items.map((item) => item.journal_name)), [items]);
  const publishers = useMemo(() => uniqueSorted(items.map((item) => item.publisher)), [items]);
  const filteredItems = useMemo(() => filterAndSortItems(items, filters), [items, filters]);
  const visibleItems = filteredItems.slice(0, visibleCount);
  const lastUpdated = data?.status.lastUpdated ?? data?.metadata?.generated_at ?? null;

  useEffect(() => {
    setVisibleCount(visibleStep);
  }, [filters]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape") {
        setFilters((current) => ({ ...current, query: "", journal: "", publisher: "" }));
        searchRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const updateFilter = <Key extends keyof MonitorFilters>(key: Key, value: MonitorFilters[Key]) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  return (
    <main className="crt-shell">
      <div className="scanlines" aria-hidden="true" />
      <section className="terminal-frame" aria-labelledby="monitor-title">
        <header className="boot-panel panel">
          <div className="boot-kicker">
            <Terminal size={18} aria-hidden="true" />
            **** NURSING RESEARCH TERMINAL V1 ****
          </div>
          <h1 id="monitor-title">OMVÅRDNAD / NURSING RESEARCH MONITOR</h1>
          <div className="boot-grid">
            <span>LOAD "NURSING-RES",8,1</span>
            <span>SEARCHING... {filteredItems.length} ITEMS</span>
            <span>READY. CLR UPDATED: {formatDateTime(lastUpdated)} SOURCE: OPENALEX FILTER: JOURNAL + DOI</span>
          </div>
          <label className="command-line" htmlFor="command-search">
            <span aria-hidden="true">&gt;</span>
            <input
              id="command-search"
              ref={searchRef}
              value={filters.query}
              onChange={(event) => updateFilter("query", event.target.value)}
              placeholder="search journals, titles, authors, abstracts"
              aria-label="Search journals, titles, authors, abstracts"
            />
            <span className="cursor" aria-hidden="true" />
          </label>
        </header>

        <section className="status-strip" aria-label="Monitor status">
          <StatusTile label="ITEMS" value={String(data?.status.itemCount ?? items.length)} />
          <StatusTile label="VISIBLE" value={String(filteredItems.length)} />
          <StatusTile label="SOURCES" value={String(data?.status.resolvedSourceCount ?? 0)} />
          <StatusTile label="UNRESOLVED" value={String(data?.status.unresolvedJournalCount ?? 0)} />
          <button className="icon-button" type="button" onClick={refresh} aria-label="Refresh monitor data">
            <RefreshCw size={18} aria-hidden="true" />
          </button>
        </section>

        <section className="filter-panel panel" aria-label="Filters">
          <div className="panel-title">
            <Filter size={16} aria-hidden="true" />
            FILTER BUS
          </div>
          <div className="filter-grid">
            <SelectField
              label="Journal"
              value={filters.journal}
              onChange={(value) => updateFilter("journal", value)}
              options={journals}
              allLabel="All journals"
            />
            <SelectField
              label="Publisher"
              value={filters.publisher}
              onChange={(value) => updateFilter("publisher", value)}
              options={publishers}
              allLabel="All publishers"
            />
            <SelectField
              label="WoS"
              value={filters.wos}
              onChange={(value) => updateFilter("wos", value as MonitorFilters["wos"])}
              options={["SCIE", "SSCI", "ESCI", "not-wos"]}
              labels={{ "not-wos": "Not WoS" }}
              allLabel="All WoS"
            />
            <SelectField
              label="Scopus"
              value={filters.scopus}
              onChange={(value) => updateFilter("scopus", value as MonitorFilters["scopus"])}
              options={["yes", "no"]}
              labels={{ yes: "Yes", no: "No" }}
              allLabel="All"
            />
            <SelectField
              label="Norska listan"
              value={filters.norwegian}
              onChange={(value) => updateFilter("norwegian", value as MonitorFilters["norwegian"])}
              options={["1", "2", "not-listed"]}
              labels={{ "1": "Level 1", "2": "Level 2", "not-listed": "Not listed" }}
              allLabel="All levels"
            />
            <SelectField
              label="Open access"
              value={filters.oa}
              onChange={(value) => updateFilter("oa", value as MonitorFilters["oa"])}
              options={["oa"]}
              labels={{ oa: "OA only" }}
              allLabel="All"
            />
            <SelectField
              label="Date"
              value={String(filters.days)}
              onChange={(value) => updateFilter("days", Number(value) as MonitorFilters["days"])}
              options={["7", "30", "90", "180"]}
              labels={{ "7": "7 days", "30": "30 days", "90": "90 days", "180": "180 days" }}
              allLabel=""
            />
            <SelectField
              label="Sort"
              value={filters.sort}
              onChange={(value) => updateFilter("sort", value as MonitorFilters["sort"])}
              options={["newest", "cited", "journal"]}
              labels={{ newest: "Newest first", cited: "Most cited", journal: "Journal A-Z" }}
              allLabel=""
            />
          </div>
        </section>

        <section className="feed" aria-label="Publication feed">
          <div className="feed-header">
            <div>
              <span className="prompt-mark">&gt;</span> LIST /PUBLICATIONS
            </div>
            <span>{loading ? "SYNCING..." : `${visibleItems.length}/${filteredItems.length}`}</span>
          </div>

          {!loading && visibleItems.length === 0 ? (
            <div className="empty-state panel">
              <Database size={28} aria-hidden="true" />
              <h2>No articles in current filter window</h2>
              <p>Broaden the date range, clear the command line, or run the OpenAlex refresh pipeline.</p>
            </div>
          ) : null}

          {visibleItems.map((item) => (
            <PublicationCard key={`${item.id}-${item.publication_date}`} item={item} />
          ))}

          {visibleItems.length < filteredItems.length ? (
            <button
              className="load-more"
              type="button"
              onClick={() => setVisibleCount((current) => current + visibleStep)}
            >
              LOAD MORE
            </button>
          ) : null}
        </section>

        <section className="diagnostics panel" aria-label="Journal and source diagnostics">
          <button
            type="button"
            className="diagnostics-toggle"
            onClick={() => setDiagnosticsOpen((open) => !open)}
            aria-expanded={diagnosticsOpen}
          >
            <span>
              <Database size={16} aria-hidden="true" />
              JOURNAL / SOURCE DIAGNOSTICS
            </span>
            {diagnosticsOpen ? <ChevronUp size={18} aria-hidden="true" /> : <ChevronDown size={18} aria-hidden="true" />}
          </button>
          {diagnosticsOpen ? (
            <div className="diagnostics-body">
              <p>
                Resolved sources: {data?.status.resolvedSourceCount ?? 0}. Unresolved journals:{" "}
                {data?.status.unresolvedJournalCount ?? 0}. Latest generated dataset contains {items.length} items.
              </p>
              {data?.status.errors?.length ? (
                <ul>
                  {data.status.errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              ) : (
                <p>No pipeline warnings reported in the active dataset.</p>
              )}
            </div>
          ) : null}
        </section>

        <footer className="method-note">
          <p>
            Method: journal manifest normalized from CSV, OpenAlex Sources resolved by title variants and publisher
            signals, Works filtered by journal source and DOI/OpenAlex de-duplication. Cached on Netlify Blobs with a
            static JSON fallback.
          </p>
        </footer>
      </section>
    </main>
  );
}

function StatusTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="status-tile">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

type SelectFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  labels?: Record<string, string>;
  allLabel: string;
};

function SelectField({ label, value, onChange, options, labels = {}, allLabel }: SelectFieldProps) {
  return (
    <label className="select-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {allLabel ? <option value="all">{allLabel}</option> : null}
        {options.map((option) => (
          <option key={option} value={option}>
            {labels[option] ?? option}
          </option>
        ))}
      </select>
    </label>
  );
}

function PublicationCard({ item }: { item: ResearchItem }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const abstract = item.abstract || "No abstract available from OpenAlex.";
  const abstractPreview = expanded || abstract.length < 360 ? abstract : `${abstract.slice(0, 360).trim()}...`;

  const copyCitation = async () => {
    await navigator.clipboard?.writeText(formatApaCitation(item));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <article className="publication-card panel">
      <div className="publication-meta">
        <span>{item.publication_date || item.publication_year || "date unknown"}</span>
        <span>{item.journal_name}</span>
        <span>{item.cited_by_count} cites</span>
      </div>
      <h2>{item.title}</h2>
      <p className="authors">{compactAuthors(item.authors)}</p>
      <div className="badge-row">
        {badgeLabel(item).map((badge) => (
          <span key={badge} className="badge">
            {badge}
          </span>
        ))}
      </div>
      <p className="abstract">{abstractPreview}</p>
      <div className="card-actions">
        {item.doi ? (
          <a href={item.doi} target="_blank" rel="noreferrer">
            DOI <ExternalLink size={14} aria-hidden="true" />
          </a>
        ) : null}
        {item.openalex_id ? (
          <a href={item.openalex_id} target="_blank" rel="noreferrer">
            OpenAlex <ExternalLink size={14} aria-hidden="true" />
          </a>
        ) : null}
        {item.oa_url ? (
          <a href={item.oa_url} target="_blank" rel="noreferrer">
            Full text <ExternalLink size={14} aria-hidden="true" />
          </a>
        ) : null}
        <button type="button" onClick={copyCitation} aria-label={`Copy citation for ${item.title}`}>
          <Clipboard size={14} aria-hidden="true" />
          {copied ? "Copied" : "APA-ish"}
        </button>
        {abstract.length >= 360 ? (
          <button type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
            {expanded ? "Collapse" : "Expand"}
          </button>
        ) : null}
      </div>
    </article>
  );
}
