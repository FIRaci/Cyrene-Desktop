import { describe, expect, it } from "vitest";
import { isCompanionSafeTool } from "./tool-registry";

describe("companion tool policy", () => {
  it.each(["safe", "fs-read", "network", "input-control"] as const)("exposes %s app tools", (risk) => {
    expect(isCompanionSafeTool({ id: `tool-${risk}`, risk })).toBe(true);
  });

  it.each(["fs-write", "shell"] as const)("hides %s tools", (risk) => {
    expect(isCompanionSafeTool({ id: `tool-${risk}`, risk })).toBe(false);
  });

  it("always hides arbitrary MCP installation", () => {
    expect(isCompanionSafeTool({ id: "install_mcp_server", risk: "safe" })).toBe(false);
  });

  it("fails closed when a newly registered tool omits its risk", () => {
    expect(isCompanionSafeTool({ id: "future-tool" })).toBe(false);
  });
});
