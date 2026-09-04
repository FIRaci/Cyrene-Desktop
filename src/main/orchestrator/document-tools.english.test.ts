import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getPath: () => "D:\\Cyrene Test\\.test-data",
    getAppPath: () => "D:\\Cyrene Test",
  },
}));

import { toolRegistry } from "./tool-registry";
import { registerDocumentTools } from "./document-tools";

const CJK = /[\u3400-\u9fff]/u;
const TOOL_IDS = ["write_excel", "write_word", "write_pdf", "write_markdown"];

describe("document tools English model interface", () => {
  beforeAll(() => registerDocumentTools());

  it("exposes English-only names, descriptions, and schemas", () => {
    for (const id of TOOL_IDS) {
      const tool = toolRegistry.getById(id);
      expect(tool).toBeDefined();
      expect(JSON.stringify({
        name: tool!.name,
        description: tool!.description,
        inputSchema: tool!.inputSchema,
      })).not.toMatch(CJK);
    }
  });

  it("returns English validation errors without changing tool contracts", async () => {
    expect(await toolRegistry.getById("write_excel")!.execute({ filename: "report.txt", sheets: [] }))
      .toBe("[Error] filename must end in .xlsx");
    expect(await toolRegistry.getById("write_word")!.execute({ filename: "report.txt" }))
      .toBe("[Error] filename must end in .docx");
    expect(await toolRegistry.getById("write_pdf")!.execute({ filename: "report.txt" }))
      .toBe("[Error] filename must end in .pdf");
    expect(await toolRegistry.getById("write_markdown")!.execute({ filename: "report.txt" }))
      .toBe("[Error] filename must end in .md");
  });
});
