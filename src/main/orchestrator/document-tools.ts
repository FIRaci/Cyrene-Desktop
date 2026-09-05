// Document generation tools: create deliverables (Excel/Word/PDF/Markdown).
//
// Design highlights:
// - Documents saved to desktop by default (app.getPath("desktop"))
// - Supports desktop subdirectories (e.g. "test/report.xlsx"), creates parent dirs automatically
// - Filename provided by model, validates extension (guards against .exe etc.)
// - Returns full path to model to communicate to user
// - PDF fonts check system fonts, fallback if not found

import * as fs from "fs";
import * as path from "path";
import { app } from "electron";
import { toolRegistry } from "./tool-registry";

const LOG_PREFIX = "[DocTools]";

/** Validate filename: must have valid extension and no unsafe characters. */
function validateFilename(filename: string, ext: string): string | null {
  if (!filename || typeof filename !== "string") return null;
  if (!filename.toLowerCase().endsWith(ext)) return null;
  // Guard against unsafe characters
  if (/[<>:"|?*]/.test(filename)) return null;
  return filename;
}

/**
 * Resolve output path: filename may contain subdirectories, rooted at desktop.
 * Security check: disallows .. traversal and absolute paths.
 * Returns absolute path or null if validation fails.
 */
function resolveOutputPath(filename: string): string | null {
  const normalized = path.normalize(filename).replace(/\\/g, "/");
  // Disallow directory traversal and absolute paths
  if (normalized.includes("..") || path.isAbsolute(normalized)) return null;
  const desktop = app.getPath("desktop");
  const fullPath = path.join(desktop, normalized);
  // Final validation: resolved path must remain within desktop
  if (!fullPath.startsWith(desktop)) return null;
  return fullPath;
}

/** Desktop path (legacy helper, retained for compatibility). */
function desktopPath(filename: string): string {
  return path.join(app.getPath("desktop"), filename);
}

// -- Style loader (shared by Excel + Word) --
// Loads JSON style files from skills/{skillId}/styles/ with caching.
interface StyleCacheEntry { [styleId: string]: Record<string, unknown> }
const styleCache = new Map<string, StyleCacheEntry>();
const styleLoaded = new Set<string>();

function loadStylesDir(skillId: string): StyleCacheEntry {
  if (styleLoaded.has(skillId)) return styleCache.get(skillId) ?? {};
  styleLoaded.add(skillId);
  const cache: StyleCacheEntry = {};
  try {
    const candidates = [
      path.join(app.getAppPath(), "skills", skillId, "styles"),
      path.join(process.cwd(), "skills", skillId, "styles"),
    ];
    let stylesDir = "";
    for (const c of candidates) {
      if (fs.existsSync(c)) { stylesDir = c; break; }
    }
    if (!stylesDir) return {};

    for (const f of fs.readdirSync(stylesDir)) {
      if (!f.endsWith(".json")) continue;
      const styleId = f.replace(/\.json$/, "");
      try {
        cache[styleId] = JSON.parse(fs.readFileSync(path.join(stylesDir, f), "utf8"));
      } catch { /* Skip invalid files */ }
    }
    console.log(LOG_PREFIX, `Loaded ${skillId} styles:`, Object.keys(cache).join(", ") || "(none)");
  } catch { /* Directory does not exist */ }
  styleCache.set(skillId, cache);
  return cache;
}

/** Convert hex color to ARGB (FF prefix). docx library uses 6-digit RRGGBB. */
function toHexColor(color: string): string {
  const c = color.replace("#", "").toUpperCase();
  if (c.length === 8) return c.slice(2);  // FFRRGGBB → RRGGBB
  if (c.length === 6) return c;
  return "1F4E79"; // Fallback
}

export function registerDocumentTools(): void {
  // -- Style system --
  // Loads style presets from skills/xlsx/styles/ instead of hardcoding.
  // Model selects style, passing chosen style to write_excel.
  type ExcelFill = import("exceljs").Fill;
  type ExcelBorders = import("exceljs").Borders;

  interface Theme {
    name: string;
    headerFill: string;      // ARGB
    headerFont: string;     // ARGB
    headerBorder: string;   // ARGB (medium bottom)
    zebraFill: string;      // ARGB
    borderColor: string;    // ARGB
  }

  /** Load all style JSONs from skills/xlsx/styles/ (cached). */
  const themeCache = new Map<string, Theme>();
  let themesLoaded = false;

  const DEFAULT_THEME: Theme = {
    name: "Default navy", headerFill: "FF1F4E79", headerFont: "FFFFFFFF",
    headerBorder: "FF1F4E79", zebraFill: "FFF2F2F2", borderColor: "FFBFBFBF",
  };

  function loadThemes(): void {
    if (themesLoaded) return;
    themesLoaded = true;
    try {
      // Try multiple possible skill paths
      const candidates = [
        path.join(app.getAppPath(), "skills", "xlsx", "styles"),
        path.join(process.cwd(), "skills", "xlsx", "styles"),
      ];
      let stylesDir = "";
      for (const c of candidates) {
        if (fs.existsSync(c)) { stylesDir = c; break; }
      }
      if (!stylesDir) return;

      for (const f of fs.readdirSync(stylesDir)) {
        if (!f.endsWith(".json")) continue;
        const styleId = f.replace(/\.json$/, "");
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(stylesDir, f), "utf8"));
          themeCache.set(styleId, {
            name: String(raw.name || styleId),
            headerFill: String(raw.headerFill || DEFAULT_THEME.headerFill),
            headerFont: String(raw.headerFont || DEFAULT_THEME.headerFont),
            headerBorder: String(raw.headerBorder || DEFAULT_THEME.headerBorder),
            zebraFill: String(raw.zebraFill || DEFAULT_THEME.zebraFill),
            borderColor: String(raw.borderColor || DEFAULT_THEME.borderColor),
          });
        } catch { /* Skip invalid files */ }
      }
      console.log(LOG_PREFIX, "Loaded styles:", Array.from(themeCache.keys()).join(", ") || "(none)");
    } catch {
      // Directory does not exist, use default theme
    }
  }

  function getTheme(style?: string): Theme {
    loadThemes();
    if (!style) return themeCache.get("default") ?? DEFAULT_THEME;
    return themeCache.get(style) ?? themeCache.get("default") ?? DEFAULT_THEME;
  }

  /** Convert hex color (#RRGGBB or RRGGBB) to ARGB (FFRRGGBB). */
  function toArgb(color: string): string {
    const c = color.replace("#", "").toUpperCase();
    if (c.length === 8) return c;
    if (c.length === 6) return "FF" + c;
    return "FF1F4E79"; // Fallback
  }

  /**
   * Override theme with custom colors. Each field in colors is an optional ARGB hex value.
   * Model translates natural language color requests into hex.
   */
  function mergeTheme(base: Theme, colors?: {
    headerFill?: string; headerFont?: string; headerBorder?: string;
    zebraFill?: string; borderColor?: string;
  }): Theme {
    if (!colors) return base;
    return {
      name: base.name + " (custom)",
      headerFill: colors.headerFill ? toArgb(colors.headerFill) : base.headerFill,
      headerFont: colors.headerFont ? toArgb(colors.headerFont) : base.headerFont,
      headerBorder: colors.headerBorder ? toArgb(colors.headerBorder) : base.headerBorder,
      zebraFill: colors.zebraFill ? toArgb(colors.zebraFill) : base.zebraFill,
      borderColor: colors.borderColor ? toArgb(colors.borderColor) : base.borderColor,
    };
  }

  // ── write_excel ──────────────────────────────────────
  toolRegistry.register({
    id: "write_excel",
    name: "Create Excel workbook",
    description:
      "Create a polished Excel workbook (.xlsx) with preset themes or custom colors. Includes bold filled headers, " +
      "thin borders, alternating row shading, adaptive column widths, number formatting, a frozen header row, and filters.\n" +
      "Prefer this tool for simple tables, data organization, conversions, and Excel exports instead of invoke_skill(xlsx).\n\n" +
      "Use it when the user wants data organized into a table or exported to Excel. Pass a selected preset through style, " +
      "or translate requested colors into ARGB hex values and pass them through colors.\n\n" +
      "For formulas or editing an existing workbook, consider invoke_skill(xlsx).\n\n" +
      "Available styles: default, dark, colorful, simple-business, and financial. See skills/xlsx/styles/catalog.md. " +
      "filename must end in .xlsx and may include a desktop-relative subdirectory.",
    enabled: true,
    risk: "fs-write",
    inputSchema: {
      type: "object",
      properties: {
        filename: { type: "string", description: "Desktop-relative filename ending in .xlsx; may include a subdirectory such as 'test/report.xlsx'" },
        sheets: {
          type: "array",
          description: "Worksheets to create",
          items: {
            type: "object",
            properties: {
              name:    { type: "string", description: "Worksheet name" },
              headers: { type: "array", description: "Column header strings", items: { type: "string" } },
              rows:    { type: "array", description: "Data rows, with each row represented as an array", items: { type: "string" } },
            },
          },
        },
        style: { type: "string", description: "Preset theme: default / simple-business / dark / colorful / financial" },
        colors: {
          type: "object",
          description: "Optional color overrides in ARGB hex, such as 'FFF8BBD0' for pink or 'FF2D2D2D' for dark gray. Convert the user's color request to hex.",
          properties: {
            headerFill: { type: "string", description: "Header background color in ARGB hex" },
            headerFont: { type: "string", description: "Header text color in ARGB hex" },
            headerBorder: { type: "string", description: "Header bottom-border color in ARGB hex" },
            zebraFill: { type: "string", description: "Alternating-row background color in ARGB hex" },
            borderColor: { type: "string", description: "Border color in ARGB hex" },
          },
        },
      },
      required: ["filename", "sheets"],
    },
    execute: async (args) => {
      const filename = validateFilename(String(args.filename || ""), ".xlsx");
      if (!filename) return "[Error] filename must end in .xlsx";
      const outputPath = resolveOutputPath(filename);
      if (!outputPath) return "[Error] Invalid path; absolute paths and directory traversal are not allowed: " + filename;
      const sheets = args.sheets as Array<{
        name: string; headers: string[]; rows: unknown[][];
      }>;
      if (!Array.isArray(sheets) || sheets.length === 0) {
        return "[Error] sheets must contain at least one worksheet";
      }

      const ExcelJS = await import("exceljs");
      const workbook = new ExcelJS.Workbook();

      // Select theme (preset + custom color overrides)
      const baseTheme = getTheme(args.style ? String(args.style) : undefined);
      const colors = args.colors as {
        headerFill?: string; headerFont?: string; headerBorder?: string;
        zebraFill?: string; borderColor?: string;
      } | undefined;
      const theme = mergeTheme(baseTheme, colors);
      console.log(LOG_PREFIX, "Excel theme:", theme.name, "style=" + (args.style || "default"), colors ? "+custom colors" : "");

      const HEADER_FILL: ExcelFill = { type: "pattern", pattern: "solid", fgColor: { argb: theme.headerFill } };
      const ZEBRA_FILL: ExcelFill = { type: "pattern", pattern: "solid", fgColor: { argb: theme.zebraFill } };
      const THIN_BORDER: Partial<ExcelBorders> = {
        top: { style: "thin", color: { argb: theme.borderColor } },
        left: { style: "thin", color: { argb: theme.borderColor } },
        bottom: { style: "thin", color: { argb: theme.borderColor } },
        right: { style: "thin", color: { argb: theme.borderColor } },
      };
      const HEADER_BOTTOM_BORDER: Partial<ExcelBorders> = {
        ...THIN_BORDER,
        bottom: { style: "medium", color: { argb: theme.headerBorder } },
      };

      for (const s of sheets) {
        const ws = workbook.addWorksheet(s.name || "Sheet1");

        // Write data
        if (Array.isArray(s.headers)) ws.addRow(s.headers);
        for (const row of (s.rows || [])) ws.addRow(row);

        const headers = s.headers || [];
        const dataRowCount = (s.rows?.length || 0);
        const totalRows = dataRowCount + 1; // +1 for header

        // 1. Header style: white bold + dark blue fill + centered + bottom border
        // Set per cell to avoid spilling into empty columns
        const headerRow = ws.getRow(1);
        headerRow.height = 24;
        headerRow.eachCell({ includeEmpty: false }, (cell) => {
          cell.font = { bold: true, color: { argb: theme.headerFont }, size: 11, name: "Calibri" };
          cell.fill = HEADER_FILL;
          cell.alignment = { horizontal: "center", vertical: "middle" };
          cell.border = HEADER_BOTTOM_BORDER;
        });

        // 2. Data rows: thin border + smart number format + zebra striping
        for (let r = 2; r <= totalRows; r++) {
          const row = ws.getRow(r);
          // Zebra striping (even data rows = alternating gray)
          const isZebra = (r - 1) % 2 === 0;
          row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
            cell.border = THIN_BORDER;
            // Zebra striping set per cell
            if (isZebra) {
              cell.fill = ZEBRA_FILL;
            }
            // Smart number format
            if (typeof cell.value === "number") {
              cell.alignment = { horizontal: "right", vertical: "middle" };
              // Infer number format from column header
              const headerText = headers[colNumber - 1] ? String(headers[colNumber - 1]).toLowerCase() : "";
              if (/year|\u5e74/i.test(headerText)) {
                cell.numFmt = "0";              // Year: no thousands separator
              } else if (/%|ratio|rate|[\u7387\u6bd4\u6da8\u8dcc\u5e45]/i.test(headerText)) {
                cell.numFmt = "0.0%";           // Percentage
              } else if (/\$|amount|price|cost|revenue|[\u5143\u4ef7\u989d\u91d1]/i.test(headerText)) {
                cell.numFmt = "#,##0.00";      // Currency with cents
              } else if (Number.isInteger(cell.value) && Math.abs(cell.value) >= 1000) {
                cell.numFmt = "#,##0";          // Large integer: thousands separator without decimals
              } else {
                cell.numFmt = "#,##0.00";       // Default number
              }
            } else if (cell.value instanceof Date) {
              cell.alignment = { horizontal: "center", vertical: "middle" };
              cell.numFmt = "yyyy-mm-dd";
            } else {
              cell.alignment = { horizontal: "left", vertical: "middle" };
            }
          });
        }

        // 3. Auto-fit column widths
        ws.columns.forEach((col, i) => {
          let maxLen = headers[i] ? Array.from(String(headers[i])).reduce((sum, ch) => sum + (ch.charCodeAt(0) > 127 ? 2 : 1), 0) + 4 : 8;
          for (const row of (s.rows || [])) {
            const val = row[i];
            if (val !== undefined && val !== null) {
              const len = Array.from(String(val)).reduce((sum, ch) => sum + (ch.charCodeAt(0) > 127 ? 2 : 1), 0);
              if (len + 2 > maxLen) maxLen = len + 2;
            }
          }
          col.width = Math.min(Math.max(maxLen, 10), 45);
        });

        // 4. Freeze header row
        ws.views = [{ state: "frozen", ySplit: 1 }];

        // 5. Auto-filter on header row
        if (headers.length > 0 && dataRowCount > 0) {
          ws.autoFilter = {
            from: { row: 1, column: 1 },
            to: { row: totalRows, column: headers.length },
          };
        }
      }

      // Create parent directory automatically
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      await workbook.xlsx.writeFile(outputPath);
      console.log(LOG_PREFIX, "Excel workbook created:", outputPath);
      return `[write_excel] Created: ${outputPath}`;
    },
  });

  // ── write_word ───────────────────────────────────────
  toolRegistry.register({
    id: "write_word",
    name: "Create Word document",
    description:
      "Create a polished Word document (.docx) using a preset theme. Includes styled titles, body typography, line spacing, and paragraph spacing.\n\n" +
      "Use it for reports, summaries, proposals, letters, and Word exports. Pass a style selected through ask_user_choice.\n" +
      "Use write_excel for tabular data and write_markdown for lightweight notes. For complex layouts with headers, footers, tables of contents, images, or tables, consider invoke_skill(docx).\n\n" +
      "Available styles: default, academic, clean, elegant, and formal. See skills/docx/styles/catalog.md. " +
      "Pass a desktop-relative .docx filename, title, paragraph strings, and an optional style.",
    enabled: true,
    risk: "fs-write",
    inputSchema: {
      type: "object",
      properties: {
        filename:   { type: "string", description: "Desktop-relative filename ending in .docx; do not pass an absolute path" },
        title:      { type: "string", description: "Document title" },
        paragraphs: { type: "array", description: "Paragraph strings", items: { type: "string" } },
        style:      { type: "string", description: "Preset style: default / academic / clean / elegant / formal" },
      },
      required: ["filename", "title", "paragraphs"],
    },
    execute: async (args) => {
      const filename = validateFilename(String(args.filename || ""), ".docx");
      if (!filename) return "[Error] filename must end in .docx";
      const outputPath = resolveOutputPath(filename);
      if (!outputPath) return "[Error] Invalid path; absolute paths and directory traversal are not allowed: " + filename;

      // Load style
      const styles = loadStylesDir("docx");
      const styleId = args.style ? String(args.style) : "default";
      const theme = (styles[styleId] ?? styles["default"]) as {
        name?: string; titleColor?: string; titleSize?: number; titleFont?: string;
        bodyFont?: string; bodySize?: number; bodyColor?: string; lineSpacing?: number; headingColor?: string;
      } | undefined;

      const titleColor = toHexColor(theme?.titleColor ?? "FF1F4E79");
      const titleSize = theme?.titleSize ?? 28;
      const titleFont = theme?.titleFont ?? "Microsoft YaHei";
      const bodyFont = theme?.bodyFont ?? "Microsoft YaHei";
      const bodySize = theme?.bodySize ?? 24;
      const bodyColor = toHexColor(theme?.bodyColor ?? "FF333333");
      const lineSpacing = theme?.lineSpacing ?? 360;
      const headingColor = toHexColor(theme?.headingColor ?? "FF1F4E79");

      console.log(LOG_PREFIX, "Word theme:", theme?.name ?? "Default business", "style=" + styleId);

      const { Document, Packer, Paragraph, HeadingLevel, TextRun } = await import("docx");
      const doc = new Document({
        styles: {
          default: {
            document: {
              run: { font: bodyFont, size: bodySize, color: bodyColor },
              paragraph: { spacing: { line: lineSpacing } },
            },
          },
        },
        sections: [{
          children: [
            new Paragraph({
              text: String(args.title || ""),
              heading: HeadingLevel.HEADING_1,
              run: { font: titleFont, size: titleSize, bold: true, color: titleColor },
              spacing: { after: 200, line: lineSpacing },
            }),
            ...((args.paragraphs as string[]) || []).map(p =>
              new Paragraph({
                children: [new TextRun({ text: p, font: bodyFont, size: bodySize, color: bodyColor })],
                spacing: { line: lineSpacing, after: 120 },
              })
            ),
          ],
        }],
      });

      const buffer = await Packer.toBuffer(doc);
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(outputPath, buffer);
      console.log(LOG_PREFIX, "Word document created:", outputPath);
      return `[write_word] Created: ${outputPath}`;
    },
  });

  // ── write_pdf ────────────────────────────────────────
  toolRegistry.register({
    id: "write_pdf",
    name: "Create PDF",
    description:
      "Create a PDF on the desktop. Use it for formal documents such as contracts, resumes, applications, or PDF exports. " +
      "Use write_word when the document must remain editable and write_excel for tabular data. " +
      "Pass a .pdf filename, title, and paragraph strings.",
    enabled: true,
    risk: "fs-write",
    inputSchema: {
      type: "object",
      properties: {
        filename:   { type: "string", description: "Desktop-relative filename ending in .pdf" },
        title:      { type: "string", description: "Document title" },
        paragraphs: { type: "array", description: "Paragraph strings", items: { type: "string" } },
      },
      required: ["filename", "title", "paragraphs"],
    },
    execute: async (args) => {
      const filename = validateFilename(String(args.filename || ""), ".pdf");
      if (!filename) return "[Error] filename must end in .pdf";
      const outputPath = resolveOutputPath(filename);
      if (!outputPath) return "[Error] Invalid path; absolute paths and directory traversal are not allowed: " + filename;

      const PDFKit = await import("pdfkit");
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const doc = new PDFKit.default();
      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);

      // Font fallback: Windows uses msyh.ttc or standard fonts
      const fontCandidates = [
        "C:\\Windows\\Fonts\\msyh.ttc",
        "C:\\Windows\\Fonts\\simsun.ttc",
        "C:\\Windows\\Fonts\\simhei.ttf",
      ];
      for (const f of fontCandidates) {
        if (fs.existsSync(f)) { doc.font(f); break; }
      }

      doc.fontSize(22).text(String(args.title || ""), { align: "center" });
      doc.moveDown();
      doc.fontSize(12);
      for (const p of (args.paragraphs as string[]) || []) {
        doc.text(p, { align: "left" });
        doc.moveDown(0.5);
      }
      doc.end();

      await new Promise<void>((resolve, reject) => {
        stream.on("finish", () => resolve());
        stream.on("error", reject);
      });
      console.log(LOG_PREFIX, "PDF created:", outputPath);
      return `[write_pdf] Created: ${outputPath}`;
    },
  });

  // ── write_markdown ───────────────────────────────────
  toolRegistry.register({
    id: "write_markdown",
    name: "Create Markdown file",
    description:
      "Create a Markdown file (.md) on the desktop. Use it for notes, documentation, and lightweight text output. " +
      "Use write_word or write_pdf for formal documents and write_excel for tabular data. " +
      "Pass a .md filename and Markdown content.",
    enabled: true,
    risk: "fs-write",
    inputSchema: {
      type: "object",
      properties: {
        filename: { type: "string", description: "Desktop-relative filename ending in .md" },
        content:  { type: "string", description: "Markdown content" },
      },
      required: ["filename", "content"],
    },
    execute: async (args) => {
      const filename = validateFilename(String(args.filename || ""), ".md");
      if (!filename) return "[Error] filename must end in .md";
      const outputPath = resolveOutputPath(filename);
      if (!outputPath) return "[Error] Invalid path; absolute paths and directory traversal are not allowed: " + filename;

      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(outputPath, String(args.content || ""), "utf8");
      console.log(LOG_PREFIX, "Markdown file created:", outputPath);
      return `[write_markdown] Created: ${outputPath}`;
    },
  });
}
