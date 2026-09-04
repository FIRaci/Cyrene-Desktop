import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const HAN = /[\u3400-\u9fff\uf900-\ufaff]/u;
const FILES = ["build-options.ts", "environment.ts", "context-manager.ts", "cyrene-agent.ts"];
const LEGACY_CONTEXT_MARKERS = new Set([
  "【本轮文件】", "【文档内容】", "【图片视觉信息】", "【图片附件】",
  "\n\n【本轮文件】", "\n\n【文档内容】", "\n\n【图片视觉信息】", "\n\n【图片附件】",
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
          const isCanonicalFeelingKey = relative === "build-options.ts" && text === "平静";
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
