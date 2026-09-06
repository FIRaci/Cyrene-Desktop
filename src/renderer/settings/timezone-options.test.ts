import { describe, it, expect } from "vitest";
import {
  TIMEZONE_OPTIONS,
  FALLBACK_TIMEZONE,
  normalizeTimezoneOptionValue,
} from "./timezone-options";

describe("timezone-options", () => {
  it("includes Hanoi Time (UTC+07:00) with value Asia/Ho_Chi_Minh as the first option", () => {
    expect(TIMEZONE_OPTIONS[0]).toEqual({
      label: "Hanoi Time (UTC+07:00)",
      value: "Asia/Ho_Chi_Minh",
    });
  });

  it("sets FALLBACK_TIMEZONE to Asia/Ho_Chi_Minh", () => {
    expect(FALLBACK_TIMEZONE).toBe("Asia/Ho_Chi_Minh");
  });

  it("normalizes empty or undefined inputs to FALLBACK_TIMEZONE", () => {
    expect(normalizeTimezoneOptionValue(null)).toBe("Asia/Ho_Chi_Minh");
    expect(normalizeTimezoneOptionValue(undefined)).toBe("Asia/Ho_Chi_Minh");
    expect(normalizeTimezoneOptionValue("")).toBe("Asia/Ho_Chi_Minh");
    expect(normalizeTimezoneOptionValue("   ")).toBe("Asia/Ho_Chi_Minh");
  });

  it("normalizes unrecognized timezones to FALLBACK_TIMEZONE", () => {
    expect(normalizeTimezoneOptionValue("Mars/Olympus_Mons")).toBe("Asia/Ho_Chi_Minh");
  });

  it("preserves valid registered timezones", () => {
    expect(normalizeTimezoneOptionValue("Asia/Ho_Chi_Minh")).toBe("Asia/Ho_Chi_Minh");
    expect(normalizeTimezoneOptionValue("Asia/Shanghai")).toBe("Asia/Shanghai");
    expect(normalizeTimezoneOptionValue("Asia/Tokyo")).toBe("Asia/Tokyo");
    expect(normalizeTimezoneOptionValue("America/New_York")).toBe("America/New_York");
  });

  it("maps regional aliases for Hanoi / Indochina to Asia/Ho_Chi_Minh", () => {
    expect(normalizeTimezoneOptionValue("Asia/Bangkok")).toBe("Asia/Ho_Chi_Minh");
    expect(normalizeTimezoneOptionValue("Asia/Saigon")).toBe("Asia/Ho_Chi_Minh");
    expect(normalizeTimezoneOptionValue("Asia/Hanoi")).toBe("Asia/Ho_Chi_Minh");
  });
});
