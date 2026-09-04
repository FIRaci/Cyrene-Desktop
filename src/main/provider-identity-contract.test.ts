import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PROVIDER_CAPABILITIES } from "./orchestrator/vendors/capabilities";

const root = process.cwd();

describe("provider identity contract", () => {
  it("keeps renderer preset identifiers aligned with main capabilities", () => {
    const settingsSource = fs.readFileSync(
      path.join(root, "src/renderer/settings/settings.ts"),
      "utf8",
    );
    for (const capability of PROVIDER_CAPABILITIES) {
      expect(settingsSource, capability.displayName).toContain(
        `providerName: "${capability.displayName}"`,
      );
    }
  });

  it("migrates accidentally persisted English labels back to canonical identifiers", () => {
    const mainSource = fs.readFileSync(path.join(root, "src/main/index.ts"), "utf8");
    const migrations: Record<string, string> = {
      "MiniMax (Xiyu Tech)": "MiniMax（稀宇科技）",
      "Doubao (Volcano Engine)": "豆包（火山方舟）",
      "GLM (Zhipu)": "GLM（智谱）",
      "Kimi (Moonshot)": "Kimi（月之暗面）",
      "Qwen (Tongyi Qianwen)": "Qwen（通义千问）",
      "MiMo (Xiaomi)": "MiMo（小米）",
    };
    for (const [legacy, canonical] of Object.entries(migrations)) {
      expect(mainSource).toContain(`"${legacy}": "${canonical}"`);
    }
  });
});
