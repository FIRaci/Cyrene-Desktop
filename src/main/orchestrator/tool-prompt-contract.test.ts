import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

describe("tools_system music contract", () => {
  it("uses opaque candidateRef instead of obsolete provider ids", () => {
    const prompt = readFileSync(join(process.cwd(), "prompts", "tools_system.md"), "utf8");

    expect(prompt).toContain("candidateRef");
    expect(prompt).not.toContain("\u5fc5\u987b\u540c\u65f6\u4f7f\u7528\u771f\u5b9e\u5019\u9009\u8fd4\u56de\u7684 `provider`\u3001`setId`\u3001`trackId`");
  });
});
