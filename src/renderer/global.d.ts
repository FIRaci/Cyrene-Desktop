// Global type augmentations for renderer

interface SystemApi {
  openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>;
}

declare global {
  interface Window {
    system?: SystemApi;
  }
}

// Vite ?raw import: inline .md files as strings (used by renderMarkdown)
declare module "*.md?raw" {
  const content: string;
  export default content;
}

export {};
