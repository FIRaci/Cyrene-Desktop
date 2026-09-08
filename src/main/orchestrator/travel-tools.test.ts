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

  it("registers find_nearby_places tool in toolRegistry", () => {
    const tool = toolRegistry.getById("find_nearby_places");
    expect(tool).toBeDefined();
    expect(tool?.id).toBe("find_nearby_places");
  });

  it("requires a category for find_nearby_places", async () => {
    setTravelConfig(() => "", () => true, () => false, () => "Hanoi");
    const tool = toolRegistry.getById("find_nearby_places");
    const result = await tool?.execute({ category: "" });
    expect(result).toContain("Please provide a category or place type");
  });

  it("informs user and asks for area when location sharing is OFF and no location is given", async () => {
    setTravelConfig(() => "", () => true, () => false, () => "Hanoi");
    const tool = toolRegistry.getById("find_nearby_places");
    const result = await tool?.execute({ category: "hotpot" });
    expect(result).toContain("[Location Sharing Disabled]");
    expect(result).toContain("turned off in Settings for privacy");
    expect(result).toContain("Share My Location");
  });

  it("finds nearby places when location is explicitly specified even if location sharing is OFF", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("nominatim.openstreetmap.org")) {
        return new Response(JSON.stringify([
          {
            name: "Lẩu Phan",
            type: "restaurant",
            address: { road: "Duy Tan", suburb: "Cau Giay", city: "Hanoi" },
          },
        ]));
      }
      return new Response("not found", { status: 404 });
    }));

    setTravelConfig(() => "", () => true, () => false, () => "Hanoi");
    const tool = toolRegistry.getById("find_nearby_places");
    const result = await tool?.execute({ category: "hotpot", location: "Cau Giay, Hanoi" });
    expect(result).toContain("Nearby Recommendations: hotpot in Cau Giay, Hanoi");
    expect(result).toContain("Lẩu Phan");
    expect(result).toContain("google.com/maps/search");
  });

  it("uses default city when location sharing is ON and no location is provided", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("nominatim.openstreetmap.org")) {
        return new Response(JSON.stringify([
          {
            name: "Cong Ca Phe",
            type: "cafe",
            address: { road: "Trang Tien", suburb: "Hoan Kiem", city: "Hanoi" },
          },
        ]));
      }
      return new Response("not found", { status: 404 });
    }));

    setTravelConfig(() => "", () => true, () => true, () => "Hanoi");
    const tool = toolRegistry.getById("find_nearby_places");
    const result = await tool?.execute({ category: "cafe" });
    expect(result).toContain("Nearby Recommendations: cafe in Hanoi");
    expect(result).toContain("Cong Ca Phe");
    expect(result).toContain("google.com/maps/search");
  });

  it("exposes a 100% English contract for find_nearby_places", () => {
    const tool = toolRegistry.getById("find_nearby_places");
    const contract = JSON.stringify({
      name: tool?.name,
      description: tool?.description,
      inputSchema: tool?.inputSchema,
    });
    expect(contract).toContain("Nearby places and recommendations");
    expect(contract).not.toMatch(/[\u3400-\u9fff]/u);
  });
});
