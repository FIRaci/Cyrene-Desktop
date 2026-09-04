// 文档生成工具 —— 让昔涟能产出可交付物（Excel/Word/PDF/Markdown）。
//
// 设计要点：
// - 所有文档默认存到桌面（app.getPath("desktop")），用户最容易找到
// - 支持桌面子目录（如 "test/report.xlsx"），自动创建父目录
// - 文件名由模型给，强制校验扩展名（防 .exe 等危险后缀）
// - 返回完整路径给模型，模型可以转述给用户
// - PDF 中文字体走系统微软雅黑（Windows），找不到就降级

import * as fs from "fs";
import * as path from "path";
import { app } from "electron";
import { toolRegistry } from "./tool-registry";

const LOG_PREFIX = "[DocTools]";

/** 校验文件名：必须有合法扩展名，不能有危险字符。 */
function validateFilename(filename: string, ext: string): string | null {
  if (!filename || typeof filename !== "string") return null;
  if (!filename.toLowerCase().endsWith(ext)) return null;
  // 防危险字符
  if (/[<>:"|?*]/.test(filename)) return null;
  return filename;
}

/**
 * 解析输出路径：filename 可含子目录（如 "test/report.xlsx"），根始终是桌面。
 * 安全校验：禁止 .. 穿越、禁止绝对路径（不能写到桌面之外）。
 * 返回绝对路径，或 null 表示校验失败。
 */
function resolveOutputPath(filename: string): string | null {
  const normalized = path.normalize(filename).replace(/\\/g, "/");
  // 禁止目录穿越和绝对路径
  if (normalized.includes("..") || path.isAbsolute(normalized)) return null;
  const desktop = app.getPath("desktop");
  const fullPath = path.join(desktop, normalized);
  // 最终校验：解析后必须仍在桌面下
  if (!fullPath.startsWith(desktop)) return null;
  return fullPath;
}

/** 桌面路径（旧接口，保持兼容）。 */
function desktopPath(filename: string): string {
  return path.join(app.getPath("desktop"), filename);
}

// ── 样式加载器（Excel + Word 共用）──
// 从 skills/{skillId}/styles/ 目录加载 json 风格文件，带缓存。
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
      } catch { /* 跳过坏文件 */ }
    }
    console.log(LOG_PREFIX, `Loaded ${skillId} styles:`, Object.keys(cache).join(", ") || "(none)");
  } catch { /* 目录不存在 */ }
  styleCache.set(skillId, cache);
  return cache;
}

/** 把 hex 颜色转成 ARGB（FF 前缀），docx 库用 6 位 RRGGBB 不带 FF 前缀。 */
function toHexColor(color: string): string {
  const c = color.replace("#", "").toUpperCase();
  if (c.length === 8) return c.slice(2);  // FFRRGGBB → RRGGBB
  if (c.length === 6) return c;
  return "1F4E79"; // 兜底
}

export function registerDocumentTools(): void {
  // ── 样式系统 ──
  // 从 skills/xlsx/styles/ 目录加载预设风格 json，取代硬编码。
  // 模型弹卡片前读 catalog.md 选风格，用户选完传 style 名给 write_excel。
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

  /** 从 skills/xlsx/styles/ 加载所有风格 json（带缓存）。 */
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
      // 尝试多个可能的 skill 路径
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
        } catch { /* 跳过坏文件 */ }
      }
      console.log(LOG_PREFIX, "Loaded styles:", Array.from(themeCache.keys()).join(", ") || "(none)");
    } catch {
      // 目录不存在，用默认主题
    }
  }

  function getTheme(style?: string): Theme {
    loadThemes();
    if (!style) return themeCache.get("default") ?? DEFAULT_THEME;
    return themeCache.get(style) ?? themeCache.get("default") ?? DEFAULT_THEME;
  }

  /** 把 hex 颜色 (#RRGGBB 或 RRGGBB) 转成 ARGB (FFRRGGBB)，已含 FF 前缀则原样返回。 */
  function toArgb(color: string): string {
    const c = color.replace("#", "").toUpperCase();
    if (c.length === 8) return c;
    if (c.length === 6) return "FF" + c;
    return "FF1F4E79"; // 兜底
  }

  /**
   * 用自定义颜色覆盖主题。colors 里每个字段是可选的 ARGB hex 值。
   * 模型能把用户自然语言（"粉色""深灰"）翻译成 hex 后传进来。
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

      // 选主题（预设 + 自定义颜色覆盖）
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

        // 写入数据
        if (Array.isArray(s.headers)) ws.addRow(s.headers);
        for (const row of (s.rows || [])) ws.addRow(row);

        const headers = s.headers || [];
        const dataRowCount = (s.rows?.length || 0);
        const totalRows = dataRowCount + 1; // +1 for header

        // 1. 表头样式：白粗体字 + 深蓝填充 + 居中 + 底部粗线
        // 逐 cell 设置（行级 fill/font/alignment 会铺到无值的空列，导致表头蓝条超出实际列数）
        const headerRow = ws.getRow(1);
        headerRow.height = 24;
        headerRow.eachCell({ includeEmpty: false }, (cell) => {
          cell.font = { bold: true, color: { argb: theme.headerFont }, size: 11, name: "Calibri" };
          cell.fill = HEADER_FILL;
          cell.alignment = { horizontal: "center", vertical: "middle" };
          cell.border = HEADER_BOTTOM_BORDER;
        });

        // 2. 数据行：全表细边框 + 智能数字格式 + 斑马纹
        for (let r = 2; r <= totalRows; r++) {
          const row = ws.getRow(r);
          // 斑马纹（偶数数据行 = Excel 标准交替灰）
          const isZebra = (r - 1) % 2 === 0;
          row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
            cell.border = THIN_BORDER;
            // 斑马纹需逐 cell 设（行级 fill 会被 eachCell 的 cell 对象覆盖）
            if (isZebra) {
              cell.fill = ZEBRA_FILL;
            }
            // 智能数字格式（参考 minimax skill format.md 的格式矩阵）
            if (typeof cell.value === "number") {
              cell.alignment = { horizontal: "right", vertical: "middle" };
              // 按列内容推断数字格式
              const headerText = headers[colNumber - 1] ? String(headers[colNumber - 1]).toLowerCase() : "";
              if (/年|year/.test(headerText)) {
                cell.numFmt = "0";              // 年份：无千位分隔（2024 不是 2,024）
              } else if (/%|率|比|ratio|rate|涨|跌|幅/.test(headerText)) {
                cell.numFmt = "0.0%";           // 百分比
              } else if (/\$|元|价|额|金|amount|price|cost|revenue/.test(headerText)) {
                cell.numFmt = "#,##0.00";      // 货币：带分
              } else if (Number.isInteger(cell.value) && Math.abs(cell.value) >= 1000) {
                cell.numFmt = "#,##0";          // 大整数：千位分隔无小数
              } else {
                cell.numFmt = "#,##0.00";       // 默认数字
              }
            } else if (cell.value instanceof Date) {
              cell.alignment = { horizontal: "center", vertical: "middle" };
              cell.numFmt = "yyyy-mm-dd";
            } else {
              cell.alignment = { horizontal: "left", vertical: "middle" };
            }
          });
        }

        // 3. 列宽自适应：按表头 + 数据行中最大宽度计算（中文按 2 宽度估算）
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

        // 4. 冻结首行
        ws.views = [{ state: "frozen", ySplit: 1 }];

        // 5. 自动筛选：表头行加 filter（方便用户筛选排序）
        if (headers.length > 0 && dataRowCount > 0) {
          ws.autoFilter = {
            from: { row: 1, column: 1 },
            to: { row: totalRows, column: headers.length },
          };
        }
      }

      // 自动创建父目录（支持子目录写入）
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

      // 加载风格
      const styles = loadStylesDir("docx");
      const styleId = args.style ? String(args.style) : "default";
      const theme = (styles[styleId] ?? styles["default"]) as {
        name?: string; titleColor?: string; titleSize?: number; titleFont?: string;
        bodyFont?: string; bodySize?: number; bodyColor?: string; lineSpacing?: number; headingColor?: string;
      } | undefined;

      const titleColor = toHexColor(theme?.titleColor ?? "FF1F4E79");
      const titleSize = theme?.titleSize ?? 28;
      const titleFont = theme?.titleFont ?? "微软雅黑";
      const bodyFont = theme?.bodyFont ?? "微软雅黑";
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

      // 中文字体：Windows 用微软雅黑，找不到则用默认（中文会乱码但能生成）
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
