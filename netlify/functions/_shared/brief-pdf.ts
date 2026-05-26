import { capText, sourceCoverage, type ArticleExtraction, type BriefArticleInput, type SourceCoverage } from "./brief-utils.js";

type ArticleNote = {
  title?: string;
  note?: string;
  sourceStatus?: string;
  designMethods?: string;
  findingsUsed?: string;
  evidenceWeight?: string;
};

type SummaryJson = {
  executiveSummary?: string;
  keyFindings?: string[];
  methodologicalProfile?: string[];
  implicationsForNursingResearch?: string[];
  limitationsOfEvidenceBase?: string[];
  articleNotes?: ArticleNote[];
  sourceStatusSummary?: string[];
};

type PdfPage = { commands: string[]; index: number };
type ColorName = "body" | "green" | "cyan" | "purple" | "muted" | "amber" | "panel" | "panelAlt";

const width = 612;
const height = 792;
const margin = 44;
const contentWidth = width - margin * 2;

function hexText(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  const bytes = [0xfe, 0xff];
  for (const char of text) {
    const code = char.codePointAt(0) ?? 32;
    if (code > 0xffff) continue;
    bytes.push((code >> 8) & 255, code & 255);
  }
  return `<${bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("")}>`;
}

function wrap(text: string, maxChars: number) {
  const words = String(text || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (`${line} ${word}`.trim().length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = `${line} ${word}`.trim();
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function asList(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : value ? [String(value)] : [];
}

function color(name: ColorName, stroke = false) {
  const values: Record<ColorName, string> = {
    body: "0.85 1.00 0.96",
    green: "0.33 1.00 0.62",
    cyan: "0.20 0.90 1.00",
    purple: "0.78 0.42 1.00",
    muted: "0.53 0.73 0.70",
    amber: "1.00 0.90 0.42",
    panel: "0.012 0.050 0.044",
    panelAlt: "0.016 0.070 0.064"
  };
  return `${values[name]} ${stroke ? "RG" : "rg"}`;
}

function yearOf(article: BriefArticleInput) {
  return article.year || article.publicationYear || article.publication_year || "n.d.";
}

function titleOf(article: BriefArticleInput, extraction?: ArticleExtraction) {
  return article.title || extraction?.title || "Untitled article";
}

function sourceBasis(extraction: ArticleExtraction) {
  if (extraction.sourceStatus === "oa_fulltext_sections_used") return "OA full text verified";
  if (extraction.sourceStatus === "fulltext_found_but_extraction_failed") return "OA found; extraction failed";
  if (extraction.sourceStatus === "abstract_only") return "Abstract only";
  if (extraction.sourceStatus === "no_doi") return "No DOI; abstract only";
  return "Insufficient data";
}

function evidenceWeight(extraction: ArticleExtraction, note?: ArticleNote) {
  if (note?.evidenceWeight) return note.evidenceWeight;
  if (extraction.sourceStatus === "oa_fulltext_sections_used") return "Med";
  return "Low";
}

function sectionsLabel(extraction: ArticleExtraction) {
  return extraction.sectionsUsed.length ? extraction.sectionsUsed.join(", ") : "None";
}

function noteFor(summary: SummaryJson, index: number) {
  return Array.isArray(summary.articleNotes) ? summary.articleNotes[index] : undefined;
}

function methodsText(extraction: ArticleExtraction, note?: ArticleNote) {
  if (note?.designMethods) return note.designMethods;
  if (extraction.methodsText) return extraction.methodsText;
  if (extraction.sourceStatus === "abstract_only" || extraction.sourceStatus === "no_doi") return "Abstract only. Method details are limited to the supplied abstract.";
  return "Method details were not reliably extracted.";
}

function findingsText(extraction: ArticleExtraction, note?: ArticleNote) {
  if (note?.findingsUsed) return note.findingsUsed;
  if (extraction.findingsText) return extraction.findingsText;
  if (note?.note) return note.note;
  if (extraction.abstract) return extraction.abstract;
  return "No usable findings text was available.";
}

function sourceCoverageSentence(coverage: SourceCoverage) {
  return `OA full text used ${coverage.oaFullTextUsed}; abstract only ${coverage.abstractOnly}; fulltext found but extraction failed ${coverage.fulltextFoundButExtractionFailed}; no DOI ${coverage.noDoi}; insufficient data ${coverage.insufficientData}.`;
}

export function generateFindingsBriefPdf({
  jobId,
  articles,
  extractions,
  summary
}: {
  jobId: string;
  articles: BriefArticleInput[];
  extractions: ArticleExtraction[];
  summary: SummaryJson;
}) {
  const pages: PdfPage[] = [];
  let page: PdfPage = { commands: [], index: 0 };
  let y = 0;
  const generatedAt = new Date().toISOString().slice(0, 10);
  const coverage = sourceCoverage(extractions);

  function addPage() {
    page = { commands: [], index: pages.length + 1 };
    pages.push(page);
    page.commands.push("0.008 0.016 0.012 rg 0 0 612 792 re f");
    page.commands.push(`${color("cyan", true)} 0.7 w 28 28 556 736 re S`);
    page.commands.push(`${color("green", true)} 0.5 w 36 744 540 0 l S`);
    textAt("Nursing Research Monitor", margin, 724, 10, "F2", "green");
    textAt("AI-assisted findings synthesis", 348, 724, 8, "F1", "muted");
    textAt(`Page ${page.index}`, 532, 724, 8, "F1", "muted");
    y = 684;
  }

  function ensure(space = 40) {
    if (y - space < 64) addPage();
  }

  function textAt(text: string, x: number, yy: number, size = 9, font = "F1", textColor: ColorName = "body") {
    page.commands.push(`BT ${color(textColor)} /${font} ${size} Tf ${x} ${yy} Td ${hexText(text)} Tj ET`);
  }

  function rect(x: number, top: number, w: number, h: number, stroke: ColorName = "cyan", fill?: ColorName) {
    if (fill) page.commands.push(`${color(fill)} ${x} ${top - h} ${w} ${h} re f`);
    page.commands.push(`${color(stroke, true)} 0.45 w ${x} ${top - h} ${w} ${h} re S`);
  }

  function line(text: string, size = 9, font = "F1", textColor: ColorName = "body") {
    ensure(size + 7);
    textAt(text, margin, y, size, font, textColor);
    y -= size + 6;
  }

  function paragraph(text: string, size = 9, textColor: ColorName = "body", x = margin, maxWidth = contentWidth) {
    for (const part of wrap(text, Math.floor(maxWidth / (size * 0.52)))) {
      ensure(size + 7);
      textAt(part, x, y, size, "F1", textColor);
      y -= size + 5;
    }
    y -= 5;
  }

  function heading(text: string) {
    ensure(40);
    y -= 4;
    line(text, 13, "F2", "cyan");
    page.commands.push(`${color("cyan", true)} 0.3 w ${margin} ${y + 7} ${contentWidth} 0 l S`);
    y -= 8;
  }

  function numberedHeading(number: number, text: string) {
    ensure(32);
    line(`${number}. ${text}`, 11, "F2", "green");
  }

  function bullet(text: string) {
    paragraph(`- ${text}`, 9);
  }

  function panel(title: string, text: string, panelColor: ColorName = "panel") {
    const lines = wrap(text, 96);
    const panelHeight = Math.max(58, 28 + lines.length * 13);
    ensure(panelHeight + 12);
    rect(margin, y, contentWidth, panelHeight, "green", panelColor);
    textAt(title, margin + 12, y - 18, 9, "F2", "green");
    lines.forEach((part, index) => textAt(part, margin + 12, y - 34 - index * 13, 8, "F1", "body"));
    y -= panelHeight + 16;
  }

  function statTiles() {
    const tiles = [
      ["selected articles", String(articles.length), "cyan"],
      ["OA full-text sources", String(coverage.oaFullTextUsed), "green"],
      ["abstract-only sources", String(coverage.abstractOnly + coverage.noDoi), "amber"],
      ["generated", generatedAt, "purple"]
    ] as const;
    const tileWidth = (contentWidth - 24) / 4;
    const top = y;
    tiles.forEach(([label, value, accent], index) => {
      const x = margin + index * (tileWidth + 8);
      rect(x, top, tileWidth, 58, accent, "panelAlt");
      textAt(value, x + 10, top - 24, 17, "F2", accent);
      textAt(label, x + 10, top - 42, 7, "F1", "muted");
    });
    y -= 76;
  }

  function cellLines(text: string, cellWidth: number, size = 7) {
    return wrap(capText(text, 620), Math.max(10, Math.floor((cellWidth - 10) / (size * 0.52))));
  }

  function drawCell(lines: string[], x: number, top: number, w: number, rowHeight: number, textColor: ColorName = "body") {
    const maxLines = Math.max(1, Math.floor((rowHeight - 12) / 10));
    lines.slice(0, maxLines).forEach((part, index) => {
      const suffix = index === maxLines - 1 && lines.length > maxLines ? "..." : "";
      textAt(`${part}${suffix}`, x + 5, top - 13 - index * 10, 7, "F1", textColor);
    });
  }

  function articleSourceLog() {
    const columns = [
      { title: "Selected record", x: margin, w: 122 },
      { title: "Source basis", x: margin + 122, w: 92 },
      { title: "Design / methods", x: margin + 214, w: 112 },
      { title: "Findings used in synthesis", x: margin + 326, w: 154 },
      { title: "Weight", x: margin + 480, w: 44 }
    ];
    const headerHeight = 28;
    ensure(headerHeight + 20);
    rect(margin, y, contentWidth, headerHeight, "cyan", "panelAlt");
    columns.forEach((column) => textAt(column.title, column.x + 5, y - 17, 7, "F2", "cyan"));
    y -= headerHeight;

    articles.forEach((article, index) => {
      const extraction = extractions[index];
      if (!extraction) return;
      const note = noteFor(summary, index);
      const values = [
        `${titleOf(article, extraction)} (${yearOf(article)})`,
        `${sourceBasis(extraction)}; ${sectionsLabel(extraction)}`,
        methodsText(extraction, note),
        findingsText(extraction, note),
        evidenceWeight(extraction, note)
      ];
      const wrapped = values.map((value, valueIndex) => cellLines(value, columns[valueIndex].w));
      const rowHeight = Math.max(54, Math.min(132, Math.max(...wrapped.map((parts) => parts.length)) * 10 + 18));
      ensure(rowHeight + 8);
      rect(margin, y, contentWidth, rowHeight, "muted", index % 2 ? "panel" : "panelAlt");
      columns.slice(1).forEach((column) => {
        page.commands.push(`${color("muted", true)} 0.25 w ${column.x} ${y} 0 -${rowHeight} l S`);
      });
      wrapped.forEach((parts, valueIndex) => drawCell(parts, columns[valueIndex].x, y, columns[valueIndex].w, rowHeight));
      y -= rowHeight;
    });
  }

  function strongestBasis() {
    if (coverage.oaFullTextUsed > 0) return `Full-text methods and results were available for ${coverage.oaFullTextUsed} record(s).`;
    if (coverage.abstractOnly > 0) return `Abstracts were available for ${coverage.abstractOnly} record(s), supporting cautious high-level synthesis.`;
    return "The source basis is limited and should be read primarily as an extraction log.";
  }

  function weakestBasis() {
    const warnings = extractions.flatMap((item) => item.extractionWarnings).filter(Boolean);
    if (coverage.noDoi > 0) return `${coverage.noDoi} record(s) lacked DOI metadata, limiting OpenAlex OA checks.`;
    if (coverage.fulltextFoundButExtractionFailed > 0) return `${coverage.fulltextFoundButExtractionFailed} OA source(s) were found but could not be sectioned reliably.`;
    if (warnings.length) return capText([...new Set(warnings)].join("; "), 180);
    return "No major extraction warnings were recorded, but claims remain bounded by the sections listed in the source log.";
  }

  addPage();
  line("AI-ASSISTED FINDINGS SYNTHESIS", 24, "F2", "cyan");
  paragraph(
    `Generated from ${articles.length} selected Nursing Research Monitor record(s). Job ${jobId}. The synthesis is bounded by the source sections and abstracts listed below.`,
    10,
    "muted"
  );
  statTiles();
  panel(
    "Scope rule used in this brief",
    "The model is instructed to use Methods, Results/Findings and Conclusions when verified open-access full text is available. When full text is not available, the brief uses the abstract only and marks that limitation explicitly."
  );
  heading("Summary at a glance");
  paragraph(summary.executiveSummary || "No executive summary was returned by the model.");
  for (const item of asList(summary.sourceStatusSummary).slice(0, 3)) bullet(item);

  addPage();
  heading("Article-level source log");
  paragraph(
    "This table makes provenance visible before the synthesis is read. The source basis should govern both wording and strength of claims.",
    9,
    "muted"
  );
  articleSourceLog();
  panel(
    "How to read this table",
    "Full-text records can support article-level method and result descriptions. Abstract-only records should be summarized with restrained language, especially for causal or implementation claims.",
    "panelAlt"
  );

  addPage();
  heading("Generated synthesis from selected evidence");
  numberedHeading(1, "Methods represented in the selected records");
  for (const item of asList(summary.methodologicalProfile)) paragraph(item);
  if (!asList(summary.methodologicalProfile).length) paragraph("The selected records did not provide enough method detail for a reliable methodological profile.");
  numberedHeading(2, "Findings across studies");
  for (const item of asList(summary.keyFindings)) paragraph(item);
  numberedHeading(3, "Points of convergence");
  paragraph(summary.executiveSummary || "No convergence statement was returned by the model.");
  numberedHeading(4, "Tensions and cautions");
  for (const item of asList(summary.limitationsOfEvidenceBase)) paragraph(item);
  numberedHeading(5, "Possible implication for readers");
  for (const item of asList(summary.implicationsForNursingResearch)) paragraph(item);
  panel("Strongest basis", strongestBasis(), "panelAlt");
  panel("Weakest basis", weakestBasis(), "panelAlt");

  addPage();
  heading("Production workflow represented by this export");
  paragraph(
    "The system does not let the language model browse freely. It collects article identifiers, checks open-access status through metadata services, extracts permitted sections, and only then sends a bounded prompt to the selected OpenRouter model.",
    9,
    "muted"
  );
  const workflow = [
    ["1", "User selects articles in the monitor interface.", "The selection becomes a reproducible input rather than an invisible model choice."],
    ["2", "Server checks DOI metadata for open-access location.", "The site avoids guessing about paywalls and publisher access."],
    ["3", "Full text is fetched only when legally available.", "The export distinguishes full-text summaries from abstract-only summaries."],
    ["4", "Methods, Results/Findings and Conclusions are extracted.", "The prompt is constrained to evidentiary sections rather than background rhetoric."],
    ["5", "OpenRouter model generates structured synthesis.", "The model works on already curated input."],
    ["6", "PDF is rendered with source log and limitations.", "The reader can see what was used, what was missing and how cautious the synthesis should be."]
  ];
  workflow.forEach(([step, action, reason]) => {
    ensure(42);
    rect(margin, y, 28, 34, "cyan", "panelAlt");
    textAt(step, margin + 10, y - 21, 10, "F2", "cyan");
    textAt(action, margin + 42, y - 13, 8, "F2", "green");
    paragraph(reason, 8, "body", margin + 42, contentWidth - 42);
    y -= 4;
  });
  heading("Quality safeguards");
  bullet("Visible provenance: every article shows whether full text, abstract, no DOI or extraction failure was used.");
  bullet("Conservative wording: abstract-only material should trigger cautious claims.");
  bullet("Section boundaries: introductions and discussions are excluded unless a combined findings/discussion section was explicitly used.");
  bullet("Download audit: the PDF includes generation date, selected records, source basis and extraction notes, but never private API keys.");
  panel("Source coverage", sourceCoverageSentence(coverage), "panelAlt");

  pages.forEach((pdfPage) => {
    pdfPage.commands.push(
      `BT ${color("muted")} /F1 7 Tf 44 34 Td ${hexText(
        "Generated by Nursing Research Monitor. This brief is an AI-assisted synthesis based only on the source sections listed in the evidence table."
      )} Tj ET`
    );
  });

  return buildPdf(pages);
}

function buildPdf(pages: PdfPage[]) {
  const objects: string[] = [];
  const font1 = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const font2 = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>");
  const pageObjectIds: number[] = [];
  const contentObjectIds: number[] = [];

  for (const pdfPage of pages) {
    const stream = pdfPage.commands.join("\n");
    const contentId = addObject(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    contentObjectIds.push(contentId);
    pageObjectIds.push(0);
  }

  const pagesId = objects.length + pages.length + 1;
  for (const [index, contentId] of contentObjectIds.entries()) {
    pageObjectIds[index] = addObject(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R >> >> /Contents ${contentId} 0 R >>`
    );
  }
  const pagesObjectId = addObject(
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageObjectIds.length} >>`
  );
  const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesObjectId} 0 R >>`);

  let output = "%PDF-1.7\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) output += `${String(offset).padStart(10, "0")} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  const buffer = Buffer.from(output);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;

  function addObject(value: string) {
    objects.push(value);
    return objects.length;
  }
}
