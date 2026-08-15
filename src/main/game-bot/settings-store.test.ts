import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => "C:\\test-user-data" } }));

import { isGameBotIdentifier } from "./settings-store";

describe("game-bot identifiers", () => {
  it.each(["star-rail-daily", "ref_1", "A", "recipe99"])("accepts %s", (value) => {
    expect(isGameBotIdentifier(value)).toBe(true);
  });

  it.each(["", "../secret", "..\\secret", "C:\\secret", "/tmp/x", "recipe.yaml", "two words", "a".repeat(65)])(
    "rejects unsafe identifier %s",
    (value) => expect(isGameBotIdentifier(value)).toBe(false),
  );
});
