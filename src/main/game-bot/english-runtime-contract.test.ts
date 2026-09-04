import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const runtimeFiles = [
  "engine.ts",
  "index.ts",
  "input.ts",
  "script-parser.ts",
  "vlm-locator.ts",
];

function removeComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("game-bot English runtime boundary", () => {
  it.each(runtimeFiles)("keeps reachable app/model text in %s English", (file) => {
    const source = readFileSync(resolve(__dirname, file), "utf8");
    expect(removeComments(source)).not.toMatch(/[\u3400-\u9fff]/u);
  });
});
