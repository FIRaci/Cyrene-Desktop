/**
 * Streaming Markdown rendering session.
 *
 * Maintains an independent session for each streaming assistant message.
 *
 * DOM structure:
 * <div class="markdown-stream">
 *   <div class="markdown-stream__stable"></div>   ← committed blocks (append-only)
 *   <div class="markdown-stream__active"></div>    ← mutable tail (replaceable)
 * </div>
 *
 * Flow:
 *   delta arrives -> session.append(delta) -> scheduleRender()
 *   throttled render -> parse blocks -> split committed/mutable
 *   -> new committed blocks rendered and appended to stableRoot
 *   -> mutable tail rendered and written to activeRoot
 *   stream ends -> flush() -> cancel timers
 *   final state -> render() full replacement (controlled by main.ts)
 */

import type MarkdownIt from "markdown-it";
import {
  parseStreamingBlocks,
  splitCommittedAndMutable,
  type StreamMarkdownBlock,
} from "./streaming-block-parser";
import { renderCommittedBlock, renderMutableTail, blockChanged } from "./streaming-block-renderer";
import {
  createStreamingRenderScheduler,
  getStreamingRenderInterval,
  type StreamingRenderScheduler,
} from "./streaming-render-scheduler";

export interface StreamingMarkdownSession {
  /** Message ID */
  messageId: string;
  /** Revision counter (incremented on each append to prevent stale writes) */
  revision: number;
  /** Accumulated raw markdown text */
  raw: string;
  /** Whether destroyed/disposed */
  disposed: boolean;

  /** Append delta text */
  append(delta: string): void;
  /** Force flush final render */
  flush(): void;
  /** Destroy session and cancel pending renders */
  dispose(): void;
}

/**
 * Creates a streaming Markdown rendering session.
 *
 * @param md markdown-it instance (configured with KaTeX + custom fence renderer)
 * @param bubble Message bubble DOM element (session creates stable/active roots inside)
 * @param messageId Message ID
 * @param scrollContainer Scroll container (for scroll anchoring), optional
 */
export function createStreamingMarkdownSession(
  md: MarkdownIt,
  bubble: HTMLElement,
  messageId: string,
  scrollContainer?: HTMLElement,
): StreamingMarkdownSession {
  let revision = 0;
  let raw = "";
  let disposed = false;

  // Committed blocks from previous parse (for fingerprint comparison)
  let lastCommitted: StreamMarkdownBlock[] = [];
  let lastActiveHtml = "";
  let renderFailureCount = 0;
  let degraded = false;
  /** Rendered character offset of committed portion (prevents duplicate display upon fallback) */
  let committedOffset = 0;

  // Create DOM structure
  bubble.hidden = false;
  bubble.innerHTML = "";

  const streamRoot = document.createElement("div");
  streamRoot.className = "markdown-stream";

  const stableRoot = document.createElement("div");
  stableRoot.className = "markdown-stream__stable";

  const activeRoot = document.createElement("div");
  activeRoot.className = "markdown-stream__active";

  streamRoot.appendChild(stableRoot);
  streamRoot.appendChild(activeRoot);
  bubble.appendChild(streamRoot);

  // Scroll protection
  const isNearBottom = (): boolean => {
    if (!scrollContainer) return true;
    const threshold = 100;
    return scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight < threshold;
  };

  const followScroll = (): void => {
    if (isNearBottom()) {
      scrollContainer!.scrollTop = scrollContainer!.scrollHeight;
    }
  };

  // Scheduler
  const scheduler: StreamingRenderScheduler = createStreamingRenderScheduler({
    messageId,
    render: doRender,
    isDisposed: () => disposed,
  });

  function doRender(): void {
    if (disposed) return;

    // Degraded mode: entire message rendered as textContent without block reconciliation
    if (degraded) {
      return; // Final render() takes over
    }

    try {
      const currentRevision = revision;

      // Parse blocks
      let blocks: StreamMarkdownBlock[];
      try {
        blocks = parseStreamingBlocks(md, raw);
      } catch (parseErr) {
        console.error("[streaming-session] parseStreamingBlocks failed:", parseErr);
        renderFailureCount++;
        checkDegraded();
        // Fallback: update activeRoot only (excluding committed portions to prevent duplication)
        const activeRaw = raw.slice(committedOffset);
        activeRoot.textContent = activeRaw;
        return;
      }

      const { committed, mutable } = splitCommittedAndMutable(blocks, 2);

      // Process newly committed blocks (append new ones only)
      const newCommitted = committed.slice(lastCommitted.length);
      for (const block of newCommitted) {
        const html = renderCommittedBlock(md, block);
        if (html) {
          const wrapper = document.createElement("div");
          wrapper.innerHTML = html;
          while (wrapper.firstChild) {
            stableRoot.appendChild(wrapper.firstChild);
          }
        }
        committedOffset = block.endOffset;
      }
      lastCommitted = committed;

      // Render mutable tail
      const activeHtml = renderMutableTail(md, mutable);
      if (activeHtml !== lastActiveHtml) {
        activeRoot.innerHTML = activeHtml;
        lastActiveHtml = activeHtml;
      }

      // Successful render resets failure count
      renderFailureCount = 0;

      followScroll();
    } catch (err) {
      console.error("[streaming-session] doRender failed:", err);
      renderFailureCount++;
      checkDegraded();

      // Fallback: update activeRoot only
      try {
        const activeRaw = raw.slice(committedOffset);
        activeRoot.textContent = activeRaw;
      } catch {
        // Safe catch-all
      }
    }
  }

  /** Check whether degraded fallback mode is needed (3 consecutive failures) */
  function checkDegraded(): void {
    if (renderFailureCount >= 3 && !degraded) {
      degraded = true;
      console.warn("[streaming-session] Rendering failed three times; entering fallback mode");
      // Clear stableRoot and use full raw as textContent
      stableRoot.innerHTML = "";
      activeRoot.textContent = raw;
      committedOffset = 0;
    }
  }

  return {
    messageId,
    get revision() { return revision; },
    get raw() { return raw; },
    get disposed() { return disposed; },

    append(delta: string): void {
      if (disposed) return;
      raw += delta;
      revision++;
      scheduler.schedule();
    },

    flush(): void {
      if (disposed) return;
      scheduler.flush();
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      scheduler.cancel();
    },
  };
}

export { getStreamingRenderInterval };
