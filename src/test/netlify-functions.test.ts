import { describe, expect, it } from "vitest";

describe("Netlify functions compile and expose modern handlers", () => {
  it("exports latest/status/refresh/journal handlers", async () => {
    const latest = await import("../../netlify/functions/latest.mts");
    const status = await import("../../netlify/functions/status.mts");
    const refresh = await import("../../netlify/functions/refresh.mts");
    const journalLatest = await import("../../netlify/functions/journal-latest.mts");
    const startSummaryJob = await import("../../netlify/functions/start-summary-job.mts");
    const processSummaryBackground = await import("../../netlify/functions/process-summary-background.mts");
    const getSummaryStatus = await import("../../netlify/functions/get-summary-status.mts");
    const downloadSummaryPdf = await import("../../netlify/functions/download-summary-pdf.mts");
    const openrouterHealth = await import("../../netlify/functions/openrouter-health.mts");
    const briefDebug = await import("../../netlify/functions/brief-debug.mts");
    const articleAbstract = await import("../../netlify/functions/article-abstract.mts");
    expect(typeof latest.default).toBe("function");
    expect(typeof status.default).toBe("function");
    expect(typeof refresh.default).toBe("function");
    expect(typeof journalLatest.default).toBe("function");
    expect(typeof startSummaryJob.default).toBe("function");
    expect(typeof processSummaryBackground.default).toBe("function");
    expect(typeof getSummaryStatus.default).toBe("function");
    expect(typeof downloadSummaryPdf.default).toBe("function");
    expect(typeof openrouterHealth.default).toBe("function");
    expect(typeof briefDebug.default).toBe("function");
    expect(typeof articleAbstract.default).toBe("function");
  });

  it("extracts abstracts from publisher HTML metadata", async () => {
    const { extractAbstractFromHtml } = await import("../../netlify/functions/article-abstract.mts");
    const html = `<html><head><meta name="citation_abstract" content="This study evaluates nursing education outcomes using a structured intervention. The abstract is long enough to be treated as publisher metadata and should be returned cleanly." /></head></html>`;
    expect(extractAbstractFromHtml(html)).toContain("nursing education outcomes");
  });

  it("extracts abstracts from publisher abstract containers such as JKAN pages", async () => {
    const { extractAbstractFromHtml } = await import("../../netlify/functions/article-abstract.mts");
    const html = `<html><body><div class="abstractBrief"><h4>Abstract</h4><ul><li><b>Purpose</b><dd>This study examined nursing students' learning experiences in a structured clinical simulation program and evaluated outcomes relevant to patient education, care planning, and reflective practice.</dd></li><li><b>Methods</b><dd>A descriptive survey design was used with nursing students after the intervention. The abstract contains enough detail to be treated as a real publisher abstract.</dd></li></ul></div></body></html>`;
    const extracted = extractAbstractFromHtml(html);
    expect(extracted).toContain("Purpose");
    expect(extracted).toContain("structured clinical simulation");
  });

  it("extracts labelled PubMed XML abstracts", async () => {
    const { extractPubMedAbstract } = await import("../../netlify/functions/article-abstract.mts");
    const xml = `<PubmedArticle><Abstract><AbstractText Label="BACKGROUND">Interprofessional education is widely used in nursing and allied health education, but abstract metadata is sometimes missing in cached OpenAlex records.</AbstractText><AbstractText Label="METHODS">The study used a structured educational intervention and evaluated student-reported outcomes across several domains.</AbstractText><AbstractText Label="CONCLUSION">The findings support cautious interpretation of brief DOI metadata when full records are not cached.</AbstractText></Abstract></PubmedArticle>`;
    const extracted = extractPubMedAbstract(xml);
    expect(extracted).toContain("BACKGROUND:");
    expect(extracted).toContain("structured educational intervention");
  });

  it("configures the scheduled update daily", async () => {
    const updateLatest = await import("../../netlify/functions/update-latest.mts");
    expect(typeof updateLatest.default).toBe("function");
    expect(updateLatest.config).toMatchObject({ schedule: "0 5 * * *" });
  });

  it("maps model failures to failed_model_unavailable without creating a PDF state", async () => {
    const { OpenRouterModelUnavailableError } = await import("../../netlify/functions/_shared/brief-openrouter");
    const { failureStateForBriefError } = await import("../../netlify/functions/process-summary-background.mts");
    const failure = failureStateForBriefError(
      new OpenRouterModelUnavailableError(
        "AI synthesis could not be generated. The selected OpenRouter model was unavailable or blocked by privacy/data policy settings. Try another model or adjust OpenRouter privacy settings.",
        "OpenRouter could not find an endpoint compatible with the current privacy/data policy settings."
      )
    );
    expect(failure.status).toBe("failed_model_unavailable");
    expect(failure.message).toMatch(/AI synthesis could not be generated/i);
    expect(failure).not.toHaveProperty("pdfKey");
  });
});
