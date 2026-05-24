import { sourceCoverage, type ArticleExtraction, type BriefArticleInput, type SourceCoverage } from "./brief-utils.js";

type SummaryJson = {
  executiveSummary?: string;
  keyFindings?: string[];
  methodologicalProfile?: string[];
  implicationsForNursingResearch?: string[];
  limitationsOfEvidenceBase?: string[];
  articleNotes?: Array<{ title?: string; note?: string; sourceStatus?: string }>;
  sourceStatusSummary?: string[];
};

type PdfPage = { commands: string[] };

const width = 612;
const height = 792;
const margin = 44;

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
  return Array.isArray(value) ? value.map(String) : value ? [String(value)] : [];
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
  let page: PdfPage;
  let y = 0;

  function addPage() {
    page = { commands: [] };
    pages.push(page);
    page.commands.push("0.008 0.016 0.012 rg 0 0 612 792 re f");
    page.commands.push("0.20 0.90 1.00 RG 0.7 w 28 28 556 736 re S");
    page.commands.push("0.33 1.00 0.62 RG 0.5 w 36 744 540 0 l S");
    y = 724;
    line("Nursing Research Monitor", 10, "F2", "green");
    y -= 8;
  }

  function color(name: "body" | "green" | "cyan" | "purple" | "muted" | "amber") {
    return {
      body: "0.85 1.00 0.96 rg",
      green: "0.33 1.00 0.62 rg",
      cyan: "0.20 0.90 1.00 rg",
      purple: "0.78 0.42 1.00 rg",
      muted: "0.53 0.73 0.70 rg",
      amber: "1.00 0.90 0.42 rg"
    }[name];
  }

  function ensure(space = 24) {
    if (y - space < 56) addPage();
  }

  function line(text: string, size = 9, font = "F1", textColor: "body" | "green" | "cyan" | "purple" | "muted" | "amber" = "body") {
    ensure(size + 5);
    page.commands.push(`BT ${color(textColor)} /${font} ${size} Tf ${margin} ${y} Td ${hexText(text)} Tj ET`);
    y -= size + 5;
  }

  function paragraph(text: string, size = 9, textColor: "body" | "muted" = "body") {
    for (const part of wrap(text, Math.floor((width - margin * 2) / (size * 0.52)))) {
      line(part, size, "F1", textColor);
    }
    y -= 6;
  }

  function heading(text: string) {
    y -= 4;
    line(`> ${text.toUpperCase()}`, 11, "F2", "cyan");
    page.commands.push("0.20 0.90 1.00 RG 0.3 w 44 " + (y + 5) + " 524 0 l S");
    y -= 5;
  }

  function bullet(text: string) {
    paragraph(`- ${text}`, 9);
  }

  addPage();
  const generatedAt = new Date().toISOString().slice(0, 10);
  const coverage: SourceCoverage = sourceCoverage(extractions);
  line("AI FINDINGS BRIEF", 24, "F2", "cyan");
  paragraph(`Date generated: ${generatedAt}. Selected articles: ${articles.length}. Job: ${jobId}`, 10, "muted");
  paragraph(
    `Source coverage: OA full text used ${coverage.oaFullTextUsed}; abstract only ${coverage.abstractOnly}; fulltext found but extraction failed ${coverage.fulltextFoundButExtractionFailed}; no DOI ${coverage.noDoi}; insufficient data ${coverage.insufficientData}.`,
    10
  );

  heading("Executive synthesis");
  paragraph(summary.executiveSummary || "No executive summary was returned by the model.");

  heading("Key findings across selected studies");
  for (const item of asList(summary.keyFindings)) bullet(item);

  heading("Methodological profile");
  for (const item of asList(summary.methodologicalProfile)) bullet(item);

  heading("Implications for nursing research");
  for (const item of asList(summary.implicationsForNursingResearch)) bullet(item);

  heading("Limitations of this brief");
  for (const item of asList(summary.limitationsOfEvidenceBase)) bullet(item);

  heading("Article-level evidence table");
  articles.forEach((article, index) => {
    const extraction = extractions[index];
    paragraph(
      `${index + 1}. ${article.title || extraction.title} (${article.year || article.publicationYear || article.publication_year || "n.d."}) | DOI: ${extraction.doi || "none"} | Source: ${extraction.sourceStatus} | Sections: ${extraction.sectionsUsed.join(", ") || "none"}`,
      8
    );
  });

  heading("Source status and extraction notes");
  extractions.forEach((extraction, index) => {
    paragraph(
      `${index + 1}. ${extraction.sourceStatus}${extraction.isRetracted ? " | RETRACTED" : ""}. Warnings: ${extraction.extractionWarnings.join("; ") || "none"}`,
      8,
      "muted"
    );
  });

  for (const pdfPage of pages) {
    pdfPage.commands.push(
      `BT 0.53 0.73 0.70 rg /F1 7 Tf 44 34 Td ${hexText(
        "Generated by Nursing Research Monitor. This brief is an AI-assisted synthesis based only on the source sections listed in the evidence table."
      )} Tj ET`
    );
  }

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
  const pagesObjectId = addObject(`<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageObjectIds.length} >>`);
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
