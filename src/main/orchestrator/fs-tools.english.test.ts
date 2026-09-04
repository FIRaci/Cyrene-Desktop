import { describe, expect, it } from "vitest";
import { toolRegistry } from "./tool-registry";
import "./fs-tools";

const CJK = /[\u3400-\u9fff]/u;

describe("filesystem tools English model interface", () => {
  it("exposes English-only names, descriptions, and schemas", () => {
    for (const id of ["read_file", "list_dir", "write_file", "read_image"]) {
      const tool = toolRegistry.getById(id);
      expect(tool).toBeDefined();
      expect(JSON.stringify({ name: tool!.name, description: tool!.description, inputSchema: tool!.inputSchema })).not.toMatch(CJK);
    }
  });

  it("returns English path-validation errors", async () => {
    for (const id of ["read_file", "list_dir", "write_file", "read_image"]) {
      const result = await toolRegistry.getById(id)!.execute({ path: "relative/path" });
      expect(result).toBe("[Error] path must be absolute");
      expect(result).not.toMatch(CJK);
    }
  });
});
