import { describe, expect, it } from "vitest";
import { parseJournalCsv, normalizeTitle } from "../../scripts/lib/csv.mjs";
import { dedupeWorks, reconstructAbstract } from "../../scripts/lib/openalex.mjs";

describe("CSV parsing", () => {
  it("validates and converts nursing journal manifest rows", () => {
    const csv = [
      "journal_id,journal_name,journal_name_normalized,title_variants,publisher,wos_core,is_wos_core,is_scopus,norwegian_level,norwegian_level_numeric,include_in_monitor,openalex_source_id,issn_l,issn_print,issn_online,source_resolution_status,openalex_source_search_hint",
      "test-journal,Test Journal,test journal,Test Journal | TJ,Publisher,SCIE,true,false,Nivå 1,1,true,,,,,unresolved,/sources?search=Test"
    ].join("\n");
    const rows = parseJournalCsv(csv) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      journal_id: "test-journal",
      is_wos_core: true,
      is_scopus: false,
      norwegian_level_numeric: 1,
      include_in_monitor: true
    });
    expect(rows[0].title_variants).toEqual(["Test Journal", "TJ"]);
  });

  it("fails loudly when required columns are absent", () => {
    expect(() => parseJournalCsv("journal_id,journal_name\nx,Name")).toThrow(/missing required column/i);
  });
});

describe("OpenAlex helpers", () => {
  it("normalizes title variants with accents and punctuation", () => {
    expect(normalizeTitle("Omvårdnad & Hälsa: Journal")).toBe("omvardnad and halsa journal");
  });

  it("reconstructs abstracts from inverted indexes", () => {
    expect(
      reconstructAbstract({
        Nursing: [0],
        research: [1],
        matters: [2],
        ".": [3]
      })
    ).toBe("Nursing research matters.");
  });

  it("deduplicates by DOI before OpenAlex ID", () => {
    const result = dedupeWorks([
      { doi: "https://doi.org/10.1/ABC", openalex_id: "W1" },
      { doi: "10.1/abc", openalex_id: "W2" },
      { doi: "", openalex_id: "W3" },
      { doi: "", openalex_id: "W3" }
    ]);
    expect(result).toHaveLength(2);
  });
});
