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
type ColorName =
  | "page"
  | "body"
  | "muted"
  | "heading"
  | "accent"
  | "border"
  | "panel"
  | "panelAlt"
  | "success"
  | "warning"
  | "danger";

const width = 612;
const height = 792;
const margin = 44;
const topStart = 706;
const bottomMargin = 56;
const contentWidth = width - margin * 2;

const colors: Record<ColorName, string> = {
  page: "0.985 0.982 0.965",
  body: "0.120 0.145 0.160",
  muted: "0.420 0.470 0.500",
  heading: "0.020 0.270 0.320",
  accent: "0.000 0.520 0.600",
  border: "0.760 0.820 0.820",
  panel: "1.000 1.000 1.000",
  panelAlt: "0.940 0.970 0.970",
  success: "0.080 0.420 0.260",
  warning: "0.680 0.420 0.050",
  danger: "0.640 0.120 0.120"
};

const cp1252: Record<number, number> = {
  0x2018: 0x27,
  0x2019: 0x27,
  0x201a: 0x2c,
  0x201c: 0x22,
  0x201d: 0x22,
  0x201e: 0x22,
  0x2013: 0x2d,
  0x2014: 0x2d,
  0x2212: 0x2d,
  0x2026: 0x85,
  0x2022: 0x95,
  0x00a0: 0x20,
  0x2122: 0x99,
  0x00b7: 0xb7
};

function color(name: ColorName, stroke = false) {
  return `${colors[name]} ${stroke ? "RG" : "rg"}`;
}

function fallbackCharBytes(char: string) {
  const normalized = char.normalize("NFKD").replace(/\p{Diacritic}/gu, "");
  const output = normalized && normalized !== char ? normalized : "?";
  return [...output].flatMap((candidate) => {
    const code = candidate.codePointAt(0) ?? 63;
    return code <= 0xff ? [code] : [63];
  });
}

function pdfString(value: string) {
  const bytes: number[] = [];
  for (const char of String(value ?? "")) {
    const code = char.codePointAt(0) ?? 32;
    if ((code >= 0 && code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31)) {
      bytes.push(32);
    } else if (code <= 0xff) bytes.push(code);
    else if (cp1252[code]) bytes.push(cp1252[code]);
    else bytes.push(...fallbackCharBytes(char));
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

function yearOf(article: BriefArticleInput) {
  return article.year || article.publicationYear || article.publication_year || "n.d.";
}

function titleOf(article: BriefArticleInput, extraction?: ArticleExtraction) {
  return article.title || extraction?.title || "Untitled article";
}

function noteFor(summary: SummaryJson, index: number) {
  return Array.isArray(summary.articleNotes) ? summary.articleNotes[index] : undefined;
}

function sourceBasis(extraction: ArticleExtraction) {
  if (extraction.sourceStatus === "oa_fulltext_sections_used") return "OA full text used";
  if (extraction.sourceStatus === "fulltext_found_but_extraction_failed") return "Full text found; extraction failed";
  if (extraction.sourceStatus === "abstract_only") return "Abstract only";
  if (extraction.sourceStatus === "no_doi") return "No DOI";
  return "Insufficient data";
}

function evidenceWeight(extraction: ArticleExtraction, note?: ArticleNote) {
  if (note?.evidenceWeight) return note.evidenceWeight;
  if (extraction.sourceStatus === "oa_fulltext_sections_used") return "Medium";
  return "Low";
}

function methodsText(extraction: ArticleExtraction, note?: ArticleNote) {
  if (note?.designMethods) return note.designMethods;
  if (extraction.methodsText) return extraction.methodsText;
  if (extraction.abstract) return "Method details are limited to the supplied abstract.";
  return "Method details were not available.";
}

function findingsText(extraction: ArticleExtraction, note?: ArticleNote) {
  if (note?.findingsUsed) return note.findingsUsed;
  if (extraction.findingsText) return extraction.findingsText;
  if (note?.note) return note.note;
  if (extraction.abstract) return extraction.abstract;
  return "No usable findings text was available.";
}

function warningsText(extraction: ArticleExtraction) {
  return extraction.extractionWarnings.length ? extraction.extractionWarnings.join("; ") : "No extraction warnings recorded.";
}

function sourceCoverageTotal(coverage: SourceCoverage) {
  return (
    coverage.oaFullTextUsed +
    coverage.abstractOnly +
    coverage.fulltextFoundButExtractionFailed +
    coverage.noDoi +
    coverage.insufficientData
  );
}

export function generateFindingsBriefPdf({
  jobId,
  articles,
  extractions,
  summary,
  synthesisMode = "model",
  fallbackReason = ""
}: {
  jobId: string;
  articles: BriefArticleInput[];
  extractions: ArticleExtraction[];
  summary: SummaryJson;
  synthesisMode?: "model" | "fallback";
  fallbackReason?: string;
}) {
  const pages: PdfPage[] = [];
  let page: PdfPage = { commands: [], index: 0 };
  let y = 0;
  const generatedAt = new Date().toISOString().slice(0, 10);
  const coverage = sourceCoverage(extractions);
  const isFallback = synthesisMode === "fallback";

  function addPage() {
    page = { commands: [], index: pages.length + 1 };
    pages.push(page);
    page.commands.push(`${color("page")} 0 0 ${width} ${height} re f`);
    page.commands.push(`${color("accent")} ${margin} 746 2 16 re f`);
    textAt("Nursing Research Monitor", margin + 12, 754, 9, "F2", "heading");
    textAt(isFallback ? "Fallback evidence notes" : "AI findings brief", 390, 754, 8, "F1", "muted");
    page.commands.push(`${color("border", true)} 0.4 w ${margin} 736 ${contentWidth} 0 l S`);
    textAt(`Page ${page.index}`, width - margin - 36, 34, 7, "F1", "muted");
    y = topStart;
  }

  function ensure(space = 36) {
    if (y - space < bottomMargin) addPage();
  }

  function textAt(text: string, x: number, yy: number, size = 9, font = "F1", textColor: ColorName = "body") {
    page.commands.push(`BT ${color(textColor)} /${font} ${size} Tf ${x} ${yy} Td ${pdfString(text)} Tj ET`);
  }

  function rect(x: number, top: number, w: number, h: number, stroke: ColorName = "border", fill?: ColorName, lineWidth = 0.5) {
    if (fill) page.commands.push(`${color(fill)} ${x} ${top - h} ${w} ${h} re f`);
    page.commands.push(`${color(stroke, true)} ${lineWidth} w ${x} ${top - h} ${w} ${h} re S`);
  }

  function textLines(text: string, size: number, maxWidth: number) {
    return wrap(text, Math.max(12, Math.floor(maxWidth / (size * 0.5))));
  }

  function paragraph(text: string, size = 9, textColor: ColorName = "body", x = margin, maxWidth = contentWidth) {
    const lineHeight = Math.ceil(size * 1.38);
    for (const part of textLines(text, size, maxWidth)) {
      ensure(lineHeight + 2);
      textAt(part, x, y, size, "F1", textColor);
      y -= lineHeight;
    }
    y -= 6;
  }

  function heading(text: string) {
    ensure(46);
    y -= 2;
    textAt(text, margin, y, 14, "F2", "heading");
    y -= 10;
    page.commands.push(`${color("accent", true)} 0.6 w ${margin} ${y} 92 0 l S`);
    y -= 16;
  }

  function bullet(text: string) {
    const x = margin + 12;
    const lines = textLines(text, 9, contentWidth - 18);
    ensure(lines.length * 14 + 4);
    textAt("•", margin, y, 9, "F2", "accent");
    lines.forEach((line, index) => textAt(line, x, y - index * 13, 9, "F1", "body"));
    y -= lines.length * 13 + 6;
  }

  function callout(title: string, text: string, tone: "info" | "warning" = "info") {
    const lines = textLines(text, 8.5, contentWidth - 24);
    const boxHeight = Math.max(56, 30 + lines.length * 12);
    ensure(boxHeight + 10);
    rect(margin, y, contentWidth, boxHeight, tone === "warning" ? "warning" : "border", tone === "warning" ? "panelAlt" : "panel");
    textAt(title, margin + 12, y - 18, 9, "F2", tone === "warning" ? "warning" : "heading");
    lines.forEach((line, index) => textAt(line, margin + 12, y - 34 - index * 12, 8.5, "F1", "body"));
    y -= boxHeight + 14;
  }

  function coverageCards() {
    const total = sourceCoverageTotal(coverage);
    paragraph(`Generated ${generatedAt}. Selected articles: ${articles.length}. Source coverage accounted for: ${total}/${articles.length}.`, 9, "muted");
    const items = [
      ["OA full text used", coverage.oaFullTextUsed, "success"],
      ["Abstract only", coverage.abstractOnly, "accent"],
      ["Full text extraction failed", coverage.fulltextFoundButExtractionFailed, "warning"],
      ["No DOI", coverage.noDoi, "muted"],
      ["Insufficient data", coverage.insufficientData, "danger"]
    ] as const;
    const gap = 7;
    const cardWidth = (contentWidth - gap * 4) / 5;
    const top = y;
    ensure(58);
    items.forEach(([label, value, tone], index) => {
      const x = margin + index * (cardWidth + gap);
      rect(x, top, cardWidth, 52, "border", "panel");
      textAt(String(value), x + 8, top - 19, 16, "F2", tone);
      for (const [lineIndex, line] of textLines(label, 6.5, cardWidth - 16).slice(0, 2).entries()) {
        textAt(line, x + 8, top - 34 - lineIndex * 9, 6.5, "F1", "muted");
      }
    });
    y -= 70;
  }

  function listSection(title: string, items: unknown, empty: string) {
    heading(title);
    const list = asList(items);
    if (!list.length) paragraph(empty, 9, "muted");
    for (const item of list) bullet(item);
  }

  function articleCard(article: BriefArticleInput, extraction: ArticleExtraction, index: number) {
    const note = noteFor(summary, index);
    const titleLines = textLines(`${index + 1}. ${titleOf(article, extraction)}`, 10, contentWidth - 24);
    const warningLines = textLines(capText(warningsText(extraction), 280), 7.5, contentWidth - 24);
    const methodLines = textLines(capText(methodsText(extraction, note), 340), 8, contentWidth - 24);
    const findingLines = textLines(capText(findingsText(extraction, note), 520), 8, contentWidth - 24);
    const metaLines = [
      `Year: ${yearOf(article)}   DOI: ${extraction.doi || "none"}`,
      `Source status: ${sourceBasis(extraction)}   Sections used: ${extraction.sectionsUsed.join(", ") || "none"}   Weight: ${evidenceWeight(extraction, note)}`
    ];
    const cardHeight =
      30 +
      titleLines.length * 12 +
      metaLines.length * 11 +
      warningLines.length * 10 +
      methodLines.length * 10 +
      findingLines.length * 10 +
      56;
    ensure(cardHeight + 8);
    const top = y;
    rect(margin, top, contentWidth, cardHeight, "border", "panel");
    page.commands.push(`${color("accent")} ${margin} ${top - cardHeight} 4 ${cardHeight} re f`);
    let cursor = top - 18;
    titleLines.forEach((line) => {
      textAt(line, margin + 14, cursor, 10, "F2", "heading");
      cursor -= 12;
    });
    metaLines.forEach((line) => {
      textAt(line, margin + 14, cursor, 7.8, "F1", "muted");
      cursor -= 11;
    });
    cursor -= 4;
    textAt("Extraction warnings", margin + 14, cursor, 7.5, "F2", "warning");
    cursor -= 10;
    warningLines.forEach((line) => {
      textAt(line, margin + 14, cursor, 7.5, "F1", "body");
      cursor -= 10;
    });
    cursor -= 3;
    textAt("Short method note", margin + 14, cursor, 7.5, "F2", "heading");
    cursor -= 10;
    methodLines.forEach((line) => {
      textAt(line, margin + 14, cursor, 8, "F1", "body");
      cursor -= 10;
    });
    cursor -= 3;
    textAt("Short findings note", margin + 14, cursor, 7.5, "F2", "heading");
    cursor -= 10;
    findingLines.forEach((line) => {
      textAt(line, margin + 14, cursor, 8, "F1", "body");
      cursor -= 10;
    });
    y -= cardHeight + 12;
  }

  addPage();
  textAt("Nursing Research Monitor", margin, y, 18, "F2", "heading");
  y -= 24;
  textAt(isFallback ? "Fallback Evidence Notes" : "AI Findings Brief", margin, y, 24, "F2", "body");
  y -= 28;
  paragraph(
    `A source-status-aware brief generated from ${articles.length} selected record(s). Job: ${jobId}.`,
    10,
    "muted"
  );
  coverageCards();
  if (isFallback) {
    callout(
      "Fallback notice",
      "This brief was generated using fallback extraction notes because the selected OpenRouter model did not return a usable synthesis.",
      "warning"
    );
    if (fallbackReason) callout("Model status", fallbackReason, "warning");
  }
  heading(isFallback ? "Fallback evidence notes" : "Executive synthesis");
  paragraph(summary.executiveSummary || "No executive synthesis was returned.", 10);

  listSection("Key findings", summary.keyFindings, "No key findings were returned.");
  listSection("Methodological profile", summary.methodologicalProfile, "No methodological profile was returned.");
  listSection("Implications for nursing research", summary.implicationsForNursingResearch, "No implications were returned.");
  listSection("Limitations of this brief", summary.limitationsOfEvidenceBase, "No limitations were returned.");

  heading("Article-level source log");
  paragraph(
    "Each record below shows how it contributed to the brief. Claims should be read in light of the source status, sections used, and extraction warnings.",
    9,
    "muted"
  );
  articles.forEach((article, index) => {
    const extraction = extractions[index];
    if (extraction) articleCard(article, extraction, index);
  });

  heading("Source note");
  paragraph(
    "The monitor uses DOI-first OpenAlex metadata, legal open-access locations where available, and abstract fallbacks when full text is not legally accessible or cannot be sectioned reliably. This PDF does not include hidden prompts, API keys, or raw provider errors.",
    8.5,
    "muted"
  );

  pages.forEach((pdfPage) => {
    pdfPage.commands.push(
      `BT ${color("muted")} /F1 7 Tf ${margin} 22 Td ${pdfString(
        "Generated by Nursing Research Monitor. This brief is based only on the source sections and abstracts listed in the article-level source log."
      )} Tj ET`
    );
  });

  return buildPdf(pages);
}

function buildPdf(pages: PdfPage[]) {
  const objects: string[] = [];
  const toUnicode = addObject(buildWinAnsiToUnicodeCMap());
  const font1 = addObject(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding /ToUnicode ${toUnicode} 0 R >>`);
  const font2 = addObject(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding /ToUnicode ${toUnicode} 0 R >>`);
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
  const buffer = Buffer.from(output, "latin1");
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;

  function addObject(value: string) {
    objects.push(value);
    return objects.length;
  }
}

function buildWinAnsiToUnicodeCMap() {
  const special: Record<number, number> = {
    0x80: 0x20ac,
    0x82: 0x201a,
    0x83: 0x0192,
    0x84: 0x201e,
    0x85: 0x2026,
    0x86: 0x2020,
    0x87: 0x2021,
    0x88: 0x02c6,
    0x89: 0x2030,
    0x8a: 0x0160,
    0x8b: 0x2039,
    0x8c: 0x0152,
    0x8e: 0x017d,
    0x91: 0x2018,
    0x92: 0x2019,
    0x93: 0x201c,
    0x94: 0x201d,
    0x95: 0x2022,
    0x96: 0x2013,
    0x97: 0x2014,
    0x98: 0x02dc,
    0x99: 0x2122,
    0x9a: 0x0161,
    0x9b: 0x203a,
    0x9c: 0x0153,
    0x9e: 0x017e,
    0x9f: 0x0178
  };
  const entries = Array.from({ length: 256 }, (_, byte) => {
    const unicode = special[byte] ?? (byte < 32 ? 0x0020 : byte);
    return `<${byte.toString(16).padStart(2, "0")}> <${unicode.toString(16).padStart(4, "0")}>`;
  });
  const chunks = [];
  for (let index = 0; index < entries.length; index += 100) {
    const chunk = entries.slice(index, index + 100);
    chunks.push(`${chunk.length} beginbfchar\n${chunk.join("\n")}\nendbfchar`);
  }
  const stream = `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /WinAnsiToUnicode def
/CMapType 2 def
1 begincodespacerange
<00> <ff>
endcodespacerange
${chunks.join("\n")}
endcmap
CMapName currentdict /CMap defineresource pop
end
end`;
  return `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
}
