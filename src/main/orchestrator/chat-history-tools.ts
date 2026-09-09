import { toolRegistry } from "./tool-registry";
import { searchChatHistory } from "../memory/cross-session-history";

export function registerChatHistoryTools(): void {
  toolRegistry.register({
    id: "query_chat_history",
    name: "Query Past Chat History",
    description:
      "Search across past conversation sessions and chat messages with Master to recall previous discussions, code snippets, decisions, or recommendations.",
    enabled: true,
    risk: "safe",
    catalogHint: "Search and recall discussions from past chat sessions",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Keyword, phrase, or topic to search for in past chat history.",
        },
        limit: {
          type: "number",
          description: "Maximum number of past messages to return (default 5).",
        },
      },
      required: ["query"],
    },
    execute: async (args) => {
      const q = typeof args.query === "string" ? args.query : "";
      const limit = typeof args.limit === "number" ? args.limit : 5;
      const matches = searchChatHistory(q, limit);

      if (matches.length === 0) {
        return `No past chat messages found matching "${q}".`;
      }

      const formatted = matches
        .map(
          (m, idx) =>
            `${idx + 1}. [Session: "${m.sessionTitle}"] (${new Date(
              m.at,
            ).toLocaleDateString()}): ${
              m.role === "user" ? "Master" : "Cyrene"
            }: "${m.content}"`,
        )
        .join("\n\n");

      return `Found ${matches.length} matching past conversation records:\n\n${formatted}`;
    },
  });
}
