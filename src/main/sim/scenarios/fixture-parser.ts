// Sim fixture parser (minimal version for behavior testing)
import type { WorldbookEntry } from "../../rag/worldbook";

export function parseFixtureMarkdown(content: string, fileName: string): WorldbookEntry[] {
  const entries: WorldbookEntry[] = [];
  const blocks = content.split(/^---$/m);

  for (const block of blocks) {
    const lines = block.split("\n");
    let title = "";
    const meta: Record<string, string> = {};
    let inMeta = true;
    const contentLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (title === "" && trimmed.startsWith("## ")) {
        title = trimmed.replace(/^## /, "").trim();
        continue;
      }
      if (inMeta && trimmed.startsWith("- ")) {
        const m = trimmed.match(/^- ([^:：]+)[：:]\s*(.*)$/);
        if (m) meta[m[1].trim()] = m[2].trim();
        continue;
      }
      if (inMeta && trimmed === "") {
        if (title !== "" && Object.keys(meta).length > 0) {
          inMeta = false;
        }
        continue;
      }
      if (!inMeta) {
        contentLines.push(line);
      }
    }

    if (!title || contentLines.join("").trim() === "") continue;
    const keywords = (meta["keywords"] ?? meta["Keywords"] ?? meta["\u89e6\u53d1\u8bcd"] ?? "")
      .split(/[,，、]/)
      .map((k) => k.trim())
      .filter(Boolean);
    const intrinsicValue = parseFloat(
      meta["intrinsic_value"] ?? meta["intrinsicValue"] ?? meta["Intrinsic Value"] ??
      meta["\u5185\u5728\u4ef7\u503c"] ?? meta["\u521d\u59cb\u5206"] ?? meta["initial_score"] ?? "60"
    ) || 60;
    const priority = parseInt(
      meta["priority"] ?? meta["Priority"] ?? meta["\u4f18\u5148\u7ea7"] ?? "5"
    ) || 5;
    const permanent = ["\u662f", "yes", "true"].includes((meta["permanent"] ?? meta["Permanent"] ?? meta["\u5e38\u9a7b"] ?? "").toLowerCase());

    entries.push({
      id: `wb_${fileName}_${title.replace(/\s+/g, "_")}`,
      keywords,
      content: contentLines.join("\n").trim(),
      priority,
      permanent,
      enabled: true,
      intrinsicValue,
      linkTriggers: [],
    });
  }

  return entries;
}
