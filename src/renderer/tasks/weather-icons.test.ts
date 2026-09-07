import { describe, it, expect } from "vitest";
import { LOCATION_PIN_SVG, getWeatherIconSvg, formatWeatherTemperature } from "./weather-icons";

describe("weather-icons", () => {
  it("exports a valid SVG string for LOCATION_PIN_SVG", () => {
    expect(LOCATION_PIN_SVG).toContain("<svg");
    expect(LOCATION_PIN_SVG).toContain("weather-svg-pin");
    expect(LOCATION_PIN_SVG).toContain("</svg>");
    expect(LOCATION_PIN_SVG).not.toContain("📍");
  });

  it("renders sunny/clear sky icon for code 0", () => {
    const svg = getWeatherIconSvg(0);
    expect(svg).toContain("weather-svg-sun");
    expect(svg).toContain("circle");
    expect(svg).not.toContain("☀️");
  });

  it("renders partly cloudy icon for code 2", () => {
    const svg = getWeatherIconSvg(2);
    expect(svg).toContain("weather-svg-partly-cloudy");
    expect(svg).not.toContain("⛅");
  });

  it("renders drizzle and rain icons for rainy codes", () => {
    const drizzle = getWeatherIconSvg(53);
    expect(drizzle).toContain("weather-svg-drizzle");
    expect(drizzle).not.toContain("🌦️");

    const rain = getWeatherIconSvg(63);
    expect(rain).toContain("weather-svg-rain");
    expect(rain).not.toContain("🌧️");
  });

  it("renders thunderstorm icon for code 95", () => {
    const thunder = getWeatherIconSvg(95);
    expect(thunder).toContain("weather-svg-thunderstorm");
    expect(thunder).toContain("polygon");
    expect(thunder).not.toContain("⛈️");
  });

  it("provides graceful fallback for unknown weather codes", () => {
    const fallback = getWeatherIconSvg(999);
    expect(fallback).toContain("weather-svg-icon");
    expect(fallback).toContain("weather-svg-partly-cloudy");
  });

  it("formats whole-day forecast temperature range when min and max are provided", () => {
    expect(formatWeatherTemperature(30, 25.3, 31.6)).toBe("25° - 32°C");
    expect(formatWeatherTemperature(28, 20, 29)).toBe("20° - 29°C");
  });

  it("falls back to single instantaneous temperature when min or max is missing", () => {
    expect(formatWeatherTemperature(28.4)).toBe("28°C");
    expect(formatWeatherTemperature(30, undefined, 32)).toBe("30°C");
    expect(formatWeatherTemperature(30, 24, undefined)).toBe("30°C");
  });
});
