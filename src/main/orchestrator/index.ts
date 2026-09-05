// Orchestrator — unified entry point
// In Function Calling mode, Orchestrator is only responsible for building always-on context (worldbook + L0/L1)
// Tool selection and execution is handled by runFunctionCallingLoop in function-calling.ts
import { updateWorldbookActivation, getPermanentWorldbookEntries, getActiveWorldbookEntries, getCascadeWorldbookEntries, searchMemory, searchMemoryEntries, INJECTION_HEADER, INJECTION_PREAMBLE } from "../rag";
import { memoryStore } from "../memory/memory-store";
import { entityGraph } from "../memory/entity-graph";
import { recordRecentMemorySearchEntries } from "../memory/recent-injected-memory";
import { toolRegistry } from "./tool-registry";

export { ToolCallResult } from "./types";
export { scheduleMemoryWrite } from "./context-builder";
export { buildToneInjection } from "./tone-injector";
export { runFunctionCallingLoop } from "./function-calling";

// topicState TTL removed -- superseded by DMAE Activation state machine (see rag/worldbook.ts)

/**
 * Build relevant memory injection: auto-retrieves top-N relevant L2 memories and imported docs,
 * injecting them into system prompt so model perceives context without active tool calls.
 * Original tools remain available for deeper searches.
 */
export async function buildMemoryInjection(
  userInput: string,
): Promise<string> {
  const parts: string[] = [];

  try {
    // Retrieve top-3 L2 user memories
    const userMemoryEntries = await searchMemoryEntries(userInput, "user_memory", 5);
    if (userMemoryEntries.length > 0) {
      recordRecentMemorySearchEntries(userMemoryEntries);
      // Annotate potentially conflicting memories
      const allL2 = await memoryStore.getAllL2();
      const conflictAnnotated = userMemoryEntries.map((entry) => {
        const m = entry.text;
        const l2Entry = allL2.find((l) => l.content === m && l.conflictWith && l.conflictWith.length > 0);
        if (l2Entry) {
          return `· ${m} ⚠️ (This information may contain conflicting records)`;
        }
        return `· ${m}`;
      });
      parts.push("[Relevant memories]\n" + conflictAnnotated.join("\n"));
    }
  } catch (err) {
    console.warn("[Orchestrator] user_memory search failed:", err);
  }

  try {
    // Retrieve top-2 imported document snippets
    const docResults = await searchMemory(userInput, "imported_doc", 2);
    if (docResults.length > 0) {
      parts.push("[Relevant documents]\n" + docResults.map((d) => "· " + d).join("\n"));
    }
  } catch (err) {
    console.warn("[Orchestrator] imported_doc search failed:", err);
  }

  try {
    // Entity relationship graph
    const entityInfo = entityGraph.search(userInput);
    if (entityInfo) {
      parts.push("[Character relationships]\n" + entityInfo);
    }
  } catch (err) {
    console.warn("[Orchestrator] entity graph search failed:", err);
  }

  return parts.join("\n\n");
}

function getWorldbookTriggerText(userInput: string): string {
  const contextMarkers = [
    "[Files for this turn]",
    "[Document content]",
    "[Image observations]",
    "[Image attachments]",
    "\u3010\u672c\u8f6e\u6587\u4ef6\u3011",
    "\u3010\u6587\u6863\u5185\u5bb9\u3011",
    "\u3010\u56fe\u7247\u89c6\u89c9\u4fe1\u606f\u3011",
    "\u3010\u56fe\u7247\u9644\u4ef6\u3011",
  ];
  const firstContextIndex = contextMarkers
    .map((marker) => userInput.indexOf(marker))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  return (typeof firstContextIndex === "number" ? userInput.slice(0, firstContextIndex) : userInput).trim();
}

/**
 * Build always-on context: worldbook + L0/L1 profile.
 * Does not involve tool selection and execution -- handled by function calling.
 */
export async function buildAlwaysOnContext(
  userInput: string,
  recentMessages: Array<{ role: string; content: string }>,
): Promise<string> {
  const parts: string[] = [];

  // -- Worldbook - Always runs --
  // DMAE: permanent entries always injected; non-permanent gated by Activation lifecycle.
  // updateActivation runs before LLM call -> turn hits enter Prompt in the same turn.
  try {
    const permanentWb = getPermanentWorldbookEntries();
    if (permanentWb.length > 0) {
      parts.push("[Permanent background]\n" + permanentWb.join("\n\n"));
    }

    const lastAssistant = recentMessages
      .filter(m => m.role === "assistant")
      .slice(-1)[0]?.content ?? "";
    updateWorldbookActivation(getWorldbookTriggerText(userInput), lastAssistant);  // Score (current user + previous assistant)
    const active = getActiveWorldbookEntries();           // Threshold gate + injection
    // One-Shot cascade: co-triggered entries upon user hit (not in DMAE state table, valid this turn only)
    const cascade = getCascadeWorldbookEntries();
    const allInjected = active.length > 0 || cascade.length > 0;
    if (allInjected) {
      const sections: string[] = [];
      if (active.length > 0) {
        sections.push(active.join("\n\n"));
      }
      if (cascade.length > 0) {
        sections.push(cascade.join("\n\n"));
      }
      parts.push(INJECTION_HEADER + "\n" + INJECTION_PREAMBLE + "\n\n" + sections.join("\n\n"));
    }
  } catch (err) {
    console.warn("[Orchestrator] worldbook dmae failed:", err);
  }

  // -- L0/L1 profile - Always runs --
  try {
    const l0 = await memoryStore.getL0();
    const l1 = await memoryStore.getL1();

    const l0Lines = [
      l0.preferredName && `Preferred Name: ${l0.preferredName}`,
      l0.occupation && `Occupation: ${l0.occupation}`,
      l0.longTermInterests && `Long-term Interests: ${l0.longTermInterests}`,
      l0.language && `Preferred Language: ${l0.language}`,
      l0.permanentNote && `Note: ${l0.permanentNote}`,
    ].filter(Boolean);

    const l1Lines = [
      l1.recentGoals && `Recent Goals: ${l1.recentGoals}`,
      l1.recentPreferences && `Recent Preferences: ${l1.recentPreferences}`,
      l1.currentProject && `Current Project: ${l1.currentProject}`,
    ].filter(Boolean);

    if (l0Lines.length > 0 || l1Lines.length > 0) {
      let memoryContext = "";
      if (l0Lines.length > 0) {
        memoryContext += `[User Profile]\n${l0Lines.join("\n")}\n\n`;
      }
      if (l1Lines.length > 0) {
        memoryContext += `[Recent Status]\n${l1Lines.join("\n")}\n\n`;
      }
      parts.push(memoryContext.trim());
    }
  } catch (err) {
    console.warn("[Orchestrator] memory load failed:", err);
  }

  // -- Logging --
  const enabledTools = toolRegistry.getEnabledTools();
  console.log("[Orchestrator] Always-on context built, enabled tools: " + enabledTools.map(t => t.id).join(", "));

  return parts.join("\n\n");
}
