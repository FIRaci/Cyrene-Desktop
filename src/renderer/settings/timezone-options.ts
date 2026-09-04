// 用户Timezone白名单。Settings页只暴露下列选项；保存时只接受这里的 value（空串/非法/不在白名单一律回退 Asia/Shanghai）。
// 显示 label 形如"Beijing Time (UTC+08:00)"，value 用 IANA Timezone名。
// 任何主进程格式化位置都不直接吃 profile.timezone，必须先经 resolveChatContextTimezone 校验再喂 Intl。

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

/** 加载时校验：空串/非法/不在白名单都回退 Asia/Shanghai。 */
export const FALLBACK_TIMEZONE = "Asia/Shanghai";

export function normalizeTimezoneOptionValue(raw: string | null | undefined): string {
  if (!raw) return FALLBACK_TIMEZONE;
  const trimmed = raw.trim();
  if (!trimmed) return FALLBACK_TIMEZONE;
  return TIMEZONE_OPTIONS.some((o) => o.value === trimmed) ? trimmed : FALLBACK_TIMEZONE;
}