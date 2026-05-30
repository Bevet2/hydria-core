import { Buffer } from "node:buffer";
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun
} from "docx";
import JSZip from "jszip";
import PptxGenJS from "pptxgenjs";
import type { WorkObjectKind } from "../../types/workObjects.js";
import { hydriaSheetContentToRows } from "./hydriaWorkspaceModelFactory.js";

export type GeneratedOfficeArtifact = {
  buffer: Buffer;
  format: string;
  filename: string;
  contentType: string;
};

export type GenerateOfficeArtifactArgs = {
  title: string;
  kind: WorkObjectKind;
  requestedFormat: string;
  sourceEntryPath: string;
  content: string;
};

const contentTypes: Record<string, string> = {
  csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  html: "text/html",
  json: "application/json",
  md: "text/markdown",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
};

function normalizeFormat(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^\./, "");
}

function sourceExtension(path: string) {
  const match = /\.([a-z0-9]+)$/i.exec(path);
  return normalizeFormat(match?.[1] || "txt");
}

function safeFilenamePart(value: string, fallback = "hydria-artifact") {
  return (
    String(value || fallback)
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 90) || fallback
  );
}

function normalizeLines(content: string) {
  return String(content || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd());
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function contentToRows(content: string) {
  const hydriaRows = hydriaSheetContentToRows(content);
  if (hydriaRows) {
    return hydriaRows;
  }
  const lines = normalizeLines(content).filter((line) => line.trim().length > 0);
  const rows = lines.map(parseCsvLine);
  return rows.length > 0 ? rows : [["Item", "Status", "Notes"]];
}

function escapeXml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function columnName(index: number) {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function xlsxCellXml(value: string, rowIndex: number, columnIndex: number) {
  const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
  if (/^=.+/.test(value.trim())) {
    return `<c r="${reference}"><f>${escapeXml(value.trim().slice(1))}</f></c>`;
  }
  const numeric = /^-?\d+(?:[.,]\d+)?$/.test(value.trim());
  if (numeric) {
    return `<c r="${reference}"><v>${escapeXml(value.replace(",", "."))}</v></c>`;
  }
  return `<c r="${reference}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
}

function xlsxWorksheetXml(rows: string[][]) {
  const rowXml = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((cell, columnIndex) => xlsxCellXml(cell, rowIndex, columnIndex))
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");
  const columnCount = Math.max(1, ...rows.map((row) => row.length));
  const rowCount = Math.max(1, rows.length);
  const dimension = `A1:${columnName(columnCount - 1)}${rowCount}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <dimension ref="${dimension}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetData>${rowXml}</sheetData>
</worksheet>`;
}

function stripHtmlTags(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|h[1-6])>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<h1\b[^>]*>/gi, "# ")
    .replace(/<h2\b[^>]*>/gi, "## ")
    .replace(/<h3\b[^>]*>/gi, "### ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function markdownToDocParagraphs(content: string) {
  const source = /^\s*</.test(content) ? stripHtmlTags(content) : content;
  const paragraphs: Paragraph[] = [];
  for (const line of normalizeLines(source)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      const level = heading[1]?.length === 1
        ? HeadingLevel.HEADING_1
        : heading[1]?.length === 2
          ? HeadingLevel.HEADING_2
          : HeadingLevel.HEADING_3;
      paragraphs.push(
        new Paragraph({
          text: heading[2] || "",
          heading: level
        })
      );
      continue;
    }
    const bullet = /^[-*]\s+(.+)$/.exec(trimmed);
    if (bullet) {
      paragraphs.push(
        new Paragraph({
          text: bullet[1] || "",
          bullet: {
            level: 0
          }
        })
      );
      continue;
    }
    paragraphs.push(
      new Paragraph({
        children: [new TextRun(trimmed)]
      })
    );
  }
  return paragraphs.length > 0
    ? paragraphs
    : [
        new Paragraph({
          text: "Hydria document"
        })
      ];
}

async function generateDocx(args: GenerateOfficeArtifactArgs) {
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: markdownToDocParagraphs(args.content)
      }
    ]
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

async function generateXlsx(args: GenerateOfficeArtifactArgs) {
  const rows = contentToRows(args.content);
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`
  );
  zip.folder("_rels")?.file(
    ".rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`
  );
  zip.folder("docProps")?.file(
    "core.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:creator>Hydria Core</dc:creator>
  <dc:title>${escapeXml(args.title)}</dc:title>
  <dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
</cp:coreProperties>`
  );
  zip.folder("docProps")?.file(
    "app.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Hydria Core</Application></Properties>`
  );
  zip.folder("xl")?.file(
    "workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Sheet 1" sheetId="1" r:id="rId1"/></sheets>
</workbook>`
  );
  zip.folder("xl")?.folder("_rels")?.file(
    "workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`
  );
  zip.folder("xl")?.folder("worksheets")?.file("sheet1.xml", xlsxWorksheetXml(rows));
  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE"
  });
  return Buffer.from(buffer);
}

type SlideSpec = {
  title: string;
  bullets: string[];
};

type PptxRuntime = {
  layout: string;
  author: string;
  subject: string;
  title: string;
  addSlide: () => {
    background: { color: string };
    addText: (text: string, options: Record<string, unknown>) => void;
  };
  write: (options: { outputType: "nodebuffer" }) => Promise<Buffer | ArrayBuffer>;
};

function parseSlides(title: string, content: string) {
  const slides: SlideSpec[] = [];
  let current: SlideSpec | null = null;
  for (const line of normalizeLines(content)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const slideHeading = /^##\s+(.+)$/.exec(trimmed);
    if (slideHeading) {
      current = {
        title: slideHeading[1] || title,
        bullets: []
      };
      slides.push(current);
      continue;
    }
    const documentHeading = /^#\s+(.+)$/.exec(trimmed);
    if (documentHeading && slides.length === 0) {
      current = {
        title: documentHeading[1] || title,
        bullets: []
      };
      slides.push(current);
      continue;
    }
    current ??= {
      title,
      bullets: []
    };
    if (!slides.includes(current)) {
      slides.push(current);
    }
    const bullet = /^[-*]\s+(.+)$/.exec(trimmed);
    current.bullets.push((bullet?.[1] || trimmed).slice(0, 180));
  }
  return slides.length > 0
    ? slides.slice(0, 20)
    : [
        {
          title,
          bullets: ["Generated by Hydria Core."]
        }
      ];
}

async function generatePptx(args: GenerateOfficeArtifactArgs) {
  const moduleValue = PptxGenJS as unknown as
    | (new () => PptxRuntime)
    | { default?: new () => PptxRuntime };
  const PptxConstructor =
    typeof moduleValue === "function" ? moduleValue : moduleValue.default;
  if (!PptxConstructor) {
    throw new Error("pptx generator is unavailable");
  }
  const pptx = new PptxConstructor();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Hydria Core";
  pptx.subject = args.kind;
  pptx.title = args.title;

  for (const spec of parseSlides(args.title, args.content)) {
    const slide = pptx.addSlide();
    slide.background = { color: "FFFFFF" };
    slide.addText(spec.title, {
      x: 0.6,
      y: 0.4,
      w: 12,
      h: 0.6,
      fontFace: "Aptos Display",
      fontSize: 28,
      bold: true,
      color: "1F2937"
    });
    slide.addText(spec.bullets.map((bullet) => `• ${bullet}`).join("\n"), {
      x: 0.85,
      y: 1.35,
      w: 11.4,
      h: 4.8,
      fontFace: "Aptos",
      fontSize: 18,
      breakLine: false,
      fit: "shrink",
      color: "374151",
      valign: "top"
    });
  }

  const output = await pptx.write({ outputType: "nodebuffer" });
  return Buffer.isBuffer(output) ? output : Buffer.from(output as ArrayBuffer);
}

export async function generateOfficeArtifact(args: GenerateOfficeArtifactArgs): Promise<GeneratedOfficeArtifact> {
  const requested = normalizeFormat(args.requestedFormat);
  const fallback = sourceExtension(args.sourceEntryPath);
  const format = requested || fallback;
  const filename = `${safeFilenamePart(args.title)}.${format}`;

  if (format === "docx") {
    return {
      buffer: await generateDocx(args),
      format,
      filename,
      contentType: contentTypes.docx ?? "application/octet-stream"
    };
  }

  if (format === "xlsx") {
    return {
      buffer: await generateXlsx(args),
      format,
      filename,
      contentType: contentTypes.xlsx ?? "application/octet-stream"
    };
  }

  if (format === "pptx") {
    return {
      buffer: await generatePptx(args),
      format,
      filename,
      contentType: contentTypes.pptx ?? "application/octet-stream"
    };
  }

  return {
    buffer: Buffer.from(args.content, "utf8"),
    format,
    filename,
    contentType: contentTypes[format] ?? contentTypes[fallback] ?? "application/octet-stream"
  };
}
