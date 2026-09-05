// Background LLM call serial queue + rate-limit automatic retry.
//
// Background: After primary chat ends, MemoryJudge and mood observer make concurrent LLM requests,
// hitting provider RPM limits on the same key.
//
// Design:
// - Main chat is NOT enqueued (user experience priority, immediate execution)
// - Background LLM calls (MemoryJudge / mood observer / future Reflection) enqueued FIFO sequentially
// - Detects rate-limit errors in queue, backs off 5s and retries once; other errors dropped
// - Self-contained lightweight queue

const LOG_PREFIX = "[LLMQueue]";
const RETRY_DELAY_MS = 5_000;

/** Rate-limit error keywords. Any match is considered retryable. */
const RATE_LIMIT_KEYWORDS = [
  "rate limit",
  "\u901f\u7387\u9650\u5236",
  "\u9891\u7387",
  "too many requests",
  "429",
  "rate_limit",
  "ratelimit",
];

/** Determines if error is rate-limiting (retryable with backoff). */
function isRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  return RATE_LIMIT_KEYWORDS.some(k => lower.includes(k.toLowerCase()));
}

// Queue internally uses a promise chain to achieve FIFO sequential execution.
// Each enqueue appends task after tail, updating tail to this task.
// Sequential execution is natural and lock-free.
let tail: Promise<unknown> = Promise.resolve();

/**
 * Enqueues a background LLM task. FIFO sequential execution; backs off 5s and retries once on rate limit.
 *
 * @param label Task name (for logging)
 * @param task  Task function returning Promise
 * @returns Promise of task result; rejects on failure for caller to handle
 */
export function enqueueLLMTask<T>(
  label: string,
  task: () => Promise<T>,
  options: { log?: boolean; retryRateLimit?: boolean } = {},
): Promise<T> {
  const next = tail.then(async (): Promise<T> => {
    return runWithRetry(
      label,
      task,
      options.log !== false,
      options.retryRateLimit !== false,
    );
  });
  // tail must catch errors to prevent broken chains from blocking subsequent tasks
  tail = next.catch(() => {
    // Swallow error to maintain chain; caller still receives reject from next
  });
  return next;
}

/** Executes task, backing off 5s and retrying once on rate limits. */
async function runWithRetry<T>(
  label: string,
  task: () => Promise<T>,
  logEnabled: boolean,
  retryRateLimit: boolean,
): Promise<T> {
  const startedAt = Date.now();
  if (logEnabled) console.log(LOG_PREFIX, "Starting execution:", label);
  try {
    const result = await task();
    if (logEnabled) console.log(LOG_PREFIX, "Completed:", label, "duration=" + (Date.now() - startedAt) + "ms");
    return result;
  } catch (err) {
    if (!retryRateLimit || !isRateLimitError(err)) {
      // Non-rate-limit error: throw directly without retry
      if (logEnabled) console.warn(LOG_PREFIX, "Failed (not rate-limited, no retry):", label, err instanceof Error ? err.message : String(err));
      throw err;
    }
    // Rate limit: back off 5s and retry once
    if (logEnabled) console.warn(LOG_PREFIX, "Rate-limited, retrying in " + (RETRY_DELAY_MS / 1000) + "s:", label);
    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
    try {
      const result = await task();
      if (logEnabled) console.log(LOG_PREFIX, "Retry succeeded:", label, "total duration=" + (Date.now() - startedAt) + "ms");
      return result;
    } catch (retryErr) {
      if (logEnabled) console.error(LOG_PREFIX, "Retry still failed, giving up:", label, retryErr instanceof Error ? retryErr.message : String(retryErr));
      throw retryErr;
    }
  }
}
