import { describe, it, expect, vi } from "vitest";
import { registerChatHistoryTools } from "./chat-history-tools";
import { toolRegistry } from "./tool-registry";
import * as crossHistory from "../memory/cross-session-history";

vi.mock("../memory/cross-session-history", () => ({
  searchChatHistory: vi.fn(),
}));

describe("chat-history-tools", () => {
  it("registers query_chat_history tool and executes search", async () => {
    registerChatHistoryTools();
    const tool = toolRegistry.getById("query_chat_history");
    expect(tool).toBeDefined();
    expect(tool?.name).toBe("Query Past Chat History");

    // Case 1: matches found
    vi.mocked(crossHistory.searchChatHistory).mockReturnValue([
      {
        sessionId: "s1",
        sessionTitle: "Bug Hunting",
        role: "user",
        content: "We need to fix memory leaks",
        at: 1000000000000,
      },
    ]);

    const result = await tool!.execute({ query: "memory leaks" });
    expect(result).toContain("Bug Hunting");
    expect(result).toContain("memory leaks");

    // Case 2: no matches
    vi.mocked(crossHistory.searchChatHistory).mockReturnValue([]);
    const emptyResult = await tool!.execute({ query: "nonexistent" });
    expect(emptyResult).toContain("No past chat messages found matching");
  });
});
