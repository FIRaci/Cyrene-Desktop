import { describe, it, expect } from "vitest";
import { LOCATION_PIN_SVG, getWeatherIconSvg } from "./weather-icons";

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
});
