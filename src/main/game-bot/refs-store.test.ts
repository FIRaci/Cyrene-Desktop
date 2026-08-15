import * as path from "path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => "C:\\test-user-data" } }));

import { listRefs, readRef, refsDirPath } from "./refs-store";

describe("game-bot refs path security", () => {
  it("resolves a valid recipe below the refs root", () => {
    const resolved = refsDirPath("star-rail-daily");
    expect(resolved).toBe(path.resolve("C:\\test-user-data", "game-bot", "refs", "star-rail-daily"));
  });

  it.each(["../outside", "..\\outside", "C:\\outside", "recipe/name", "recipe.yaml"])(
    "rejects unsafe recipe identifier %s",
    (recipeId) => expect(() => refsDirPath(recipeId)).toThrow(TypeError),
  );

  it("returns safe empty results for unsafe read/list inputs", () => {
    expect(listRefs("../outside")).toEqual([]);
    expect(readRef("valid-recipe", "../secret")).toBeNull();
    expect(readRef("../outside", "secret")).toBeNull();
  });
});
