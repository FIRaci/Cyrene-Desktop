import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { setTravelConfig, registerTravelTools } from "./travel-tools";
import { toolRegistry } from "./tool-registry";

describe("travel-tools", () => {
  beforeEach(() => {
    registerTravelTools();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers plan_trip tool in toolRegistry", () => {
    const tool = toolRegistry.getById("plan_trip");
    expect(tool).toBeDefined();
    expect(tool?.id).toBe("plan_trip");
  });

  it("returns error if origin or destination is empty", async () => {
    setTravelConfig(() => "", () => true);
    const tool = toolRegistry.getById("plan_trip");
    const result = await tool?.execute({ origin: "", destination: "" });
    expect(result).toContain("Please provide both an origin and a destination");
  });

  it("performs global trip calculation without any key", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("Hanoi")) {
        return new Response(JSON.stringify({
          results: [{ name: "Hanoi", country: "Vietnam", latitude: 21.0285, longitude: 105.8542 }]
        }));
      }
      if (url.includes("Da%20Nang") || url.includes("Da Nang")) {
        return new Response(JSON.stringify({
          results: [{ name: "Da Nang", country: "Vietnam", latitude: 16.0678, longitude: 108.2208 }]
        }));
      }
      return new Response("not found", { status: 404 });
    }));

    setTravelConfig(() => "", () => true);
    const tool = toolRegistry.getById("plan_trip");
    const result = await tool?.execute({
      origin: "Hanoi",
      destination: "Da Nang",
      mode: "driving"
    });
    expect(result).toBeDefined();
    expect(result).toContain("Driving route");
    expect(result).toContain("Hanoi");
    expect(result).toContain("Da Nang");
    expect(result).toContain("km");
  });
});
