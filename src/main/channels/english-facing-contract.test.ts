import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const CHANNEL_ROOT = path.resolve(__dirname);
const HAN = /[\u3400-\u9fff\uf900-\ufaff]/u;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(fullPath);
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) return [];
    return [fullPath];
  });
}

function runtimeLiterals(filePath: string): Array<{ text: string; line: number; kind: ts.SyntaxKind }> {
  const source = fs.readFileSync(filePath, "utf8");
  const tree = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const found: Array<{ text: string; line: number; kind: ts.SyntaxKind }> = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node)
      || ts.isNoSubstitutionTemplateLiteral(node)
      || ts.isTemplateHead(node)
      || ts.isTemplateMiddle(node)
      || ts.isTemplateTail(node)
      || ts.isRegularExpressionLiteral(node)
    ) {
      const text = node.getText(tree);
      if (HAN.test(text)) {
        found.push({ text, line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1, kind: node.kind });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

describe("channel English-facing contract", () => {
  it("keeps reachable runtime strings English except isolated compatibility data", () => {
    const violations: string[] = [];
    for (const filePath of sourceFiles(CHANNEL_ROOT)) {
      for (const literal of runtimeLiterals(filePath)) {
        const relative = path.relative(CHANNEL_ROOT, filePath).replaceAll("\\", "/");
        const isChineseSaveIntentCompatibility = relative === "adapters/wechat/inbound-media.ts"
          && literal.kind === ts.SyntaxKind.RegularExpressionLiteral
          && literal.text.includes("保存到桌面");
        const isStableLegacyInboxPath = relative === "adapters/wechat/ilink-bot-adapter.ts"
          && literal.text === '"Cyrene 收件箱"';
        if (!isChineseSaveIntentCompatibility && !isStableLegacyInboxPath) {
          violations.push(`${relative}:${literal.line}: ${literal.text}`);
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });
});
