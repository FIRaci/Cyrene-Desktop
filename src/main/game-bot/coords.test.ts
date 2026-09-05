// coords unit tests — VLM text -> coordinates/boolean/matched index parser.
import { describe, it, expect } from "vitest";
import { parseClickCoord, parseBoolAnswer, parseMatchIndex } from "./coords";

describe("parseClickCoord", () => {
  it("parses {x,y} 0-1000 normalized -> pixels", () => {
    expect(parseClickCoord('{"x":500,"y":250}', 1920, 1080)).toEqual({ x: 960, y: 270 });
  });
  it("with ```json fence", () => {
    expect(parseClickCoord('```json\n{"x":100,"y":100}\n```', 1000, 1000)).toEqual({ x: 100, y: 100 });
  });
  it("embedded JSON in text", () => {
    expect(parseClickCoord('Target is at {"x":800,"y":600} position', 1000, 1000)).toEqual({ x: 800, y: 600 });
  });
  it("clamps out-of-bounds coords to screen boundary", () => {
    expect(parseClickCoord('{"x":1500,"y":-100}', 1000, 1000)).toEqual({ x: 1000, y: 0 });
  });
  it("returns null when no JSON found", () => {
    expect(parseClickCoord("target not found", 1000, 1000)).toBeNull();
  });
  it("returns null when JSON lacks x/y", () => {
    expect(parseClickCoord('{"x":500}', 1000, 1000)).toBeNull();
  });
});

describe("parseBoolAnswer", () => {
  it('{"answer":true} -> true', () => {
    expect(parseBoolAnswer('{"answer":true}')).toBe(true);
  });
  it('{"answer":false} -> false', () => {
    expect(parseBoolAnswer('{"answer":false}')).toBe(false);
  });
  it("text yes/true -> true", () => {
    expect(parseBoolAnswer("Yes, there is an update dialog")).toBe(true);
  });
  it("text no/none -> false", () => {
    expect(parseBoolAnswer("No, no popup")).toBe(false);
  });
  it("inconclusive -> null", () => {
    expect(parseBoolAnswer("maybe")).toBeNull();
  });
});

describe("parseMatchIndex", () => {
  it('{"match":1} -> 1', () => {
    expect(parseMatchIndex('{"match":1}', 2)).toBe(1);
  });
  it("out-of-bound index -> null", () => {
    expect(parseMatchIndex('{"match":5}', 2)).toBeNull();
  });
  it("missing match field -> null", () => {
    expect(parseMatchIndex("not sure which one matches", 2)).toBeNull();
  });
});
