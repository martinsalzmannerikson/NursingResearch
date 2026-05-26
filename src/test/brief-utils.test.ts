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

function decodePdfText(pdf: ArrayBuffer) {
  const raw = new TextDecoder("latin1").decode(pdf);
  const decoder = new TextDecoder("windows-1252");
  return [...raw.matchAll(/<([0-9a-f]+)>/gi)]
    .map((match) => {
      const bytes = new Uint8Array((match[1].match(/../g) || []).map((hex) => Number.parseInt(hex, 16)));
      return decoder.decode(bytes);
    })
    .join(" ");
}

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

  it("uses OpenAlex content_urls when content availability is flagged", () => {
    const source = chooseOpenAccessSource({
      has_content: { grobid_xml: true },
      content_urls: { grobid_xml: "https://example.test/article.xml" }
    });
    expect(source).toMatchObject({ url: "https://example.test/article.xml", kind: "content", status: "oa_fulltext" });
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

  it("uses deterministic fallback when OPENROUTER_MODEL is missing", async () => {
    const previousKey = process.env.OPENROUTER_API_KEY;
    const previousModel = process.env.OPENROUTER_MODEL;
    try {
      process.env.OPENROUTER_API_KEY = "test-key";
      delete process.env.OPENROUTER_MODEL;
      const result = await summarizeWithOpenRouter([], []);
      expect(result.model).toBe("deterministic-fallback");
      expect(result.parsed.executiveSummary).toMatch(/fallback extraction notes/i);
      expect(result.errorSummary?.[0]).toMatch(/OPENROUTER_MODEL/i);
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

  it("uses deterministic fallback with a friendly privacy-policy message when OpenRouter has no compatible endpoint", async () => {
    const previousKey = process.env.OPENROUTER_API_KEY;
    const previousModel = process.env.OPENROUTER_MODEL;
    try {
      process.env.OPENROUTER_API_KEY = "test-key";
      process.env.OPENROUTER_MODEL = "blocked/model:free";
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () =>
          JSON.stringify({
            error: { message: "No endpoints available matching your guardrail restrictions and data policy." }
          })
      });
      vi.stubGlobal("fetch", fetchMock);
      const result = await summarizeWithOpenRouter([], []);
      expect(result.model).toBe("deterministic-fallback");
      expect(result.fallback).toBe(true);
      expect(result.errorSummary?.[0]).toMatch(/privacy\/data policy/i);
      expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).model).toBe("blocked/model:free");
    } finally {
      process.env.OPENROUTER_API_KEY = previousKey;
      process.env.OPENROUTER_MODEL = previousModel;
    }
  });

  it("uses deterministic fallback with a friendly rate-limit message when OpenRouter is rate limited", async () => {
    const previousKey = process.env.OPENROUTER_API_KEY;
    const previousModel = process.env.OPENROUTER_MODEL;
    try {
      process.env.OPENROUTER_API_KEY = "test-key";
      process.env.OPENROUTER_MODEL = "openai/gpt-oss-20b:free";
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () =>
          JSON.stringify({
            error: { message: "Provider returned error: temporarily rate-limited upstream." }
          })
      });
      vi.stubGlobal("fetch", fetchMock);
      const result = await summarizeWithOpenRouter([], []);
      expect(result.model).toBe("deterministic-fallback");
      expect(result.errorSummary?.[0]).toMatch(/rate limit/i);
    } finally {
      process.env.OPENROUTER_API_KEY = previousKey;
      process.env.OPENROUTER_MODEL = previousModel;
    }
  });

  it("uses deterministic fallback when an OpenRouter request times out", async () => {
    const previousKey = process.env.OPENROUTER_API_KEY;
    const previousModel = process.env.OPENROUTER_MODEL;
    const previousTimeout = process.env.OPENROUTER_REQUEST_TIMEOUT_MS;
    try {
      process.env.OPENROUTER_API_KEY = "test-key";
      process.env.OPENROUTER_MODEL = "openai/gpt-oss-20b:free";
      process.env.OPENROUTER_REQUEST_TIMEOUT_MS = "5";
      const abortError = Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
      const fetchMock = vi
        .fn()
        .mockRejectedValueOnce(abortError)
        .mockResolvedValueOnce({
          ok: true,
          text: async () =>
            JSON.stringify({
              choices: [{ message: { content: "{\"executiveSummary\":\"OK\"}" } }]
            })
      });
      vi.stubGlobal("fetch", fetchMock);
      const result = await summarizeWithOpenRouter([], []);
      expect(result.model).toBe("deterministic-fallback");
      expect(result.errorSummary?.[0]).toMatch(/timed out/i);
    } finally {
      process.env.OPENROUTER_API_KEY = previousKey;
      process.env.OPENROUTER_MODEL = previousModel;
      process.env.OPENROUTER_REQUEST_TIMEOUT_MS = previousTimeout;
    }
  });

  it("uses deterministic fallback when a model returns invalid JSON", async () => {
    const previousKey = process.env.OPENROUTER_API_KEY;
    const previousModel = process.env.OPENROUTER_MODEL;
    try {
      process.env.OPENROUTER_API_KEY = "test-key";
      process.env.OPENROUTER_MODEL = "openai/gpt-oss-20b:free";
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            choices: [{ message: { content: "{\"executiveSummary\":\"OK\",\"keyFindings\":[\"missing close\"" } }]
          })
      });
      vi.stubGlobal("fetch", fetchMock);
      const result = await summarizeWithOpenRouter([], []);
      expect(result.model).toBe("deterministic-fallback");
      expect(result.errorSummary?.[0]).toMatch(/valid JSON/i);
    } finally {
      process.env.OPENROUTER_API_KEY = previousKey;
      process.env.OPENROUTER_MODEL = previousModel;
    }
  });

  it("generates fallback notes from supplied article text when OpenRouter is unavailable", async () => {
    const previousKey = process.env.OPENROUTER_API_KEY;
    const previousModel = process.env.OPENROUTER_MODEL;
    try {
      process.env.OPENROUTER_API_KEY = "test-key";
      process.env.OPENROUTER_MODEL = "blocked/model:free";
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () =>
          JSON.stringify({
            error: { message: "Provider returned error: temporarily rate-limited upstream." }
          })
      });
      vi.stubGlobal("fetch", fetchMock);
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
        abstract: "Methods: Interviews were conducted. Results: Participants valued continuity.",
        extractionWarnings: [],
        confidence: "medium",
        title: "Continuity study",
        isRetracted: false
      } as ArticleExtraction;
      const result = await summarizeWithOpenRouter(
        [{ title: "Continuity study", authors: ["A Nurse"], year: 2026, journal: "Journal", doi: "10.1/test" }],
        [extraction]
      );
      expect(result.model).toBe("deterministic-fallback");
      expect(result.parsed.articleNotes[0].findingsUsed).toContain("Participants valued continuity");
      expect(result.raw).toContain("fallback");
    } finally {
      process.env.OPENROUTER_API_KEY = previousKey;
      process.env.OPENROUTER_MODEL = previousModel;
    }
  });

  it("generates a light, readable PDF document", () => {
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
      title: "Säljö’s nursing study",
      isRetracted: false
    } as ArticleExtraction;
    const pdf = generateFindingsBriefPdf({
      jobId: "job-test",
      articles: [{ title: "Säljö’s nursing study", authors: ["A Nurse"], year: 2026, journal: "Journal", doi: "10.1/test" }],
      extractions: [extraction],
      summary: {
        executiveSummary: "A cautious summary.",
        keyFindings: ["One finding."],
        methodologicalProfile: ["Qualitative."],
        implicationsForNursingResearch: ["More work is needed."],
        limitationsOfEvidenceBase: ["Abstract only."],
        articleNotes: []
      },
      synthesisMode: "fallback",
      fallbackReason: "OpenRouter rate limit: the selected model/provider is temporarily rate-limited."
    });
    const pdfText = new TextDecoder().decode(pdf);
    const readableText = decodePdfText(pdf);
    expect(pdfText.slice(0, 8)).toMatch(/^%PDF-1\./);
    expect(pdfText).toContain("0.985 0.982 0.965 rg 0 0 612 792 re f");
    expect(pdfText).not.toContain("0.008 0.016 0.012 rg 0 0 612 792 re f");
    expect(readableText).toContain("Nursing Research Monitor");
    expect(readableText).toContain("Fallback Evidence Notes");
    expect(readableText).toContain("Article-level source log");
    expect(readableText).toContain("Säljö's nursing study");
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });
});
