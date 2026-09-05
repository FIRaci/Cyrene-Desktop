// Lifestyle tools: expense tracking / exchange rate / translation / code patch.
//
// Design principles:
// - Single responsibility per tool
// - Explicitly document use cases and anti-use cases in descriptions
// - Expense tracking uses local JSON storage, independent of external services
// - Exchange rates use keyless frankfurter.app API
// - Translation reuses main LLM model
// - apply_patch performs exact string replacement requiring unique old_string

import * as fs from "fs";
import * as path from "path";
import { app } from "electron";
import { toolRegistry } from "./tool-registry";
import { currentUserTimezone } from "./built-in-tools";
import { isModelEndpointUsable, modelAuthorizationHeaders } from "../../shared/model-endpoint";

const LOG_PREFIX = "[LifeTools]";

// ══════════════════════════════════════════════════════════
// Expense tracking
// ══════════════════════════════════════════════════════════

interface ExpenseRecord {
  ts: number;
  amount: number;
  category: string;
  note: string;
}

function expenseFile(): string {
  return path.join(app.getPath("userData"), "expenses.json");
}

function loadExpenses(): ExpenseRecord[] {
  try {
    return JSON.parse(fs.readFileSync(expenseFile(), "utf8"));
  } catch {
    return [];
  }
}

function saveExpenses(records: ExpenseRecord[]): void {
  fs.writeFileSync(expenseFile(), JSON.stringify(records, null, 2), "utf8");
}

function registerExpenseTools(): void {
  toolRegistry.register({
    id: "record_expense",
    name: "Record expense",
    description:
      "Record one expense.\n\n" +
      "Use when the user asks to record a purchase or provides an amount and purpose.\n" +
      "Do not use to review expenses (use query_expense) or record income, which is not supported.\n\n" +
      "Parameters: amount (positive number), category (such as food, transport, shopping, entertainment, household, or other), and note.",
    enabled: true,
    risk: "safe",
    inputSchema: {
      type: "object",
      properties: {
        amount:   { type: "number", description: "Expense amount" },
        category: { type: "string", description: "Expense category, such as food, transport, shopping, entertainment, household, or other" },
        note:     { type: "string", description: "Optional note describing the expense" },
      },
      required: ["amount"],
    },
    execute: async (args) => {
      const amount = Number(args.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return "[Error] amount must be a positive number";
      }
      const records = loadExpenses();
      const rec: ExpenseRecord = {
        ts: Date.now(),
        amount,
        category: String(args.category || "Other"),
        note: String(args.note || ""),
      };
      records.push(rec);
      saveExpenses(records);
      console.log(LOG_PREFIX, "record_expense:", rec);
      return `[record_expense] Recorded: ${amount} / ${rec.category} / ${rec.note}`;
    },
  });

  toolRegistry.register({
    id: "query_expense",
    name: "Query expenses",
    description:
      "Query recorded expenses and optionally summarize or filter them.\n\n" +
      "Use when the user asks for recent expenses, spending details, or a spending summary. " +
      "Do not use to add an expense; use record_expense instead.\n\n" +
      "Parameters: days (lookback window, default 30), category (optional exact category filter), and summary (return totals only when true).",
    enabled: true,
    risk: "safe",
    inputSchema: {
      type: "object",
      properties: {
        days:     { type: "number", description: "Number of recent days to query; defaults to 30" },
        category: { type: "string", description: "Optional exact category filter" },
        summary:  { type: "boolean", description: "When true, return only aggregate totals" },
      },
    },
    execute: async (args) => {
      const days = Number(args.days) || 30;
      const cutoff = Date.now() - days * 86400_000;
      let records = loadExpenses().filter(r => r.ts >= cutoff);
      if (args.category) {
        records = records.filter(r => r.category === args.category);
      }
      if (records.length === 0) {
        return `[query_expense] No expenses recorded in the last ${days} days`;
      }
      if (args.summary) {
        const total = records.reduce((s, r) => s + r.amount, 0);
        const byCat: Record<string, number> = {};
        for (const r of records) {
          byCat[r.category] = (byCat[r.category] || 0) + r.amount;
        }
        return `[query_expense] ${records.length} expense(s) in the last ${days} days; total: ${total.toFixed(2)}\nBy category: ${JSON.stringify(byCat)}`;
      }
      const lines = records.map(r => {
        const d = new Date(r.ts).toLocaleDateString("en-CA", { timeZone: currentUserTimezone() });
        return `${d} ${r.amount} ${r.category} ${r.note}`;
      });
      return `[query_expense] ${records.length} expense(s) in the last ${days} days:\n${lines.join("\n")}`;
    },
  });
}

// ══════════════════════════════════════════════════════════
// Exchange rate
// ══════════════════════════════════════════════════════════

function registerExchangeRateTool(): void {
  toolRegistry.register({
    id: "exchange_rate",
    name: "Exchange rate",
    description:
      "Convert an amount using the latest available fiat-currency exchange rate. " +
      "Do not use for cryptocurrency or historical rates.\n\n" +
      "Parameters: from (source ISO currency code), to (target ISO currency code), and amount (defaults to 1).",
    enabled: true,
    risk: "network",
    inputSchema: {
      type: "object",
      properties: {
        from:   { type: "string", description: "Source currency code, such as USD, EUR, JPY, or CNY" },
        to:     { type: "string", description: "Target currency code" },
        amount: { type: "number", description: "Amount to convert; defaults to 1" },
      },
      required: ["from", "to"],
    },
    execute: async (args) => {
      const from = String(args.from || "USD").toUpperCase();
      const to = String(args.to || "CNY").toUpperCase();
      const amount = Number(args.amount) || 1;
      if (from === to) {
        return `[exchange_rate] ${amount} ${from} = ${amount} ${to} (same currency)`;
      }
      // frankfurter.app: keyless, supports major currencies
      const url = `https://api.frankfurter.app/latest?from=${from}&to=${to}`;
      const resp = await fetch(url);
      if (!resp.ok) {
        return `[Error] Exchange-rate request failed: HTTP ${resp.status}`;
      }
      const data = await resp.json() as { rates?: Record<string, number> };
      const rate = data.rates?.[to];
      if (!rate) {
        return `[exchange_rate] No rate found for ${from} → ${to}; one of the currencies may be unsupported`;
      }
      const result = (amount * rate).toFixed(2);
      return `[exchange_rate] ${amount} ${from} = ${result} ${to} (rate ${rate}, updated ${new Date().toLocaleDateString("en-CA", { timeZone: currentUserTimezone() })})`;
    },
  });
}

// ══════════════════════════════════════════════════════════
// Translation
// ══════════════════════════════════════════════════════════

// Translation requires main model, injected by index.ts
let modelSettingsGetter: (() => { provider: string; baseUrl: string; model: string; apiKey: string } | null) | null = null;

/** Injected model settings reader on startup. */
export function setTranslateConfig(getter: () => { provider: string; baseUrl: string; model: string; apiKey: string } | null): void {
  modelSettingsGetter = getter;
}

function registerTranslateTool(): void {
  toolRegistry.register({
    id: "translate",
    name: "Translate",
    description:
      "Translate text into a requested language. Use for explicit translation requests or foreign-language meaning questions. " +
      "For long documents, translate in smaller sections.\n\n" +
      "Parameters: text (source text), to (target language, such as English, Chinese, or Japanese), and from (optional source language; auto-detected by default).",
    enabled: true,
    risk: "network",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to translate" },
        to:   { type: "string", description: "Target language, such as English, Chinese, or Japanese" },
        from: { type: "string", description: "Optional source language; auto-detected when omitted" },
      },
      required: ["text", "to"],
    },
    execute: async (args) => {
      const text = String(args.text || "");
      const to = String(args.to || "");
      if (!text || !to) return "[Error] text and to are required";

      const settings = modelSettingsGetter?.();
      if (!settings || !isModelEndpointUsable(settings)) {
        return "[Error] Translation is unavailable because no model is configured";
      }

      // Dynamic import to avoid circular dependency
      const { buildVendorUrlByProvider } = await import("./vendors");
      const fromHint = args.from ? ` The source language is ${String(args.from)}.` : " Detect the source language automatically.";
      const sysPrompt = `You are a translation engine.${fromHint} Translate the following text into ${to}. Return only the translation, with no explanation or additional text.`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30000);
      try {
        const resp = await fetch(buildVendorUrlByProvider(settings.provider, settings.baseUrl), {
          method: "POST",
          signal: ctrl.signal,
          headers: {
            "Content-Type": "application/json",
            ...modelAuthorizationHeaders(settings),
          },
          body: JSON.stringify({
            model: settings.model,
            messages: [
              { role: "system", content: sysPrompt },
              { role: "user", content: text },
            ],
            max_tokens: 2000,
            stream: false,
          }),
        });
        if (!resp.ok) return `[Error] Translation request failed: HTTP ${resp.status}`;
        const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
        const result = data.choices?.[0]?.message?.content?.trim() || "";
        if (!result) return "[Error] The translation response was empty";
        return `[translate] ${result}`;
      } catch (e) {
        return "[Error] Translation failed: " + (e instanceof Error ? e.message : String(e));
      } finally {
        clearTimeout(timer);
      }
    },
  });
}

// ══════════════════════════════════════════════════════════
// Code patch
// ══════════════════════════════════════════════════════════

function registerApplyPatchTool(): void {
  toolRegistry.register({
    id: "apply_patch",
    name: "Apply code patch",
    description:
      "Apply one exact string replacement to an existing file. Use for a precise, localized edit. " +
      "Use write_file for new files or complete rewrites.\n\n" +
      "Parameters: file_path, old_string (an exact match including whitespace), and new_string. " +
      "old_string must occur exactly once; include more surrounding context if it is ambiguous.",
    enabled: true,
    risk: "fs-write",
    inputSchema: {
      type: "object",
      properties: {
        file_path:   { type: "string", description: "Absolute path of the file to update" },
        old_string:  { type: "string", description: "Exact text to replace, including indentation" },
        new_string:  { type: "string", description: "Replacement text" },
      },
      required: ["file_path", "old_string", "new_string"],
    },
    execute: async (args) => {
      const filePath = String(args.file_path || "");
      if (!filePath) return "[Error] file_path is required";
      if (!fs.existsSync(filePath)) return `[Error] File not found: ${filePath}`;

      const content = fs.readFileSync(filePath, "utf8");
      const oldStr = String(args.old_string ?? "");
      const newStr = String(args.new_string ?? "");
      if (!oldStr) return "[Error] old_string is required";

      const count = content.split(oldStr).length - 1;
      if (count === 0) {
        return "[Error] old_string was not found. Verify the exact content, including indentation and line breaks.";
      }
      if (count > 1) {
        return `[Error] old_string matched ${count} locations. Include more context so the match is unique.`;
      }

      const newContent = content.replace(oldStr, newStr);
      fs.writeFileSync(filePath, newContent, "utf8");
      console.log(LOG_PREFIX, "apply_patch:", filePath);
      return `[apply_patch] Updated ${filePath}`;
    },
  });
}

/** Register all life tools on startup. */
export function registerLifeTools(): void {
  registerExpenseTools();
  registerExchangeRateTool();
  registerTranslateTool();
  registerApplyPatchTool();
  console.log(LOG_PREFIX, "Registered: record_expense / query_expense / exchange_rate / translate / apply_patch");
}
