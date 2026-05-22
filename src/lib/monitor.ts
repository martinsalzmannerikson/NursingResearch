import type { MonitorFilters, ResearchItem } from "../types";

export const defaultFilters: MonitorFilters = {
  query: "",
  journal: "",
  publisher: "",
  wos: "all",
  scopus: "all",
  norwegian: "all",
  oa: "all",
  days: 90,
  sort: "newest"
};

function lower(value: unknown) {
  return String(value ?? "").toLowerCase();
}

function itemText(item: ResearchItem) {
  return [
    item.title,
    item.authors.join(" "),
    item.abstract,
    item.journal_name,
    item.publisher,
    item.doi
  ]
    .join(" ")
    .toLowerCase();
}

function withinDays(publicationDate: string, days: number, now = new Date()) {
  if (!publicationDate) return false;
  const date = new Date(`${publicationDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return false;
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return date >= cutoff;
}

export function filterAndSortItems(
  items: ResearchItem[],
  filters: MonitorFilters,
  now = new Date()
): ResearchItem[] {
  const query = lower(filters.query).trim();
  const journal = lower(filters.journal).trim();
  const publisher = lower(filters.publisher).trim();

  const filtered = items.filter((item) => {
    if (query && !itemText(item).includes(query)) return false;
    if (journal && !lower(item.journal_name).includes(journal)) return false;
    if (publisher && !lower(item.publisher).includes(publisher)) return false;
    if (filters.wos === "not-wos" && item.is_wos_core) return false;
    if (filters.wos !== "all" && filters.wos !== "not-wos" && !item.wos_core.includes(filters.wos)) return false;
    if (filters.scopus === "yes" && !item.is_scopus) return false;
    if (filters.scopus === "no" && item.is_scopus) return false;
    if (filters.norwegian === "1" && !/nivå 1|niva 1|level 1/i.test(item.norwegian_level)) return false;
    if (filters.norwegian === "2" && !/nivå 2|niva 2|level 2/i.test(item.norwegian_level)) return false;
    if (filters.norwegian === "not-listed" && item.norwegian_level) return false;
    if (filters.oa === "oa" && !item.is_oa) return false;
    return withinDays(item.publication_date, filters.days, now);
  });

  return filtered.sort((left, right) => {
    if (filters.sort === "cited") {
      return right.cited_by_count - left.cited_by_count || right.publication_date.localeCompare(left.publication_date);
    }
    if (filters.sort === "journal") {
      return (
        left.journal_name.localeCompare(right.journal_name) ||
        right.publication_date.localeCompare(left.publication_date)
      );
    }
    return right.publication_date.localeCompare(left.publication_date);
  });
}

export function compactAuthors(authors: string[], max = 3) {
  if (!authors.length) return "No author metadata";
  if (authors.length <= max) return authors.join(", ");
  return `${authors.slice(0, max).join(", ")} et al.`;
}

function authorForCitation(author: string) {
  const parts = author.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  const family = parts.at(-1);
  const initials = parts
    .slice(0, -1)
    .map((part) => `${part[0]?.toUpperCase()}.`)
    .join(" ");
  return `${family}, ${initials}`;
}

export function formatApaCitation(item: ResearchItem) {
  const authors =
    item.authors.length > 0
      ? item.authors.slice(0, 6).map(authorForCitation).join(", ") + (item.authors.length > 6 ? ", et al." : "")
      : "Unknown author";
  const year = item.publication_year || (item.publication_date ? new Date(item.publication_date).getUTCFullYear() : "n.d.");
  const doi = item.doi ? ` ${item.doi}` : "";
  return `${authors} (${year}). ${item.title}. ${item.journal_name}.${doi}`.replace(/\s+/g, " ").trim();
}

export function uniqueSorted(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "not yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}
