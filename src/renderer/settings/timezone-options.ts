// User timezone allowlist. Settings page exposes only the following options;
// saving accepts only values defined here (empty / invalid / unlisted fall back to Asia/Shanghai).
// Display labels follow format "Beijing Time (UTC+08:00)", values use IANA timezone identifiers.
// Main process formatters must validate via resolveChatContextTimezone before Intl consumption.

export interface TimezoneOption {
  label: string;
  value: string;
}

export const TIMEZONE_OPTIONS: readonly TimezoneOption[] = [
  { label: "Beijing Time (UTC+08:00)", value: "Asia/Shanghai" },
  { label: "Tokyo Time (UTC+09:00)", value: "Asia/Tokyo" },
  { label: "Taipei Time (UTC+08:00)", value: "Asia/Taipei" },
  { label: "Seoul Time (UTC+09:00)", value: "Asia/Seoul" },
  { label: "London Time (UTC+00:00)", value: "Europe/London" },
  { label: "New York Time (UTC-05:00)", value: "America/New_York" },
  { label: "Los Angeles Time (UTC-08:00)", value: "America/Los_Angeles" },
] as const;

/** Validation on load: empty string, invalid, or unlisted fall back to Asia/Shanghai. */
export const FALLBACK_TIMEZONE = "Asia/Shanghai";

export function normalizeTimezoneOptionValue(raw: string | null | undefined): string {
  if (!raw) return FALLBACK_TIMEZONE;
  const trimmed = raw.trim();
  if (!trimmed) return FALLBACK_TIMEZONE;
  return TIMEZONE_OPTIONS.some((o) => o.value === trimmed) ? trimmed : FALLBACK_TIMEZONE;
}
