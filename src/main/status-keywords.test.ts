import { describe, expect, it } from "vitest";
import { STATUS_KEYWORDS, FEELING_KEYWORDS, inferFeelingFromText } from "./status-keywords";

describe("status-keywords", () => {
  it("defines keywords for listening and thinking", () => {
    expect(STATUS_KEYWORDS.Listening.test("I feel a bit sad today")).toBe(true);
    expect(STATUS_KEYWORDS.Thinking.test("Can you explain how this works?")).toBe(true);
  });

  it("infers feelings correctly from text", () => {
    expect(inferFeelingFromText("I am so excited and happy for you!")).toBe("Excited");
    expect(inferFeelingFromText("Haha, that is so funny, love it")).toBe("Happy");
    expect(inferFeelingFromText("Oh you are such a tease, silly")).toBe("Coy");
    expect(inferFeelingFromText("You make me feel so shy and flustered")).toBe("Shy");
    expect(inferFeelingFromText("Thank you so much, I really appreciate this")).toBe("Touched");
    expect(inferFeelingFromText("Here is a warm hug for you")).toBe("Gentle");
    expect(inferFeelingFromText("Be careful, I'm worried about you")).toBe("Worried");
    expect(inferFeelingFromText("I feel so lonely and sad")).toBe("Sad");
    expect(inferFeelingFromText("Let us discuss the roadmap")).toBe("Calm");
  });
});
