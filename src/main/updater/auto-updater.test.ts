import { describe, expect, it } from "vitest";
import { compareSemver, isNewerVersion } from "./auto-updater";

describe("Auto Updater Semver Logic", () => {
  it("correctly compares semver versions", () => {
    expect(compareSemver("0.9.0", "0.9.1")).toBe(1); // 0.9.1 is newer
    expect(compareSemver("0.9.0", "1.0.0")).toBe(1);
    expect(compareSemver("0.9.1", "0.9.0")).toBe(-1); // 0.9.1 is older than target 0.9.0
    expect(compareSemver("0.9.0", "0.9.0")).toBe(0);
  });

  it("handles leading v and release tags cleanly", () => {
    expect(isNewerVersion("0.9.0", "v0.9.1")).toBe(true);
    expect(isNewerVersion("v0.9.0", "0.9.1")).toBe(true);
    expect(isNewerVersion("0.9.0", "v0.9.0")).toBe(false);
    expect(isNewerVersion("1.0.0", "v0.9.9")).toBe(false);
  });

  it("handles multi-segment version numbers", () => {
    expect(isNewerVersion("0.9.0.1", "0.9.0.2")).toBe(true);
    expect(isNewerVersion("0.9.1", "0.9.1.1")).toBe(true);
    expect(isNewerVersion("0.9.1.5", "0.9.1.4")).toBe(false);
  });
});
