// Travel tools: route planning (driving/walking/cycling/transit).
//
// Keyless global routing powered by Open-Meteo Geocoding & coordinate calculations.
// Zero domestic Chinese dependencies or API keys required.

import { toolRegistry } from "./tool-registry";

const LOG_PREFIX = "[TravelTools]";
const TRAVEL_TIMEOUT_MS = 15000;

// ══════════════════════════════════════════════════════════
// Config injection
// ══════════════════════════════════════════════════════════

let travelEnabledGetter: (() => boolean) | null = null;

/** Injected travel config getter on startup. amapKeyFn kept for backwards compatibility. */
export function setTravelConfig(_amapKeyFn?: () => string, enabledFn?: () => boolean): void {
  travelEnabledGetter = enabledFn ?? null;
}

// ══════════════════════════════════════════════════════════
// Keyless global routing and geocoding
// ══════════════════════════════════════════════════════════

interface GlobalLocation {
  name: string;
  country?: string;
  lat: number;
  lon: number;
}

async function geocodeGlobal(name: string): Promise<GlobalLocation | null> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=en&format=json`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TRAVEL_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    if (!resp.ok) return null;
    const data = await resp.json() as { results?: Array<{ name: string; country?: string; latitude: number; longitude: number }> };
    if (!data.results || data.results.length === 0) return null;
    const item = data.results[0];
    return { name: item.name, country: item.country, lat: item.latitude, lon: item.longitude };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function calculateGreatCircleKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function planGlobalTrip(originName: string, destName: string, mode: string): Promise<string> {
  console.log(LOG_PREFIX, `Planning global route: "${originName}" → "${destName}", mode=${mode}`);
  const [orig, dest] = await Promise.all([geocodeGlobal(originName), geocodeGlobal(destName)]);
  if (!orig) return `[Error] Could not locate the origin "${originName}". Try a more specific city or place name.`;
  if (!dest) return `[Error] Could not locate the destination "${destName}". Try a more specific city or place name.`;

  const directKm = calculateGreatCircleKm(orig.lat, orig.lon, dest.lat, dest.lon);
  const roadKm = directKm * 1.3;

  let speedKmH = 60;
  let modeIcon = "🚗";
  let modeLabel = "Driving route";

  if (mode === "walking") {
    speedKmH = 4.5;
    modeIcon = "🚶";
    modeLabel = "Walking route";
  } else if (mode === "cycling") {
    speedKmH = 15;
    modeIcon = "🚲";
    modeLabel = "Cycling route";
  } else if (mode === "transit") {
    speedKmH = 45;
    modeIcon = "🚌";
    modeLabel = "Transit route";
  }

  const durHours = roadKm / speedKmH;
  const durMin = Math.round(durHours * 60);
  const durStr = durMin >= 60
    ? `${Math.floor(durMin / 60)} hours ${durMin % 60} minutes`
    : `${durMin} minutes`;

  const origCountry = orig.country ? ` (${orig.country})` : "";
  const destCountry = dest.country ? ` (${dest.country})` : "";

  return [
    `${modeIcon} ${modeLabel} (Global Routing)`,
    `Origin: ${orig.name}${origCountry}`,
    `Destination: ${dest.name}${destCountry}`,
    `Estimated road distance: ~${roadKm.toFixed(1)} km`,
    `Estimated duration: ${durStr}`,
    "Route note: Calculated via worldwide geographic coordinates. For live GPS turn-by-turn guidance, open Google Maps.",
  ].join("\n");
}

async function executePlanTrip(args: Record<string, unknown>): Promise<string> {
  if (travelEnabledGetter && !travelEnabledGetter()) {
    return "[Error] Travel tools are disabled. Please enable them in Settings.";
  }

  const origin = String(args.origin ?? "").trim();
  const destination = String(args.destination ?? "").trim();
  if (!origin || !destination) {
    return "[Error] Please provide both an origin and a destination";
  }

  const rawMode = String(args.mode ?? "driving").trim();
  const legacyModes: Readonly<Record<string, string>> = {
    "\u9a7e\u8f66": "driving", "\u5f00\u8f66": "driving",
    "\u6b65\u884c": "walking", "\u8d70\u8def": "walking",
    "\u9a91\u884c": "cycling", "\u9a91\u8f66": "cycling", "\u81ea\u884c\u8f66": "cycling",
    "\u516c\u4ea4": "transit", "\u516c\u5171\u4ea4\u901a": "transit", "\u5730\u94c1": "transit", "\u516c\u4ea4\u5730\u94c1": "transit",
  };
  const mode = legacyModes[rawMode] ?? rawMode.toLowerCase();

  return planGlobalTrip(origin, destination, mode);
}

// ══════════════════════════════════════════════════════════
// Registration
// ══════════════════════════════════════════════════════════

/** Register travel tools on startup. */
export function registerTravelTools(): void {
  toolRegistry.register({
    id: "plan_trip",
    name: "🚗 Travel planner",
    description:
      "Plan driving, walking, cycling, or public-transit routes, including distance and estimated duration.\n\n" +
      "Use when the user asks how to travel from one place to another, how far away a destination is, how long a trip takes, or what a taxi may cost.\n\n" +
      "Do not use for weather, detailed transit timetables, or live traffic conditions.\n\n" +
      "Parameters:\n" +
      "- origin (required): starting place, such as 'Hanoi' or a city/street address\n" +
      "- destination (required): destination place\n" +
      "- mode (optional, default driving): driving, walking, cycling, or transit\n" +
      "- city (optional): city name for local transit",
    enabled: true,
    risk: "network",
    inputSchema: {
      type: "object",
      properties: {
        origin: {
          type: "string",
          description: "Starting location name or address",
        },
        destination: {
          type: "string",
          description: "Destination location name or address",
        },
        mode: {
          type: "string",
          enum: ["driving", "walking", "cycling", "transit"],
          description: "Travel mode, default driving",
        },
        city: {
          type: "string",
          description: "Optional city context",
        },
      },
      required: ["origin", "destination"],
    },
    execute: executePlanTrip,
  });
}
