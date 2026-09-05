import { describe, expect, it } from "vitest";
import type { ToolDefinition } from "./tool-registry";
import { buildToolCatalog } from "./tool-catalog";

function makeTool(overrides: Partial<ToolDefinition> & { id: string }): ToolDefinition {
  return {
    name: overrides.id,
    description: overrides.id,
    enabled: true,
    inputSchema: { type: "object", properties: {} },
    execute: async () => "",
    ...overrides,
  };
}

describe("buildToolCatalog", () => {
  it("outputs placeholder for empty tool list", () => {
    expect(buildToolCatalog([])).toBe("(No tools are currently available.)");
  });

  it("basic output: id + purpose + risk", () => {
    const tools = [
      makeTool({ id: "weather", description: "Query weather", risk: "network" }),
      makeTool({ id: "fetch_url", description: "Read webpage", risk: "network" }),
    ];
    const out = buildToolCatalog(tools);
    expect(out).toContain("- weather");
    expect(out).toContain("Purpose: Query weather");
    expect(out).toContain("Risk: network");
    expect(out).toContain("- fetch_url");
    expect(out).toContain("Purpose: Read webpage");
  });

  it("defaults risk to safe", () => {
    const tools = [makeTool({ id: "x", description: "X" })];
    const out = buildToolCatalog(tools);
    expect(out).toContain("Risk: safe");
  });

  it("catalogHint takes precedence over description", () => {
    const tools = [
      makeTool({
        id: "weather",
        description: "Query real-time weather in specified city, returning temperature, humidity, wind speed, etc.",
        catalogHint: "Query weather",
      }),
    ];
    const out = buildToolCatalog(tools);
    expect(out).toContain("Purpose: Query weather");
    expect(out).not.toContain("temperature, humidity");
  });

  it("falls back to first line of description when catalogHint is not provided", () => {
    const tools = [
      makeTool({
        id: "fetch_url",
        description:
          "Download webpage content from specified URL and return main text.\nWhen to use:\n- User gave explicit URL",
      }),
    ];
    const out = buildToolCatalog(tools);
    expect(out).toContain("Purpose: Download webpage content from specified URL and return main text.");
    expect(out).not.toContain("When to use");
  });

  it("falls back to catalogHint when description is missing (fallback)", () => {
    const tools = [
      makeTool({
        id: "x",
        description: "",
        catalogHint: "Fallback purpose",
      }),
    ];
    const out = buildToolCatalog(tools);
    expect(out).toContain("Purpose: Fallback purpose");
  });

  it("does not output parameters in catalog (avoid duplicating schema)", () => {
    const tools = [
      makeTool({
        id: "weather",
        description: "Query weather",
        inputSchema: {
          type: "object",
          properties: { city: { type: "string", description: "City name" } },
          required: ["city"],
        },
      }),
    ];
    const out = buildToolCatalog(tools);
    expect(out).not.toContain("city");
    expect(out).not.toContain("properties");
    expect(out).not.toContain("required");
  });

  it("concatenates multiple tools in order", () => {
    const tools = [
      makeTool({ id: "a", description: "Tool A" }),
      makeTool({ id: "b", description: "Tool B" }),
      makeTool({ id: "c", description: "Tool C" }),
    ];
    const out = buildToolCatalog(tools);
    const idxA = out.indexOf("- a");
    const idxB = out.indexOf("- b");
    const idxC = out.indexOf("- c");
    expect(idxA).toBeGreaterThanOrEqual(0);
    expect(idxB).toBeGreaterThan(idxA);
    expect(idxC).toBeGreaterThan(idxB);
  });
});
