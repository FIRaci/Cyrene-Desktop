import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const han = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;
const encodedHan = /\\u(?:\{)?(?:3[4-9a-f]|[4-9a-f][0-9a-f])[0-9a-f]{2}/iu;
const shippedEnglishFiles = [
  "src/renderer/call/index.html",
  "src/renderer/chat/index.html",
  "src/renderer/settings/index.html",
  "src/renderer/sidebar/index.html",
  "src/renderer/sticker-manager/index.html",
  "src/renderer/tasks/index.html",
  "src/renderer/ui/modal.html",
  "src/renderer/chat/markdown/code-block-controller.ts",
  "src/renderer/chat/markdown/streaming-block-renderer.ts",
  "src/shared/chat-context.ts",
  "src/shared/chat-ui.ts",
  "src/shared/ui-icon.ts",
  "src/renderer/ui/modal.ts",
  "src/main/rag/index.ts",
  "game-recipes/star-rail-daily.yaml",
  "prompts/soul.md",
];

describe("English shipping contract", () => {
  it.each(shippedEnglishFiles)("keeps %s free of Han-script UI copy", (relativePath) => {
    const source = fs.readFileSync(path.join(root, relativePath), "utf8");
    expect(source, `${relativePath} contains Chinese UI or model-facing copy`).not.toMatch(han);
    expect(source, `${relativePath} contains escaped Chinese UI or model-facing copy`).not.toMatch(encodedHan);
  });
});
