export {};

declare global {
  interface Window {
    cyrene: {
      minimize: () => void;
      hide: () => void;
      quit: () => void;
      setInteractive: (interactive: boolean) => Promise<void>;
      moveBy: (dx: number, dy: number) => void;
      moveTo: (x: number, y: number) => void;
      setDragging: (isDragging: boolean) => void;
      captureFrame: () => Promise<string | null>;
      getCursorPosition: () => Promise<{ x: number; y: number } | null>;
      setPetZoom: (zoom: number) => void;
      onPetZoom: (callback: (zoom: number) => void) => () => void;
      onPetVisibilityChanged: (callback: (visible: boolean) => void) => () => void;
    };
    petCompanion?: {
      onAgentEvent: (callback: (event: import("../live2d/companion-bubbles").PetAgentEvent) => void) => () => void;
    };
  }
}
