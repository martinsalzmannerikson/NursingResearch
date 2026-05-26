import { describe, expect, it, vi } from "vitest";
import {
  extractSections,
  normalizeDoi,
  parseOpenRouterJson,
  reconstructAbstract,
  sourceCoverage,
  type ArticleExtraction
} from "../../netlify/functions/_shared/brief-utils";
import { chooseOpenAccessSource } from "../../netlify/functions/_shared/brief-openalex";
import { summarizeWithOpenRouter } from "../../netlify/functions/_shared/brief-openrouter";
import { generateFindingsBriefPdf } from "../../netlify/functions/_shared/brief-pdf";

describe("AI findings brief utilities", () => {
  it("normalizes DOI variants", () => {
    expect(normalizeDoi(" https://doi.org/10.1111/SCS.70265 ")).toBe("10.1111/scs.70265");
    expect(normalizeDoi("doi:10.1016/j.nedt.2026.107141")).toBe("10.1016/j.nedt.2026.107141");
  });

  it("reconstructs OpenAlex abstracts", () => {
    expect(reconstructAbstract({ Nursing: [0], research: [1], matters: [2] })).toBe("Nursing research matters");
  });

  it("selects legal OA locations from OpenAlex metadata", () => {
    const source = chooseOpenAccessSource({
      best_oa_location: {
        is_oa: true,
        pdf_url: "https://example.test/article.pdf",
        license: "cc-by"
      }
    });
    expect(source).toMatchObject({ url: "https://example.test/article.pdf", kind: "pdf", status: "oa_fulltext" });
  });

  it("extracts methods, findings, and conclusions with combined-section warning", () => {
    const extracted = extractSections(`
      <h2>Methods</h2><p>Interviews were analysed thematically.</p>
      <h2>Findings and discussion</h2><p>Participants described continuity as important.</p>
      <h2>Conclusion</h2><p>Continuity warrants further nursing research.</p>
      <h2>References</h2><p>Noise.</p>
    `);
    expect(extracted.methodsText).toContain("thematically");
    expect(extracted.findingsText).toContain("continuity");
    expect(extracted.conclusionsText).toContain("warrants");
    expect(extracted.extractionWarnings).toContain("combined_findings_discussion_section");
  });

  it("summarizes source-status fallback counts", () => {
    const items = [
      { sourceStatus: "oa_fulltext_sections_used", doi: "10.1/a" },
      { sourceStatus: "abstract_only", doi: "10.1/b" },
      { sourceStatus: "fulltext_found_but_extraction_failed", doi: "10.1/c" },
      { sourceStatus: "no_doi" }
    ] as ArticleExtraction[];
    expect(sourceCoverage(items)).toMatchObject({
      oaFullTextUsed: 1,
      abstractOnly: 1,
      fulltextFoundButExtractionFailed: 1,
      noDoi: 1
    });
  });

  it("parses defensive OpenRouter JSON responses", () => {
    expect(parseOpenRouterJson("```json\n{\"executiveSummary\":\"OK\"}\n```")).toMatchObject({
      executiveSummary: "OK"
    });
  });

  it("fails clearly when OPENROUTER_MODEL is missing", async () => {
    const previousKey = process.env.OPENROUTER_API_KEY;
    const previousModel = process.env.OPENROUTER_MODEL;
    try {
      process.env.OPENROUTER_API_KEY = "test-key";
      delete process.env.OPENROUTER_MODEL;
      await expect(summarizeWithOpenRouter([], [])).rejects.toThrow(/OPENROUTER_MODEL is not set/);
    } finally {
      process.env.OPENROUTER_API_KEY = previousKey;
      process.env.OPENROUTER_MODEL = previousModel;
    }
  });

  it("uses process.env.OPENROUTER_MODEL in the server-side OpenRouter request", async () => {
    const previousKey = process.env.OPENROUTER_API_KEY;
    const previousModel = process.env.OPENROUTER_MODEL;
    try {
      process.env.OPENROUTER_API_KEY = "test-key";
      process.env.OPENROUTER_MODEL = "test/model:free";
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            choices: [{ message: { content: "{\"executiveSummary\":\"OK\"}" } }]
          })
      });
      vi.stubGlobal("fetch", fetchMock);
      await summarizeWithOpenRouter([], []);
      expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).model).toBe("test/model:free");
    } finally {
      process.env.OPENROUTER_API_KEY = previousKey;
      process.env.OPENROUTER_MODEL = previousModel;
    }
  });

  it("falls back to another free model when the configured endpoint is blocked", async () => {
    const previousKey = process.env.OPENROUTER_API_KEY;
    const previousModel = process.env.OPENROUTER_MODEL;
    try {
      process.env.OPENROUTER_API_KEY = "test-key";
      process.env.OPENROUTER_MODEL = "blocked/model:free";
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          text: async () =>
            JSON.stringify({
              error: { message: "No endpoints available matching your guardrail restrictions and data policy." }
            })
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () =>
            JSON.stringify({
              choices: [{ message: { content: "{\"executiveSummary\":\"OK\"}" } }]
            })
        });
      vi.stubGlobal("fetch", fetchMock);
      const result = await summarizeWithOpenRouter([], []);
      expect(result.model).toBe("openai/gpt-oss-20b:free");
      expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).model).toBe("openai/gpt-oss-20b:free");
    } finally {
      process.env.OPENROUTER_API_KEY = previousKey;
      process.env.OPENROUTER_MODEL = previousModel;
    }
  });

  it("generates a PDF document", () => {
    const extraction = {
      doi: "10.1/test",
      checkedAt: "2026-05-24T00:00:00Z",
      oaStatus: "not_oa",
      sourceStatus: "abstract_only",
      sourceUrl: "",
      license: "",
      sectionsUsed: ["Abstract"],
      methodsText: "",
      findingsText: "",
      conclusionsText: "",
      abstract: "Brief abstract.",
      extractionWarnings: [],
      confidence: "medium",
      title: "Test study",
      isRetracted: false
    } as ArticleExtraction;
    const pdf = generateFindingsBriefPdf({
      jobId: "job-test",
      articles: [{ title: "Test study", authors: ["A Nurse"], year: 2026, journal: "Journal", doi: "10.1/test" }],
      extractions: [extraction],
      summary: {
        executiveSummary: "A cautious summary.",
        keyFindings: ["One finding."],
        methodologicalProfile: ["Qualitative."],
        implicationsForNursingResearch: ["More work is needed."],
        limitationsOfEvidenceBase: ["Abstract only."],
        articleNotes: []
      }
    });
    expect(new TextDecoder().decode(pdf.slice(0, 8))).toMatch(/^%PDF-1\./);
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });
});
