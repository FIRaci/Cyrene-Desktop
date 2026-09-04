import { describe, expect, it, vi } from "vitest";

vi.mock("../index", () => ({
  sendToLive2DWindow: vi.fn(),
}));

import "./built-in-tools";
import { toolRegistry } from "./tool-registry";

const BUILT_IN_IDS = [
  "fetch_url",
  "run_shell",
  "install_mcp_server",
  "weather",
  "web_search",
  "todo_write",
  "delegate_task",
  "ask_user_choice",
] as const;

describe("built-in tool English contracts", () => {
  it("exposes English-only model metadata without changing stable tool IDs", () => {
    for (const id of BUILT_IN_IDS) {
      const tool = toolRegistry.getById(id);
      expect(tool, `missing built-in tool ${id}`).toBeDefined();
      const contract = JSON.stringify({
        name: tool?.name,
        description: tool?.description,
        inputSchema: tool?.inputSchema,
        soulActionLabel: tool?.soulActionLabel,
        soulErrorMessages: tool?.soulErrorMessages,
      });
      expect(contract, `${id} contains model-facing Han text`).not.toMatch(/[\u3400-\u9fff]/u);
    }
  });

  it("returns English validation errors", async () => {
    await expect(toolRegistry.getById("fetch_url")?.execute({ url: "file:///tmp/a" }))
      .resolves.toBe("[Error] URL must start with http:// or https://.");
    await expect(toolRegistry.getById("run_shell")?.execute({ command: "" }))
      .resolves.toBe("[Error] command cannot be empty.");
    await expect(toolRegistry.getById("install_mcp_server")?.execute({ command: "" }))
      .resolves.toBe("[Error] command cannot be empty.");
    await expect(toolRegistry.getById("delegate_task")?.execute({ task: "" }))
      .resolves.toBe("[Error] task cannot be empty.");
    await expect(toolRegistry.getById("ask_user_choice")?.execute({ question: "", options: [] }))
      .resolves.toBe("[Error] question cannot be empty.");
  });
});
