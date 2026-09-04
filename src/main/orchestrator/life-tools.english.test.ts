import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => "D:\\Cyrene Test\\.test-data" },
}));
vi.mock("./built-in-tools", () => ({
  currentUserTimezone: () => "UTC",
}));

import { toolRegistry } from "./tool-registry";
import { registerLifeTools } from "./life-tools";

const CJK = /[\u3400-\u9fff]/u;

describe("life tools English model interface", () => {
  beforeAll(() => registerLifeTools());

  it("exposes English-only names, descriptions, and schemas", () => {
    for (const id of ["record_expense", "query_expense", "exchange_rate", "translate", "apply_patch"]) {
      const tool = toolRegistry.getById(id);
      expect(tool).toBeDefined();
      expect(JSON.stringify({ name: tool!.name, description: tool!.description, inputSchema: tool!.inputSchema })).not.toMatch(CJK);
    }
  });

  it("returns English validation errors", async () => {
    expect(await toolRegistry.getById("record_expense")!.execute({ amount: 0 })).toBe("[Error] amount must be a positive number");
    expect(await toolRegistry.getById("translate")!.execute({ text: "", to: "English" })).toBe("[Error] text and to are required");
    expect(await toolRegistry.getById("apply_patch")!.execute({ file_path: "" })).toBe("[Error] file_path is required");
  });
});
