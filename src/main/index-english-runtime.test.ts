import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(path.join(process.cwd(), "src/main/index.ts"), "utf8");

describe("main-process reachable English contract", () => {
  it("keeps known renderer/model-facing errors, prompts and window copy in English", () => {
    for (const retired of [
      "\u672a\u914d\u7f6e\u89c6\u89c9\u6a21\u578b\uff0c\u65e0\u6cd5\u5206\u6790\u56fe\u7247",
      "\u6a21\u578b\u8bf7\u6c42\u8d85\u65f6\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5",
      "\u7f3a\u5c11\u5fc5\u8981\u53c2\u6570",
      "\u7f13\u5b58\u672a\u547d\u4e2d",
      "\u9009\u62e9\u97f3\u9891\u6587\u4ef6",
      "\u5b57\u4f53\u6587\u4ef6\u65e0\u6548",
      "\u6614\u6d9f\u7684\u4e3b\u52a8\u6d88\u606f",
      "\u5f53\u524d\u53ef\u7528\u5de5\u5177",
      "\u7cfb\u7edf\u63d0\u793a\uff1askill",
      "\u6253\u5f00\u72b6\u6001\u9762\u677f",
      "\u663e\u793a/\u9690\u85cf\u684c\u5ba0",
    ]) {
      expect(source, `reachable Chinese copy remains: ${retired}`).not.toContain(`"${retired}`);
      expect(source, `reachable Chinese copy remains: ${retired}`).not.toContain(`'${retired}`);
      expect(source, `reachable Chinese copy remains: ${retired}`).not.toContain(`\`${retired}`);
    }
    expect(source).toContain('title: "Cyrene · Chat"');
    expect(source).toContain('title: "Cyrene · Settings"');
    expect(source).toContain('"What color is this image? Answer with one word."');
  });

  it("recognizes English vision failures", () => {
    expect(source.match(/startsWith\("\[Error"\)/g)?.length).toBeGreaterThanOrEqual(4);
  });
});
