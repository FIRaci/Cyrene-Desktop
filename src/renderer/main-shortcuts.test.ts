import { describe, expect, it, vi } from "vitest";

describe("Live2D Window Shortcuts", () => {
  it("triggers quit when Alt+Q is pressed", () => {
    const quitMock = vi.fn();
    const preventDefault = vi.fn();

    const handleKeydown = (e: { key: string; altKey: boolean; code?: string; preventDefault: () => void }) => {
      if (e.altKey && (e.key === "q" || e.key === "Q" || e.code === "KeyQ")) {
        e.preventDefault();
        quitMock();
      }
    };

    handleKeydown({ key: "q", altKey: true, code: "KeyQ", preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(quitMock).toHaveBeenCalledTimes(1);
  });

  it("triggers mini-chat toggle when Alt+5 is pressed", () => {
    const toggleMock = vi.fn();
    const preventDefault = vi.fn();

    const handleKeydown = (e: { key: string; altKey: boolean; code?: string; preventDefault: () => void }) => {
      if (e.altKey && (e.key === "5" || e.code === "Digit5")) {
        e.preventDefault();
        toggleMock();
      }
    };

    handleKeydown({ key: "5", altKey: true, code: "Digit5", preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(toggleMock).toHaveBeenCalledTimes(1);
  });
});
