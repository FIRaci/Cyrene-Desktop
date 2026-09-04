import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const HAN = /[\u3400-\u9fff\uf900-\ufaff]/u;
const RUNTIME_FILES = [
  "src/renderer/chat/markdown/code-highlighter.ts",
  "src/renderer/chat/markdown/language-normalizer.ts",
  "src/renderer/chat/markdown/markdown-renderer.ts",
  "src/renderer/chat/markdown/streaming-markdown-session.ts",
  "src/renderer/chat/markdown/streaming-render-scheduler.ts",
  "src/renderer/chat/markdown/code-block-controller.ts",
  "src/renderer/chat/markdown/streaming-block-renderer.ts",
  "src/shared/chat-context.ts",
  "src/shared/chat-ui.ts",
  "src/shared/ui-icon.ts",
];

function runtimeStringViolations(relativePath: string): string[] {
  const filePath = path.join(ROOT, relativePath);
  const source = fs.readFileSync(filePath, "utf8");
  const tree = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const violations: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node)
      || ts.isNoSubstitutionTemplateLiteral(node)
      || ts.isTemplateHead(node)
      || ts.isTemplateMiddle(node)
      || ts.isTemplateTail(node)
    ) {
      const text = node.getText(tree);
      if (HAN.test(text)) {
        const line = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
        violations.push(`${relativePath}:${line}: ${text}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return violations;
}

describe("renderer and shared English runtime contract", () => {
  it("keeps reachable Markdown UI labels, fallbacks, and diagnostics English", () => {
    const violations = RUNTIME_FILES.flatMap(runtimeStringViolations);
    expect(violations, violations.join("\n")).toEqual([]);
  });
});
