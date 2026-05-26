import { describe, expect, it, vi } from "vitest";
import {
  cleanBriefText,
  extractSections,
  normalizeDoi,
  reconstructAbstract,
  sourceCoverage,
  stripMarkupTags,
  type ArticleExtraction
} from "../../netlify/functions/_shared/brief-utils";
import { chooseOpenAccessSource } from "../../netlify/functions/_shared/brief-openalex";
import { OpenRouterModelUnavailableError, buildOpenRouterMessages, summarizeWithOpenRouter } from "../../netlify/functions/_shared/brief-openrouter";
import { generateFindingsBriefPdf, parseBriefMarkdown } from "../../netlify/functions/_shared/brief-pdf";

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

function sampleExtraction(overrides: Partial<ArticleExtraction> = {}) {
  return {
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
    isRetracted: false,
    ...overrides
  } as ArticleExtraction;
}

const goodMarkdown = `# AI Findings Brief

## Synthesis in brief
Across the selected records, the evidence points toward continuity, careful implementation, and cautious interpretation of abstract-only findings. The brief emphasizes what can be supported by the supplied source material.

## Main findings across the selected articles
- Continuity and structured support appear as recurring concerns across the selected material.
- Methodological detail varies, so stronger claims should be anchored in records with supplied Methods and Findings sections.
- Abstract-only records help identify signals but should not carry the synthesis alone.

## Methodological basis
The evidence package includes one abstract-only nursing record and one OA full-text record with extracted sections.

## Implications for nursing research
- Prioritize designs that make implementation processes visible.
- Report methods and findings in ways that support secondary evidence monitoring.

## Cautions
- Abstract-only records should be interpreted cautiously.
- Extraction-failed records should be checked manually before being used for strong claims.

## Article source notes
- Continuity study; 2026; abstract only; sections used: Abstract.
`;

describe("AI findings brief utilities", () => {
  it("normalizes DOI variants", () => {
    expect(normalizeDoi(" https://doi.org/10.1111/SCS.70265 ")).toBe("10.1111/scs.70265");
    expect(normalizeDoi("doi:10.1016/j.nedt.2026.107141")).toBe("10.1016/j.nedt.2026.107141");
  });

  it("reconstructs OpenAlex abstracts", () => {
    expect(reconstructAbstract({ Nursing: [0], research: [1], matters: [2] })).toBe("Nursing research matters");
  });

  it("strips HTML/XML tags from titles and abstracts before model use", () => {
    expect(stripMarkupTags("Development of <scp>COIL</scp> in <i>nursing</i> &amp; care")).toBe(
      "Development of  COIL  in  nursing  & care"
    );
    expect(cleanBriefText("Säljö’s <sub>nursing</sub> study – abstract")).toBe("Säljö's nursing study - abstract");
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

  it("summarizes source-status counts", () => {
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

  it("compacts article evidence for a simple Markdown model request", () => {
    const messages = buildOpenRouterMessages(
      [{ title: "Development <scp>brief</scp>", authors: ["A Nurse"], year: 2026, journal: "Journal", doi: "10.1/test" }],
      [sampleExtraction({ abstract: "Abstract with <b>bold</b> tags." })]
    );
    const body = messages[1].content;
    expect(body).toContain("# AI Findings Brief");
    expect(body).toContain("Development brief");
    expect(body).not.toContain("<scp>");
    expect(body).not.toContain("<b>");
    expect(body).toContain("abstract only");
  });

  it("uses process.env.OPENROUTER_MODEL and no provider/schema restrictions", async () => {
    const previousKey = process.env.OPENROUTER_API_KEY;
    const previousModel = process.env.OPENROUTER_MODEL;
    const previousFallbacks = process.env.OPENROUTER_FALLBACK_MODELS;
    try {
      process.env.OPENROUTER_API_KEY = "test-key";
      process.env.OPENROUTER_MODEL = "test/model";
      delete process.env.OPENROUTER_FALLBACK_MODELS;
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ choices: [{ message: { content: goodMarkdown } }], model: "test/model" })
      });
      vi.stubGlobal("fetch", fetchMock);
      const result = await summarizeWithOpenRouter([{ title: "Continuity study", year: 2026 }], [sampleExtraction()]);
      const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
      expect(result.markdown).toContain("## Synthesis in brief");
      expect(requestBody.model).toBe("test/model");
      expect(requestBody.models).toBeUndefined();
      expect(requestBody.provider).toBeUndefined();
      expect(requestBody.response_format).toBeUndefined();
    } finally {
      process.env.OPENROUTER_API_KEY = previousKey;
      process.env.OPENROUTER_MODEL = previousModel;
      process.env.OPENROUTER_FALLBACK_MODELS = previousFallbacks;
    }
  });

  it("accepts common Markdown heading variants from the model", async () => {
    const previousKey = process.env.OPENROUTER_API_KEY;
    const previousModel = process.env.OPENROUTER_MODEL;
    try {
      process.env.OPENROUTER_API_KEY = "test-key";
      process.env.OPENROUTER_MODEL = "test/model";
      const variantMarkdown = `AI Findings Brief

1. Brief synthesis
The selected studies point toward cautious continuity-focused conclusions across the supplied material.

2. Key findings
- Continuity is visible across the article material.
- Abstract-only evidence requires caution.

3. Methodological profile
The records include abstract-only and OA full-text section material.

4. Implications
- Improve transparent reporting of methods and findings.

5. Limitations
- Some records are abstract-only.

6. Source notes
- Continuity study; 2026; abstract only; Abstract.`;
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          text: async () => JSON.stringify({ choices: [{ message: { content: variantMarkdown } }], model: "test/model" })
        })
      );
      const result = await summarizeWithOpenRouter([{ title: "Continuity study", year: 2026 }], [sampleExtraction()]);
      expect(result.markdown).toContain("## Synthesis in brief");
      expect(result.markdown).toContain("## Main findings across the selected articles");
      expect(result.fallback).toBe(false);
    } finally {
      process.env.OPENROUTER_API_KEY = previousKey;
      process.env.OPENROUTER_MODEL = previousModel;
    }
  });

  it("uses OpenRouter models array only when fallback models are explicitly configured", async () => {
    const previousKey = process.env.OPENROUTER_API_KEY;
    const previousModel = process.env.OPENROUTER_MODEL;
    const previousFallbacks = process.env.OPENROUTER_FALLBACK_MODELS;
    try {
      process.env.OPENROUTER_API_KEY = "test-key";
      process.env.OPENROUTER_MODEL = "openai/gpt-5-mini";
      process.env.OPENROUTER_FALLBACK_MODELS = "openai/gpt-5-nano,mistralai/mistral-small-3.2-24b-instruct";
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ choices: [{ message: { content: goodMarkdown } }], model: "openai/gpt-5-mini" })
      });
      vi.stubGlobal("fetch", fetchMock);
      await summarizeWithOpenRouter([{ title: "Continuity study", year: 2026 }], [sampleExtraction()]);
      const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
      expect(requestBody.model).toBeUndefined();
      expect(requestBody.models).toEqual([
        "openai/gpt-5-mini",
        "openai/gpt-5-nano",
        "mistralai/mistral-small-3.2-24b-instruct"
      ]);
    } finally {
      process.env.OPENROUTER_API_KEY = previousKey;
      process.env.OPENROUTER_MODEL = previousModel;
      process.env.OPENROUTER_FALLBACK_MODELS = previousFallbacks;
    }
  });

  it("fails model-unavailable without deterministic fallback by default", async () => {
    const previousKey = process.env.OPENROUTER_API_KEY;
    const previousModel = process.env.OPENROUTER_MODEL;
    const previousFallback = process.env.ALLOW_DETERMINISTIC_FALLBACK_PDF;
    try {
      process.env.OPENROUTER_API_KEY = "test-key";
      process.env.OPENROUTER_MODEL = "blocked/model";
      delete process.env.ALLOW_DETERMINISTIC_FALLBACK_PDF;
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 404,
          text: async () => JSON.stringify({ error: { message: "No endpoints available matching guardrail restrictions." } })
        })
      );
      await expect(summarizeWithOpenRouter([{ title: "Continuity study", year: 2026 }], [sampleExtraction()])).rejects.toBeInstanceOf(
        OpenRouterModelUnavailableError
      );
    } finally {
      process.env.OPENROUTER_API_KEY = previousKey;
      process.env.OPENROUTER_MODEL = previousModel;
      process.env.ALLOW_DETERMINISTIC_FALLBACK_PDF = previousFallback;
    }
  });

  it("allows deterministic fallback PDF only when explicitly enabled", async () => {
    const previousKey = process.env.OPENROUTER_API_KEY;
    const previousModel = process.env.OPENROUTER_MODEL;
    const previousFallback = process.env.ALLOW_DETERMINISTIC_FALLBACK_PDF;
    try {
      process.env.OPENROUTER_API_KEY = "test-key";
      process.env.OPENROUTER_MODEL = "blocked/model";
      process.env.ALLOW_DETERMINISTIC_FALLBACK_PDF = "true";
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 429,
          text: async () => JSON.stringify({ error: { message: "temporarily rate-limited upstream" } })
        })
      );
      const result = await summarizeWithOpenRouter([{ title: "Continuity study", year: 2026 }], [sampleExtraction()]);
      expect(result.fallback).toBe(true);
      expect(result.model).toBe("deterministic-fallback");
      expect(result.markdown).toContain("# Fallback Evidence Notes");
    } finally {
      process.env.OPENROUTER_API_KEY = previousKey;
      process.env.OPENROUTER_MODEL = previousModel;
      process.env.ALLOW_DETERMINISTIC_FALLBACK_PDF = previousFallback;
    }
  });

  it("parses simple Markdown synthesis blocks", () => {
    const blocks = parseBriefMarkdown(goodMarkdown);
    expect(blocks.some((block) => block.type === "h2" && block.text === "Synthesis in brief")).toBe(true);
    expect(blocks.some((block) => block.type === "li" && block.text.includes("Continuity"))).toBe(true);
  });

  it("generates a light, readable AI Findings Brief PDF from Markdown", () => {
    const pdf = generateFindingsBriefPdf({
      articles: [{ title: "Säljö’s nursing study", authors: ["A Nurse"], year: 2026, journal: "Journal", doi: "10.1/test" }],
      extractions: [sampleExtraction({ title: "Säljö’s nursing study", abstract: "Brief abstract." })],
      markdown: goodMarkdown,
      synthesisMode: "model"
    });
    const pdfText = new TextDecoder().decode(pdf);
    const readableText = decodePdfText(pdf);
    expect(pdfText.slice(0, 8)).toMatch(/^%PDF-1\./);
    expect(pdfText).toContain("0.985 0.982 0.965 rg 0 0 612 792 re f");
    expect(pdfText).not.toContain("0.008 0.016 0.012 rg 0 0 612 792 re f");
    expect(readableText).toContain("Nursing Research Monitor");
    expect(readableText).toContain("AI Findings Brief");
    expect(readableText).toContain("Synthesis in brief");
    expect(readableText).not.toContain("Fallback Evidence Notes");
    expect(readableText).not.toContain("Production workflow represented by this export");
    expect(readableText).not.toContain("<scp>");
    expect(readableText).not.toContain("No endpoints available");
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });
});
