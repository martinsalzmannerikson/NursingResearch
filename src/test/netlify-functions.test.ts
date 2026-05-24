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
    expect(typeof latest.default).toBe("function");
    expect(typeof status.default).toBe("function");
    expect(typeof refresh.default).toBe("function");
    expect(typeof journalLatest.default).toBe("function");
    expect(typeof startSummaryJob.default).toBe("function");
    expect(typeof processSummaryBackground.default).toBe("function");
    expect(typeof getSummaryStatus.default).toBe("function");
    expect(typeof downloadSummaryPdf.default).toBe("function");
  });

  it("configures the scheduled update daily", async () => {
    const updateLatest = await import("../../netlify/functions/update-latest.mts");
    expect(typeof updateLatest.default).toBe("function");
    expect(updateLatest.config).toMatchObject({ schedule: "0 5 * * *" });
  });
});
