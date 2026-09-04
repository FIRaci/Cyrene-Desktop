/**
 * Code-block copy button event delegation.
 *
 * Call `initCodeBlockController(messagesContainer)` once during chat initialization
 * to register one click delegate on the message-list root.
 * Do not bind again for every message or render.
 *
 * When .code-block__copy is clicked:
 * 1. Find .code-block__code > pre > code within the same block.
 * 2. Read textContent (the source code, not highlighted HTML).
 * 3. Write it to the clipboard.
 * 4. Briefly show the copied state, then restore the label.
 */

const COPY_TEXT = "Copy";
const COPIED_TEXT = "Copied";
const COPIED_RESTORE_MS = 2000;

/**
 * Initialize copy-button delegation on the specified root node.
 * This should be called only once.
 */
export function initCodeBlockController(rootEl: HTMLElement): void {
  rootEl.addEventListener("click", async (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;

    const copyBtn = target.closest(".code-block__copy") as HTMLElement | null;
    if (!copyBtn) return;

    const codeBlock = copyBtn.closest(".code-block") as HTMLElement | null;
    if (!codeBlock) return;

    // Read the source text from .code-block__code > pre > code.
    const codeContainer = codeBlock.querySelector(".code-block__code");
    if (!codeContainer) return;

    const codeEl = codeContainer.querySelector("code") || codeContainer.querySelector("pre");
    if (!codeEl) return;

    const rawText = codeEl.textContent ?? "";
    if (!rawText) return;

    try {
      await navigator.clipboard.writeText(rawText);
      copyBtn.textContent = COPIED_TEXT;
      copyBtn.classList.add("is-copied");

      setTimeout(() => {
        copyBtn.textContent = COPY_TEXT;
        copyBtn.classList.remove("is-copied");
      }, COPIED_RESTORE_MS);
    } catch (err) {
      console.error("[code-block] Copy failed:", err);
      copyBtn.textContent = "Copy failed";

      setTimeout(() => {
        copyBtn.textContent = COPY_TEXT;
      }, COPIED_RESTORE_MS);
    }
  });
}
