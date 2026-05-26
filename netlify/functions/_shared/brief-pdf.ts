import { cleanBriefText, sourceCoverage, stripMarkupTags, type ArticleExtraction, type BriefArticleInput } from "./brief-utils.js";

type PdfPage = { commands: string[]; index: number };
type ColorName = "page" | "body" | "muted" | "heading" | "accent" | "border" | "panel" | "success" | "warning" | "danger";

const width = 612;
const height = 792;
const margin = 44;
const contentWidth = width - margin * 2;
const topStart = 706;
const bottomMargin = 56;

const colors: Record<ColorName, string> = {
  page: "0.985 0.982 0.965",
  body: "0.120 0.145 0.160",
  muted: "0.420 0.470 0.500",
  heading: "0.020 0.270 0.320",
  accent: "0.000 0.520 0.600",
  border: "0.760 0.820 0.820",
  panel: "1.000 1.000 1.000",
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
  0x2122: 0x99
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
    if ((code >= 0 && code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31)) bytes.push(32);
    else if (code <= 0xff) bytes.push(code);
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
    } else line = `${line} ${word}`.trim();
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

type MarkdownBlock = { type: "h1" | "h2" | "p" | "li"; text: string };

export function normalizeBriefMarkdown(markdown: string) {
  return stripMarkupTags(markdown)
    .replace(/[\u2018\u2019\u201a]/g, "'")
    .replace(/[\u201c\u201d\u201e]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/```/g, "")
    .replace(/\s+(#{1,2}\s+)/g, "\n\n$1")
    .replace(/\s+([-*]\s+)/g, "\n$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parseBriefMarkdown(markdown: string): MarkdownBlock[] {
  const normalized = normalizeBriefMarkdown(markdown);
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];

  function flushParagraph() {
    const text = paragraph.join(" ").trim();
    if (text) blocks.push({ type: "p", text });
    paragraph = [];
  }

  for (const rawLine of normalized.split(/\n+/)) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      continue;
    }
    if (/^#\s+/.test(line)) {
      flushParagraph();
      blocks.push({ type: "h1", text: line.replace(/^#\s+/, "") });
      continue;
    }
    if (/^##\s+/.test(line)) {
      flushParagraph();
      blocks.push({ type: "h2", text: line.replace(/^##\s+/, "") });
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      flushParagraph();
      blocks.push({ type: "li", text: line.replace(/^[-*]\s+/, "") });
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  return blocks;
}

function briefCoverage(extractions: ArticleExtraction[]) {
  const coverage = sourceCoverage(extractions);
  return {
    oaFullTextUsed: coverage.oaFullTextUsed,
    abstractOnly: coverage.abstractOnly,
    extractionFailedAbstractUsed: coverage.fulltextFoundButExtractionFailed,
    insufficientData: coverage.insufficientData + coverage.noDoi
  };
}

export function generateFindingsBriefPdf({
  articles,
  extractions,
  markdown,
  synthesisMode = "model"
}: {
  articles: BriefArticleInput[];
  extractions: ArticleExtraction[];
  markdown: string;
  synthesisMode?: "model" | "fallback";
}) {
  const pages: PdfPage[] = [];
  let page: PdfPage = { commands: [], index: 0 };
  let y = 0;
  const generatedAt = new Date().toISOString().slice(0, 10);
  const isFallback = synthesisMode === "fallback";
  const coverage = briefCoverage(extractions);

  function addPage() {
    page = { commands: [], index: pages.length + 1 };
    pages.push(page);
    page.commands.push(`${color("page")} 0 0 ${width} ${height} re f`);
    page.commands.push(`${color("accent")} ${margin} 746 2 16 re f`);
    textAt("Nursing Research Monitor", margin + 12, 754, 9, "F2", "heading");
    textAt(isFallback ? "Fallback notes" : "AI findings brief", 418, 754, 8, "F1", "muted");
    page.commands.push(`${color("border", true)} 0.4 w ${margin} 736 ${contentWidth} 0 l S`);
    textAt(`Page ${page.index}`, width - margin - 36, 34, 7, "F1", "muted");
    y = topStart;
  }

  function ensure(space = 36) {
    if (y - space < bottomMargin) addPage();
  }

  function textAt(text: string, x: number, yy: number, size = 9, font = "F1", textColor: ColorName = "body") {
    page.commands.push(`BT ${color(textColor)} /${font} ${size} Tf ${x} ${yy} Td ${pdfString(cleanBriefText(text, 1200))} Tj ET`);
  }

  function rect(x: number, top: number, w: number, h: number, stroke: ColorName = "border", fill?: ColorName, lineWidth = 0.5) {
    if (fill) page.commands.push(`${color(fill)} ${x} ${top - h} ${w} ${h} re f`);
    page.commands.push(`${color(stroke, true)} ${lineWidth} w ${x} ${top - h} ${w} ${h} re S`);
  }

  function paragraph(text: string, size = 9, textColor: ColorName = "body", x = margin, maxWidth = contentWidth) {
    const lineHeight = Math.ceil(size * 1.38);
    for (const line of wrap(text, Math.max(12, Math.floor(maxWidth / (size * 0.5))))) {
      ensure(lineHeight + 2);
      textAt(line, x, y, size, "F1", textColor);
      y -= lineHeight;
    }
    y -= 6;
  }

  function h2(text: string) {
    ensure(44);
    y -= 2;
    textAt(text, margin, y, 13.5, "F2", "heading");
    y -= 10;
    page.commands.push(`${color("accent", true)} 0.6 w ${margin} ${y} 86 0 l S`);
    y -= 15;
  }

  function bullet(text: string) {
    const x = margin + 13;
    const lines = wrap(text, Math.floor((contentWidth - 20) / 4.7));
    ensure(lines.length * 13 + 6);
    textAt("•", margin, y, 9, "F2", "accent");
    lines.forEach((line, index) => textAt(line, x, y - index * 13, 9, "F1", "body"));
    y -= lines.length * 13 + 6;
  }

  function coverageRow() {
    const items = [
      ["OA full text used", coverage.oaFullTextUsed, "success"],
      ["Abstract only", coverage.abstractOnly, "accent"],
      ["Extraction failed, abstract used", coverage.extractionFailedAbstractUsed, "warning"],
      ["Insufficient data", coverage.insufficientData, "danger"]
    ] as const;
    const gap = 8;
    const cardWidth = (contentWidth - gap * 3) / 4;
    const top = y;
    ensure(56);
    items.forEach(([label, value, tone], index) => {
      const x = margin + index * (cardWidth + gap);
      rect(x, top, cardWidth, 50, "border", "panel");
      textAt(String(value), x + 8, top - 18, 15, "F2", tone);
      wrap(label, 17)
        .slice(0, 2)
        .forEach((line, lineIndex) => textAt(line, x + 8, top - 33 - lineIndex * 9, 6.5, "F1", "muted"));
    });
    y -= 68;
  }

  addPage();
  textAt("Nursing Research Monitor", margin, y, 18, "F2", "heading");
  y -= 26;
  textAt(isFallback ? "Fallback Evidence Notes" : "AI Findings Brief", margin, y, 24, "F2", "body");
  y -= 28;
  paragraph(`Generated ${generatedAt}. Selected articles: ${articles.length}.`, 10, "muted");
  coverageRow();

  for (const block of parseBriefMarkdown(markdown)) {
    if (block.type === "h1") continue;
    if (block.type === "h2") h2(block.text);
    else if (block.type === "li") bullet(block.text);
    else paragraph(block.text, 9.3);
  }

  h2("Provenance note");
  paragraph(
    "This brief is AI-assisted and based only on the source material listed above. Abstract-only records should be interpreted cautiously.",
    8.5,
    "muted"
  );

  pages.forEach((pdfPage) => {
    pdfPage.commands.push(
      `BT ${color("muted")} /F1 7 Tf ${margin} 22 Td ${pdfString(
        "Generated by Nursing Research Monitor. AI-assisted synthesis based only on the listed source material."
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
