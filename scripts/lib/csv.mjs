import { parse } from "csv-parse/sync";

export const REQUIRED_COLUMNS = [
  "journal_id",
  "journal_name",
  "journal_name_normalized",
  "title_variants",
  "publisher",
  "wos_core",
  "is_wos_core",
  "is_scopus",
  "norwegian_level",
  "norwegian_level_numeric",
  "include_in_monitor",
  "openalex_source_id",
  "issn_l",
  "issn_print",
  "issn_online",
  "source_resolution_status",
  "openalex_source_search_hint"
];

export function normalizeTitle(value = "") {
  return String(value)
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/&/g, " and ")
    .replace(/[’'`´]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .replace(/\bthe\b/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function normalizeDoi(value = "") {
  return String(value)
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .toLowerCase();
}

export function splitTitleVariants(rawValue = "", journalName = "") {
  const values = String(rawValue)
    .split(/\s+\|\s+|\|/)
    .map((value) => value.trim())
    .filter(Boolean);

  if (journalName && !values.some((value) => normalizeTitle(value) === normalizeTitle(journalName))) {
    values.unshift(journalName);
  }

  return [...new Map(values.map((value) => [normalizeTitle(value), value])).values()];
}

export function parseBoolean(rawValue, fieldName, rowNumber) {
  if (typeof rawValue === "boolean") return rawValue;
  const value = String(rawValue ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(value)) return true;
  if (["false", "0", "no", "n", ""].includes(value)) return false;
  throw new Error(`Row ${rowNumber}: expected boolean in ${fieldName}, received "${rawValue}".`);
}

export function parseNullableNumber(rawValue, fieldName, rowNumber) {
  const value = String(rawValue ?? "").trim();
  if (!value) return null;
  const parsed = Number(value.replace(",", "."));
  if (!Number.isFinite(parsed)) {
    throw new Error(`Row ${rowNumber}: expected numeric value in ${fieldName}, received "${rawValue}".`);
  }
  return parsed;
}

export function parseJournalCsv(csvText) {
  let columns = [];
  const records = parse(csvText, {
    bom: true,
    columns: (header) => {
      columns = header.map((column) => column.trim());
      return columns;
    },
    skip_empty_lines: true,
    relax_column_count: false,
    trim: false
  });

  const missing = REQUIRED_COLUMNS.filter((column) => !columns.includes(column));
  if (missing.length > 0) {
    throw new Error(`CSV is missing required column(s): ${missing.join(", ")}`);
  }

  const seenIds = new Set();
  return records.map((row, index) => {
    const rowNumber = index + 2;
    for (const column of REQUIRED_COLUMNS) {
      if (!(column in row)) {
        throw new Error(`Row ${rowNumber}: missing column "${column}".`);
      }
    }

    const journalId = String(row.journal_id ?? "").trim();
    const journalName = String(row.journal_name ?? "").trim();
    if (!journalId || !journalName) {
      throw new Error(`Row ${rowNumber}: journal_id and journal_name are required.`);
    }
    if (seenIds.has(journalId)) {
      throw new Error(`Row ${rowNumber}: duplicate journal_id "${journalId}".`);
    }
    seenIds.add(journalId);

    const titleVariants = splitTitleVariants(row.title_variants, journalName);
    return {
      ...row,
      journal_id: journalId,
      journal_name: journalName,
      journal_name_normalized: normalizeTitle(row.journal_name_normalized || journalName),
      title_variants: titleVariants,
      publisher: String(row.publisher ?? "").trim(),
      wos_core: String(row.wos_core ?? "").trim(),
      is_wos_core: parseBoolean(row.is_wos_core, "is_wos_core", rowNumber),
      is_scopus: parseBoolean(row.is_scopus, "is_scopus", rowNumber),
      norwegian_level: String(row.norwegian_level ?? "").trim(),
      norwegian_level_numeric: parseNullableNumber(
        row.norwegian_level_numeric,
        "norwegian_level_numeric",
        rowNumber
      ) ?? 0,
      include_in_monitor: parseBoolean(row.include_in_monitor, "include_in_monitor", rowNumber),
      openalex_source_id: String(row.openalex_source_id ?? "").trim(),
      issn_l: String(row.issn_l ?? "").trim(),
      issn_print: String(row.issn_print ?? "").trim(),
      issn_online: String(row.issn_online ?? "").trim(),
      source_resolution_status: String(row.source_resolution_status ?? "unresolved").trim() || "unresolved",
      source_confidence: parseNullableNumber(row.source_confidence, "source_confidence", rowNumber),
      openalex_source_search_hint: String(row.openalex_source_search_hint ?? "").trim(),
      source_row_number: rowNumber
    };
  });
}

export function escapeCsv(value) {
  if (value === null || value === undefined) return "";
  const stringValue = Array.isArray(value) ? value.join(" | ") : String(value);
  if (/[",\r\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

export function rowsToCsv(rows, columns) {
  return [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => escapeCsv(row[column])).join(","))
  ].join("\n") + "\n";
}
