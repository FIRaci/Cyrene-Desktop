type SecretProfile = { apiKey?: unknown; clearApiKey?: unknown; [key: string]: unknown };
type SecretSettings = {
  apiKey?: unknown;
  clearApiKey?: unknown;
  perProvider?: unknown;
  vision?: unknown;
  [key: string]: unknown;
};

function redactProfile(profile: SecretProfile): Record<string, unknown> {
  const { clearApiKey: _clear, ...rest } = profile;
  return { ...rest, apiKey: "", hasKey: typeof profile.apiKey === "string" && profile.apiKey.length > 0 };
}

/** Renderer-safe model settings view. Secret values never cross IPC. */
export function redactModelSettings<T extends object>(value: T): Record<string, unknown> {
  const settings = value as SecretSettings;
  const perProvider: Record<string, unknown> = {};
  if (settings.perProvider && typeof settings.perProvider === "object" && !Array.isArray(settings.perProvider)) {
    for (const [name, profile] of Object.entries(settings.perProvider)) {
      if (profile && typeof profile === "object" && !Array.isArray(profile)) {
        perProvider[name] = redactProfile(profile as SecretProfile);
      }
    }
  }
  const vision = settings.vision && typeof settings.vision === "object" && !Array.isArray(settings.vision)
    ? redactProfile(settings.vision as SecretProfile)
    : undefined;
  const { clearApiKey: _clear, ...rest } = settings;
  return {
    ...rest,
    apiKey: "",
    hasKey: typeof settings.apiKey === "string" && settings.apiKey.length > 0,
    perProvider,
    ...(vision ? { vision } : { vision: undefined }),
  };
}

function mergeSecretProfile(incoming: SecretProfile, existing?: SecretProfile): SecretProfile {
  const next = { ...incoming };
  if (incoming.clearApiKey === true) next.apiKey = "";
  else if (typeof incoming.apiKey !== "string" || incoming.apiKey.trim() === "") next.apiKey = existing?.apiKey;
  delete next.clearApiKey;
  delete next.hasKey;
  return next;
}

/** Restores omitted/redacted secrets while supporting an explicit clear flag. */
export function applyModelSecretPatch<T extends object>(value: T, stored: object): T {
  const incoming = value as SecretSettings;
  const existing = stored as SecretSettings;
  const next: SecretSettings = { ...incoming };
  const incomingProviders = incoming.perProvider;
  const existingProviders = existing.perProvider && typeof existing.perProvider === "object"
    ? existing.perProvider as Record<string, SecretProfile>
    : {};
  if (incomingProviders && typeof incomingProviders === "object" && !Array.isArray(incomingProviders)) {
    next.perProvider = Object.fromEntries(Object.entries(incomingProviders).map(([name, profile]) => [
      name,
      profile && typeof profile === "object" && !Array.isArray(profile)
        ? mergeSecretProfile(profile as SecretProfile, existingProviders[name])
        : profile,
    ]));
  }
  const currentProvider = typeof incoming.provider === "string" ? incoming.provider : existing.provider;
  const existingCurrent = typeof currentProvider === "string" ? existingProviders[currentProvider] : undefined;
  next.apiKey = mergeSecretProfile(incoming, existingCurrent ?? existing).apiKey;
  if (incoming.vision && typeof incoming.vision === "object" && !Array.isArray(incoming.vision)) {
    const existingVision = existing.vision && typeof existing.vision === "object" ? existing.vision as SecretProfile : undefined;
    next.vision = mergeSecretProfile(incoming.vision as SecretProfile, existingVision);
  }
  delete next.clearApiKey;
  delete next.hasKey;
  return next as T;
}
