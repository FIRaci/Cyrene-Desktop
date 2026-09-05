import { describe, expect, it } from "vitest";
import { splitTextBySentenceBreaks } from "../shared/message-segmentation";

describe("shared message segmentation", () => {
  it("splits text by sentence-ending punctuation and trims new segment leading whitespace", () => {
    const text = [
      "It is raining lightly today, remember to bring an umbrella!",
      "What did you have for lunch? Anything fun you want to share?",
      "Thanks for your hard work on development, remember to stretch and move around.",
    ].join("\n");

    expect(splitTextBySentenceBreaks(text)).toEqual([
      "It is raining lightly today, remember to bring an umbrella!",
      "What did you have for lunch?",
      "Anything fun you want to share?",
      "Thanks for your hard work on development, remember to stretch and move around.",
    ]);
  });

  it("keeps the tail merged into the last part when the max part count is reached", () => {
    const text = "One! Two! Three! Four! Five!";

    expect(splitTextBySentenceBreaks(text, 3)).toEqual([
      "One!",
      "Two!",
      "Three! Four! Five!",
    ]);
  });
});
