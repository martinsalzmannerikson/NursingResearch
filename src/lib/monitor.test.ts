import { describe, expect, it } from "vitest";
import { itemA, itemB } from "../test/fixtures";
import { defaultFilters, filterAndSortItems, formatApaCitation } from "./monitor";

describe("monitor filter logic", () => {
  it("filters across title, authors, abstract, and journal fields", () => {
    const result = filterAndSortItems([itemA, itemB], { ...defaultFilters, query: "clinical reasoning" }, new Date("2026-05-22"));
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(itemA.id);
  });

  it("filters Web of Science, Scopus, Norwegian level, OA, and date windows", () => {
    const result = filterAndSortItems(
      [itemA, itemB],
      {
        ...defaultFilters,
        wos: "SCIE",
        scopus: "yes",
        norwegian: "2",
        oa: "oa",
        days: 30
      },
      new Date("2026-05-22")
    );
    expect(result.map((item) => item.id)).toEqual([itemA.id]);
  });

  it("sorts by citation count", () => {
    const result = filterAndSortItems([itemB, itemA], { ...defaultFilters, sort: "cited" }, new Date("2026-05-22"));
    expect(result[0].id).toBe(itemA.id);
  });
});

describe("APA-ish citation formatting", () => {
  it("formats compact APA-ish citations with DOI links", () => {
    expect(formatApaCitation(itemA)).toContain("Berg, A., Holm, L., Vik, N., Lund, S. (2026). Digital nursing education");
    expect(formatApaCitation(itemA)).toContain("https://doi.org/10.1000/a");
  });
});
