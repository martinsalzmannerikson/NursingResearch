import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "./App";
import { latestPayload } from "./test/fixtures";

describe("Nursing Research Monitor smoke tests", () => {
  it("renders the home page, monitor title, and publication cards when data exists", async () => {
    render(<App initialData={latestPayload} />);
    expect(screen.getByRole("heading", { name: /omvårdnad \/ nursing research monitor/i })).toBeInTheDocument();
    expect(screen.getByText(/Digital nursing education improves clinical reasoning/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Journal of Advanced Nursing/i).length).toBeGreaterThan(0);
  });

  it("renders an empty state when there are no articles", async () => {
    render(<App initialData={{ ...latestPayload, status: { ...latestPayload.status, itemCount: 0, resolvedSourceCount: 2 }, items: [] }} />);
    expect(screen.getByText(/No articles in current filter window/i)).toBeInTheDocument();
  });

  it("renders the resolver guidance when no OpenAlex sources are resolved", async () => {
    render(
      <App
        initialData={{
          ...latestPayload,
          status: { ...latestPayload.status, itemCount: 0, resolvedSourceCount: 0, unresolvedJournalCount: 366 },
          items: []
        }}
      />
    );
    expect(screen.getByRole("heading", { name: /No OpenAlex journal sources have been resolved yet/i })).toBeInTheDocument();
    expect(screen.getByText(/GitHub Actions source-resolution workflow/i)).toBeInTheDocument();
  });

  it("loads static fallback through the API helper path", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("function offline"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => latestPayload
      });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    await waitFor(() => expect(screen.getByText(/Digital nursing education improves clinical reasoning/i)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/latest", expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith("/data/latest.json", expect.any(Object));
    vi.unstubAllGlobals();
  });
});
