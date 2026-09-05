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
      showContextMenu?: () => void;
      onToggleMiniChat?: (callback: () => void) => () => void;
      onToggleVoice?: (callback: () => void) => () => void;
      toggleCoWatch?: () => Promise<unknown>;
      getCoWatchState?: () => Promise<{ active: boolean; status?: string; lastCapturedAt?: number; lastReaction?: string; errorMessage?: string }>;
      onCoWatchStateChanged?: (callback: (state: { active: boolean; status?: string; lastCapturedAt?: number; lastReaction?: string; errorMessage?: string }) => void) => () => void;
    };
    activityLog?: {
      getEntries: () => Promise<Array<{ timestamp: number; type: string; text: string; channel?: string; meta?: unknown }>>;
      onEntry: (callback: (entry: { timestamp: number; type: string; text: string; channel?: string; meta?: unknown }) => void) => () => void;
      onCleared?: (callback: () => void) => () => void;
      pushEntry?: (entry: { type: string; text: string; channel?: string; meta?: unknown }) => Promise<{ success: boolean }>;
      clear?: () => Promise<{ success: boolean }>;
      minimize: () => void;
      close: () => void;
    };
    updater?: {
      checkForUpdates: () => Promise<{
        hasUpdate: boolean;
        currentVersion: string;
        latestVersion: string;
        releaseName?: string;
        releaseNotes?: string;
        downloadUrl?: string;
        error?: string;
      }>;
    };
    petCompanion?: {
      onAgentEvent: (callback: (event: import("../live2d/companion-bubbles").PetAgentEvent) => void) => () => void;
    };
  }
}

