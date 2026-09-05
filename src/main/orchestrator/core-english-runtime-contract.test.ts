import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const HAN = /[\u3400-\u9fff\uf900-\ufaff]/u;
const FILES = ["build-options.ts", "environment.ts", "context-manager.ts", "cyrene-agent.ts"];
const LEGACY_CONTEXT_MARKERS = new Set([
  "\u3010\u672c\u8f6e\u6587\u4ef6\u3011", "\u3010\u6587\u6863\u5185\u5bb9\u3011", "\u3010\u56fe\u7247\u89c6\u89c9\u4fe1\u606f\u3011", "\u3010\u56fe\u7247\u9644\u4ef6\u3011",
  "\n\n\u3010\u672c\u8f6e\u6587\u4ef6\u3011", "\n\n\u3010\u6587\u6863\u5185\u5bb9\u3011", "\n\n\u3010\u56fe\u7247\u89c6\u89c9\u4fe1\u606f\u3011", "\n\n\u3010\u56fe\u7247\u9644\u4ef6\u3011",
]);

describe("core orchestrator English runtime contract", () => {
  it("keeps generated runtime and model-facing strings English", () => {
    const violations: string[] = [];
    for (const relative of FILES) {
      const file = path.join(__dirname, relative);
      const source = fs.readFileSync(file, "utf8");
      const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node): void => {
        if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
          const text = node.text;
          const isLegacyInputAlias = relative === "build-options.ts" && LEGACY_CONTEXT_MARKERS.has(text);
          const isCanonicalFeelingKey = relative === "build-options.ts" && text === "\u5e73\u9759";
          if (HAN.test(text) && !isLegacyInputAlias && !isCanonicalFeelingKey) {
            const line = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
            violations.push(`${relative}:${line}: ${JSON.stringify(text)}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(tree);
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });
});
