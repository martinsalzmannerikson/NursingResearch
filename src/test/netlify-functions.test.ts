import { describe, expect, it } from "vitest";

describe("Netlify functions compile and expose modern handlers", () => {
  it("exports latest/status/refresh handlers", async () => {
    const latest = await import("../../netlify/functions/latest.mts");
    const resolveSources = await import("../../netlify/functions/resolve-sources.mts");
    const status = await import("../../netlify/functions/status.mts");
    const refresh = await import("../../netlify/functions/refresh.mts");
    expect(typeof latest.default).toBe("function");
    expect(typeof resolveSources.default).toBe("function");
    expect(typeof status.default).toBe("function");
    expect(typeof refresh.default).toBe("function");
  });

  it("configures the scheduled update daily", async () => {
    const updateLatest = await import("../../netlify/functions/update-latest.mts");
    expect(typeof updateLatest.default).toBe("function");
    expect(updateLatest.config).toMatchObject({ schedule: "0 5 * * *" });
  });
});
