import { describe, expect, it } from "vitest";
import { buildEnvironmentContext } from "./environment";

// These tests verify:
// 1) Timezone source: profile.timezone prioritized, invalid falls back to Asia/Shanghai; does not read system tz
// 2) Disclaimer text: includes timezone != location statement
// 3) Time formatting: uses formatToParts without locale punctuation dependencies

describe("buildEnvironmentContext timezone", () => {
  it("treats the preferred address and gender as trusted wording constraints", () => {
    const ctx = buildEnvironmentContext(undefined, {
      callPreference: "partner",
      gender: "male",
    });

    expect(ctx).toContain('use "partner" naturally for an important question or confirmation');
    expect(ctx).toContain("do not use feminine forms of address");
  });

  it("uses profile.timezone when valid and includes time label", () => {
    const ctx = buildEnvironmentContext(
      undefined,
      { timezone: "Asia/Tokyo" },
    );
    // Time line format: - Current time: YYYY-MM-DD Day HH:MM (time zone Asia/Tokyo)
    const m = ctx.match(/- Current time: (\d{4}-\d{2}-\d{2} [A-Za-z]{3} \d{2}:\d{2}) \(time zone ([\w/]+)\)/);
    expect(m).not.toBeNull();
    expect(m?.[2]).toBe("Asia/Tokyo");
    // Does not contain system timezone artifacts (when profile=Asia/Tokyo, never contains Asia/Shanghai)
    expect(ctx).not.toMatch(/time zone Asia\/Shanghai/);
  });

  it("falls back to Asia/Shanghai when profile.timezone missing or invalid (never reads system tz)", () => {
    const ctx1 = buildEnvironmentContext(undefined, undefined);
    expect(ctx1).toMatch(/time zone Asia\/Shanghai/);

    const ctx2 = buildEnvironmentContext(undefined, { timezone: "bad/timezone" });
    expect(ctx2).toMatch(/time zone Asia\/Shanghai/);

    const ctx3 = buildEnvironmentContext(undefined, { timezone: "" });
    expect(ctx3).toMatch(/time zone Asia\/Shanghai/);
  });

  it("emits the timezone-not-location disclaimer", () => {
    const ctx = buildEnvironmentContext(
      undefined,
      { defaultCity: "Shanghai", timezone: "Asia/Shanghai" },
    );
    expect(ctx).toContain("The user's time zone is only for time calculations");
    expect(ctx).toContain("Never infer a city from it");
    // Timezone and default city presented separately, not merged
    expect(ctx).toMatch(/Default city: Shanghai[\s\S]*time zone is only for time calculations/);
  });

  it("formats time as YYYY-MM-DD Day HH:MM using formatToParts (fixed assembly, not locale string)", () => {
    // Verifies output format contract: YYYY-MM-DD Day HH:MM (time zone X)
    const ctx = buildEnvironmentContext(
      undefined,
      { timezone: "Asia/Shanghai" },
    );
    const ctxNyc = buildEnvironmentContext(
      undefined,
      { timezone: "America/New_York" },
    );

    const timeLineRe = /- Current time: (\d{4}-\d{2}-\d{2} [A-Za-z]{3} \d{2}:\d{2} \(time zone [\w/]+)/;
    const m = ctx.match(timeLineRe);
    expect(m).not.toBeNull();
    expect(ctx).toMatch(timeLineRe);
    expect(ctxNyc).toMatch(timeLineRe);

    // No AM/PM or localized punctuation
    expect(ctx).not.toMatch(/(\u4e0a\u5348|\u4e0b\u5348|AM|PM)/);
    expect(ctxNyc).not.toMatch(/(\u4e0a\u5348|\u4e0b\u5348|AM|PM)/);

    // Timezone label accurate
    expect(ctx).toContain("(time zone Asia/Shanghai)");
    expect(ctxNyc).toContain("(time zone America/New_York)");
  });

  it("survives illegal IANA timezone (resolver returns Asia/Shanghai, no RangeError)", () => {
    expect(() => buildEnvironmentContext(undefined, { timezone: "Foo/Bar" })).not.toThrow();
    const ctx = buildEnvironmentContext(undefined, { timezone: "Foo/Bar" });
    expect(ctx).toMatch(/time zone Asia\/Shanghai/);
  });
});
