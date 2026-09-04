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
    expect(source).not.toContain('output = "[错误]');
    expect(source).not.toContain('output = "[已拒绝]');
    expect(source).not.toContain('output = "[工具执行失败]');
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
    expect(source).not.toContain('name: "回忆历史"');
    expect(source).not.toContain('toLocaleString("zh-CN"');
  });
});
