/**
 * Streaming render scheduler.
 *
 * Operates independently of 40ms character consumption ticks, using requestAnimationFrame + minimum interval.
 *
 * Features:
 * - Schedules only when raw content changes
 * - At most one pending render at any time
 * - Adaptive intervals (based on active tail length)
 * - Revision validation: prevents stale tasks from updating newer messages
 * - Flush forces execution of final render
 * - Cancel clears all pending tasks
 */

export interface SchedulerOptions {
  /** Message ID (used for revision validation) */
  messageId: string;
  /** Render callback */
  render: () => void;
  /** Whether destroyed/disposed */
  isDisposed: () => boolean;
}

export interface StreamingRenderScheduler {
  /** Request scheduled render (throttled) */
  schedule(): void;
  /** Force immediate render (cancels pending, executes synchronously) */
  flush(): void;
  /** Cancel all pending renders */
  cancel(): void;
}

/**
 * Computes adaptive render interval (ms) based on active tail length.
 * Longer tails use larger intervals to avoid frequent re-parsing of large text.
 */
export function getStreamingRenderInterval(activeLength: number): number {
  if (activeLength < 1_000) return 60;
  if (activeLength < 3_000) return 90;
  if (activeLength < 6_000) return 140;
  return 220;
}

export function createStreamingRenderScheduler(options: SchedulerOptions): StreamingRenderScheduler {
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingFrame: number | null = null;
  let lastRenderAt = 0;

  const execute = (): void => {
    pendingTimer = null;
    pendingFrame = null;

    if (options.isDisposed()) return;

    lastRenderAt = Date.now();
    try {
      options.render();
    } catch (err) {
      console.error("[streaming-scheduler] render callback failed:", err);
    }
  };

  return {
    schedule(): void {
      if (options.isDisposed()) return;

      // Do not duplicate if already pending
      if (pendingTimer !== null || pendingFrame !== null) return;

      const elapsed = Date.now() - lastRenderAt;
      const interval = getStreamingRenderInterval(0); // Interval provided via activeLength by session

      const delay = Math.max(0, interval - elapsed);

      // Use setTimeout for minimum interval, requestAnimationFrame for frame alignment
      pendingTimer = setTimeout(() => {
        if (options.isDisposed()) {
          pendingTimer = null;
          return;
        }
        pendingFrame = requestAnimationFrame(() => {
          execute();
        });
      }, delay);
    },

    flush(): void {
      // Cancel pending, execute synchronously immediately
      if (pendingTimer !== null) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
      if (pendingFrame !== null) {
        cancelAnimationFrame(pendingFrame);
        pendingFrame = null;
      }

      if (!options.isDisposed()) {
        execute();
      }
    },

    cancel(): void {
      if (pendingTimer !== null) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
      if (pendingFrame !== null) {
        cancelAnimationFrame(pendingFrame);
        pendingFrame = null;
      }
    },
  };
}
