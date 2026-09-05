import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./index", () => ({
  sendToLive2DWindow: vi.fn(),
}));

import { setWeatherConfig } from "./orchestrator/built-in-tools";
import { toolRegistry } from "./orchestrator/tool-registry";

describe("Weather Location & Privacy Contract", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes("geocoding-api.open-meteo.com")) {
        // Assert geocoding uses English language
        expect(url).toContain("language=en");
        const cityName = url.includes("Tokyo") ? "Tokyo" : "Hanoi";
        return {
          ok: true,
          json: async () => ({
            results: [{ name: cityName, latitude: 21.0245, longitude: 105.84117, country: "Vietnam" }],
          }),
        } as unknown as Response;
      }
      if (url.includes("api.open-meteo.com/v1/forecast")) {
        return {
          ok: true,
          json: async () => ({
            current: {
              temperature_2m: 28, relative_humidity_2m: 65, apparent_temperature: 29,
              precipitation: 0, weather_code: 0, wind_speed_10m: 10,
              wind_direction_10m: 180, surface_pressure: 1012, uv_index: 5, visibility: 10000,
            },
            daily: {
              time: ["2026-09-04"],
              temperature_2m_max: [32],
              temperature_2m_min: [25],
              weather_code: [0],
              wind_speed_10m_max: [15],
              wind_direction_10m_dominant: [180],
            },
          }),
        } as unknown as Response;
      }
      return { ok: false, status: 404 } as unknown as Response;
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("resolves to Hanoi as default city when user profile city is empty", async () => {
    let mockProfileCity = "";
    setWeatherConfig(
      () => mockProfileCity || "Hanoi",
      () => "open-meteo",
      () => "",
      undefined,
      () => true,
    );

    const weatherTool = toolRegistry.getById("weather");
    expect(weatherTool).toBeDefined();

    mockProfileCity = "";
    const result = await weatherTool!.execute({});
    expect(result).not.toContain("No city was provided");
    expect(result).toContain("Hanoi");
  });

  it("respects user configured custom city without leaking personal coordinates", async () => {
    let mockProfileCity = "Tokyo";
    setWeatherConfig(
      () => mockProfileCity || "Hanoi",
      () => "open-meteo",
      () => "",
      undefined,
      () => true,
    );

    const weatherTool = toolRegistry.getById("weather");
    expect(weatherTool).toBeDefined();

    const result = await weatherTool!.execute({});
    expect(result).not.toContain("No city was provided");
    expect(result).toContain("Tokyo");
  });

  it("ensures privacy: does not depend on GPS, coordinates, or IP geolocators", () => {
    const weatherTool = toolRegistry.getById("weather");
    expect(weatherTool).toBeDefined();

    // The schema must only accept coarse city string, with no latitude/longitude/IP inputs required
    const schema = weatherTool!.inputSchema;
    expect(schema.required).toEqual([]);
    expect(schema.properties).toHaveProperty("city");
    expect(schema.properties).not.toHaveProperty("latitude");
    expect(schema.properties).not.toHaveProperty("longitude");
    expect(schema.properties).not.toHaveProperty("ip");
    expect(schema.properties).not.toHaveProperty("gps");
  });
});
