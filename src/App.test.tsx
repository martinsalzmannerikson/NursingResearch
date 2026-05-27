import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "./App";
import { latestPayload } from "./test/fixtures";

describe("Nursing Research Monitor smoke tests", () => {
  it("renders the home page, monitor title, and publication cards when data exists", async () => {
    render(<App initialData={latestPayload} />);
    expect(screen.getByRole("heading", { name: /^nursing research monitor$/i })).toBeInTheDocument();
    expect(screen.getByText(/Salzmann-Erikson, 2026/i)).toBeInTheDocument();
    expect(screen.getByText(/Digital nursing education improves clinical reasoning/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Journal of Advanced Nursing/i).length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: /^DOI/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Full text/i }).some((link) => link.getAttribute("href") === "https://doi.org/10.1000/b")).toBe(
      true
    );
    expect(screen.getAllByText(/APA 7th ed\./i).length).toBeGreaterThan(0);
  });

  it("renders an empty state when there are no articles", async () => {
    render(<App initialData={{ ...latestPayload, status: { ...latestPayload.status, itemCount: 0, resolvedSourceCount: 2 }, items: [] }} />);
    expect(screen.getByText(/No articles in current filter window/i)).toBeInTheDocument();
  });

  it("does not render the removed PDF brief selection controls", async () => {
    render(<App initialData={latestPayload} />);
    expect(screen.queryByText(/AI FINDINGS BRIEF/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Generate PDF brief/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Select for PDF brief/i)).not.toBeInTheDocument();
  });

  it("fetches missing abstracts from DOI/full text metadata and removes OpenAlex article links", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        abstract: "Fetched publisher abstract from public DOI metadata.",
        source: "doi",
        sourceUrl: "https://doi.org/10.1000/a",
        cached: false
      })
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <App
        initialData={{
          ...latestPayload,
          items: [{ ...latestPayload.items[0], abstract: "" }]
        }}
      />
    );
    expect(screen.queryByText(/OpenAlex/i, { selector: "a" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Fetched publisher abstract/i)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/article-abstract\?/), expect.any(Object));
    vi.unstubAllGlobals();
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
