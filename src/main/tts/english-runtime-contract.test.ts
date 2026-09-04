import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const runtimeFiles = [
  "custom-cloud-engine.ts",
  "gptsovits-engine.ts",
  "mimo-engine.ts",
  "minimax-engine.ts",
  "mossland-engine.ts",
  "tts-dispatcher.ts",
];

function removeComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("TTS English runtime boundary", () => {
  it.each(runtimeFiles)("keeps reachable app text in %s English", (file) => {
    const source = readFileSync(resolve(__dirname, file), "utf8");
    expect(removeComments(source)).not.toMatch(/[\u3400-\u9fff]/u);
  });
});
