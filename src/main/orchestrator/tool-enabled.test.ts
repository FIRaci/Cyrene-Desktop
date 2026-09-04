import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../index", () => ({
  sendToLive2DWindow: vi.fn(),
}));
import { setWeatherConfig } from "./built-in-tools";
import { setTravelConfig, registerTravelTools } from "./travel-tools";
import { toolRegistry } from "./tool-registry";

registerTravelTools();

describe("plugin enabled gates", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    setWeatherConfig(
      () => "北京",
      () => "amap",
      () => "",
      undefined,
      () => false,
    );
    setTravelConfig(
      () => "fake-amap-key",
      () => false,
    );
  });

  it("does not execute weather lookup when the weather plugin is disabled", async () => {
    const weather = toolRegistry.getById("weather");

    await expect(weather?.execute({ city: "北京" })).resolves.toBe("[Error] Weather feature is disabled. Please enable it in Settings.");
  });

  it("does not execute travel lookup when the travel plugin is disabled", async () => {
    const travel = toolRegistry.getById("plan_trip");

    await expect(travel?.execute({ origin: "A", destination: "B" })).resolves.toBe("[Error] Travel tools are disabled. Please enable them in Settings.");
  });

  it("exposes an English-only travel contract", () => {
    const travel = toolRegistry.getById("plan_trip");
    const contract = JSON.stringify({
      name: travel?.name,
      description: travel?.description,
      inputSchema: travel?.inputSchema,
    });

    expect(contract).toContain("Travel planner");
    expect(contract).not.toMatch(/[\u3400-\u9fff]/u);
  });

  it("keeps legacy Chinese travel modes as internal input aliases", async () => {
    setTravelConfig(() => "fake-amap-key", () => true);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/geocode/geo")) {
        return new Response(JSON.stringify({ status: "1", geocodes: [{ location: "116.1,39.1" }] }));
      }
      if (url.includes("/direction/walking")) {
        return new Response(JSON.stringify({ route: { paths: [{ distance: "1200", duration: "900" }] } }));
      }
      return new Response("not found", { status: 404 });
    }));
    const travel = toolRegistry.getById("plan_trip");

    const output = await travel?.execute({ origin: "北京站", destination: "故宫", mode: "步行" });

    expect(output).toContain("Walking route");
    expect(output).toContain("Distance: 1.2 km");
  });
});
