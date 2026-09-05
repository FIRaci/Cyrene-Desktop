import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (fileName: string): string =>
  fs.readFileSync(path.join(process.cwd(), "src", "main", "orchestrator", fileName), "utf8");

describe("function-calling English model boundary", () => {
  it("uses English fallback, tool failure, permission, and final-response messages", () => {
    const source = read("function-calling.ts");

    expect(source).toContain("Sorry, the task was interrupted before it could finish.");
    expect(source).toContain("[Error] Tool is unavailable:");
    expect(source).toContain("[Denied]");
    expect(source).toContain("[Tool execution failed]");
    expect(source).toContain("Provide the final response using all tool results above.");
    expect(source).not.toContain('output = "[\u9519\u8bef]');
    expect(source).not.toContain('output = "[\u5df2\u62d2\u7edd]');
    expect(source).not.toContain('output = "[\u5de5\u5177\u6267\u884c\u5931\u8d25]');
  });
});

describe("recall-history English model boundary", () => {
  it("keeps its public tool contract and result labels in English", () => {
    const source = read("history-tools.ts");

    expect(source).toContain('name: "Recall conversation history"');
    expect(source).toContain('return "[Error] query is required"');
    expect(source).toContain("[recall_history] Search failed:");
    expect(source).toContain("No conversation history found");
    expect(source).toContain('const role = h.metadata?.role === "user" ? "User" : "Cyrene"');
    expect(source).toContain("Found ${sorted.length} relevant conversation entries");
    expect(source).not.toContain('name: "\u56de\u5fc6\u5386\u53f2"');
    expect(source).not.toContain('toLocaleString("zh-CN"');
  });
});
