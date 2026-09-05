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

  it("migrates legacy provider labels to canonical identifiers", () => {
    const mainSource = fs.readFileSync(path.join(root, "src/main/index.ts"), "utf8");
    const migrations: Record<string, string> = {
      "MiniMax (Xiyu Tech)": "MiniMax",
      "Doubao (Volcano Engine)": "Doubao",
      "GLM (Zhipu)": "GLM",
      "Kimi (Moonshot)": "Kimi",
      "Qwen (Tongyi Qianwen)": "Qwen",
      "MiMo (Xiaomi)": "MiMo",
    };
    for (const [legacy, canonical] of Object.entries(migrations)) {
      expect(mainSource).toContain(`"${legacy}": "${canonical}"`);
    }
  });
});
