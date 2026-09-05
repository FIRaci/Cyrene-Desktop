const MINIMAX_PROVIDERS = new Set(["MiniMax", "MiniMax\uff08\u7a00\u5b87\u79d1\u6280\uff09"]);
const LEGACY_ANTHROPIC_DEFAULT = "https://api.minimaxi.com/anthropic";
const OPENAI_DEFAULT = "https://api.minimaxi.com/v1";

type TransportPreference = "openai" | "anthropic" | "auto";

/** Migrate only the old shipped default; an explicit Anthropic choice remains authoritative. */
export function migrateLegacyMinimaxDefaults<T extends {
  baseUrl: string;
  explicitTransport?: TransportPreference;
}>(provider: string, profile: T): T {
  if (
    !MINIMAX_PROVIDERS.has(provider)
    || profile.baseUrl !== LEGACY_ANTHROPIC_DEFAULT
    || profile.explicitTransport === "anthropic"
  ) return profile;
  return { ...profile, baseUrl: OPENAI_DEFAULT };
}
