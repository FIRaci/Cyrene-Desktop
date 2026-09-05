/**
 * Renderer asset path helper
 *
 * Problem: vite base './' + electron loadFile -> under file:// protocol
 *   fetch("/models/cyrene/...") resolves to disk root, not dist/renderer/.
 *
 * Solution: calculate renderer root with document.baseURI + import.meta.env.BASE_URL,
 *   then join paths. Both dev mode and sub-window paths resolve correctly.
 */

let cachedBase = "";

function computeRendererBase(): string {
  const viteBase = import.meta.env.BASE_URL; // dev: "/"  prod: "./"
  const docBase = document.baseURI;          // URL of current HTML document

  // Resolve with URL: new URL(relative, base)
  // Dev mode: new URL("/", "http://localhost:5173/chat/index.html")
  //   -> http://localhost:5173/  renderer root
  // Production root window: new URL("./", "file:///.../dist/renderer/index.html")
  //   → file:///.../dist/renderer/  ✅
  // Production chat window: new URL("./", "file:///.../dist/renderer/chat/index.html")
  //   -> file:///.../dist/renderer/chat/  needs to go up one level
  let root = new URL(viteBase, docBase).href;

  // In prod mode vite base is "./"; sub-directory windows need to go up one level
  // Check: if root ends with chat/ sidebar/ tasks/ settings/ call/ sticker-manager/, go up one level
  if (viteBase === "./") {
    const subDirs = ["chat/", "sidebar/", "tasks/", "settings/", "call/", "sticker-manager/"];
    for (const sub of subDirs) {
      if (root.endsWith("/" + sub)) {
        root = root.replace(/[^/]+\/$/, "");
        break;
      }
    }
  }

  return root;
}

/**
 * Returns URL of renderer root directory (with trailing /).
 * Computed on first call, then cached.
 */
export function getRendererBase(): string {
  if (!cachedBase) {
    cachedBase = computeRendererBase();
  }
  return cachedBase;
}

/**
 * Resolves "models/cyrene/Cyrene.model3.json" or "/models/cyrene/Cyrene.model3.json"
 * to full file:// or http:// URL.
 */
export function resolveAsset(assetPath: string): string {
  const clean = assetPath.replace(/^\/+/, ""); // Remove leading /
  return getRendererBase() + clean;
}
