import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../index", () => ({
  sendToLive2DWindow: vi.fn(),
}));
import { setWeatherConfig } from "./built-in-tools";
import { setTravelConfig, registerTravelTools } from "./travel-tools";
import { toolRegistry } from "./tool-registry";

registerTravelTools();

describe("plugin enabled gates", () => {
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
});
