import { describe, expect, it } from "vitest";

describe("Netlify functions compile and expose modern handlers", () => {
  it("exports latest/status/refresh handlers", async () => {
    const latest = await import("./latest.mts");
    const status = await import("./status.mts");
    const refresh = await import("./refresh.mts");
    expect(typeof latest.default).toBe("function");
    expect(typeof status.default).toBe("function");
    expect(typeof refresh.default).toBe("function");
  });

  it("configures the scheduled update hourly", async () => {
    const updateLatest = await import("./update-latest.mts");
    expect(typeof updateLatest.default).toBe("function");
    expect(updateLatest.config).toMatchObject({ schedule: "@hourly" });
  });
});
