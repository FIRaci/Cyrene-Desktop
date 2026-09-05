// Travel tools: route planning (driving/walking/cycling/transit).
//
// Design principles:
// - Reuses amapKey from GeneralSettings
// - Uses geocoding to convert names to coordinates, then calls routing API
// - Returns readable route description
// - Zero new dependencies, reuses global fetch

import { toolRegistry } from "./tool-registry";

const LOG_PREFIX = "[TravelTools]";
const TRAVEL_TIMEOUT_MS = 15000;

// ══════════════════════════════════════════════════════════
// Config injection
// ══════════════════════════════════════════════════════════

let amapKeyGetter: (() => string) | null = null;
let travelEnabledGetter: (() => boolean) | null = null;

/** Injected amapKey getter on startup. */
export function setTravelConfig(amapKeyFn: () => string, enabledFn?: () => boolean): void {
  amapKeyGetter = amapKeyFn;
  travelEnabledGetter = enabledFn ?? null;
}

// ══════════════════════════════════════════════════════════
// Amap geocoding: place name -> "longitude,latitude"
// ══════════════════════════════════════════════════════════

async function geocode(address: string, key: string): Promise<string | null> {
  const url = `https://restapi.amap.com/v3/geocode/geo?address=${encodeURIComponent(address)}&output=JSON&key=${key}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TRAVEL_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    if (!resp.ok) return null;
    const data = await resp.json() as { status?: string; geocodes?: Array<{ location: string }> };
    if (data.status !== "1" || !data.geocodes || data.geocodes.length === 0) return null;
    return data.geocodes[0].location; // Format "116.397428,39.90923"
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ══════════════════════════════════════════════════════════
// Routing API wrappers
// ══════════════════════════════════════════════════════════

/** Driving route planning. */
async function planDriving(origin: string, destination: string, key: string): Promise<string> {
  const url = `https://restapi.amap.com/v3/direction/driving?origin=${origin}&destination=${destination}&extensions=base&strategy=0&key=${key}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TRAVEL_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    if (!resp.ok) return `[Error] Driving route request failed: HTTP ${resp.status}`;
    const data = await resp.json() as {
      route?: { paths?: Array<{ distance: string; duration: string; tolls: string; toll_distance: string; traffic_lights: string }> };
    };
    if (!data.route?.paths?.length) return "[Error] No driving route was found";
    const path = data.route.paths[0];
    const distKm = (Number(path.distance) / 1000).toFixed(1);
    const durMin = Math.round(Number(path.duration) / 60);
    const toll = Number(path.tolls);
    const lines = [
      "🚗 Driving route",
      `Distance: ${distKm} km`,
      `Estimated duration: ${durMin} minutes`,
      toll > 0 ? `Tolls: CNY ${toll.toFixed(0)}` : "Tolls: none",
      `Traffic lights: ${path.traffic_lights || 0}`,
    ];
    return lines.join("\n");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return "[Error] Driving route request failed: " + msg;
  } finally {
    clearTimeout(timer);
  }
}

/** Walking route planning (up to 100km). */
async function planWalking(origin: string, destination: string, key: string): Promise<string> {
  const url = `https://restapi.amap.com/v3/direction/walking?origin=${origin}&destination=${destination}&key=${key}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TRAVEL_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    if (!resp.ok) return `[Error] Walking route request failed: HTTP ${resp.status}`;
    const data = await resp.json() as {
      route?: { paths?: Array<{ distance: string; duration: string }> };
    };
    if (!data.route?.paths?.length) return "[Error] No walking route was found";
    const path = data.route.paths[0];
    const distM = Number(path.distance);
    const durMin = Math.round(Number(path.duration) / 60);
    const distStr = distM >= 1000 ? `${(distM / 1000).toFixed(1)} km` : `${distM.toFixed(0)} m`;
    return [
      "🚶 Walking route",
      `Distance: ${distStr}`,
      `Estimated duration: ${durMin} minutes`,
    ].join("\n");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return "[Error] Walking route request failed: " + msg;
  } finally {
    clearTimeout(timer);
  }
}

/** Cycling route planning (up to 500km). */
async function planCycling(origin: string, destination: string, key: string): Promise<string> {
  const url = `https://restapi.amap.com/v4/direction/bicycling?origin=${origin}&destination=${destination}&key=${key}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TRAVEL_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    if (!resp.ok) return `[Error] Cycling route request failed: HTTP ${resp.status}`;
    const data = await resp.json() as {
      data?: { paths?: Array<{ distance: string; duration: string }> };
    };
    if (!data.data?.paths?.length) return "[Error] No cycling route was found";
    const path = data.data.paths[0];
    const distKm = (Number(path.distance) / 1000).toFixed(1);
    const durMin = Math.round(Number(path.duration) / 60);
    return [
      "🚲 Cycling route",
      `Distance: ${distKm} km`,
      `Estimated duration: ${durMin} minutes`,
    ].join("\n");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return "[Error] Cycling route request failed: " + msg;
  } finally {
    clearTimeout(timer);
  }
}

/** Transit route planning (bus/subway/rail transfers). */
async function planTransit(
  origin: string,
  destination: string,
  city: string,
  key: string,
): Promise<string> {
  const url = `https://restapi.amap.com/v3/direction/transit/integrated?origin=${origin}&destination=${destination}&city=${encodeURIComponent(city)}&strategy=0&extensions=base&key=${key}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TRAVEL_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    if (!resp.ok) return `[Error] Transit route request failed: HTTP ${resp.status}`;
    const data = await resp.json() as {
      route?: { transits?: Array<{
        cost: string; duration: string; walking_distance: string;
        segments?: Array<{
          walking?: { distance: string; duration: string };
          bus?: { buslines?: Array<{ name: string; depart_stop: { name: string }; arrival_stop: { name: string } }> };
        }>;
      }>; taxi_cost?: string };
    };
    if (!data.route?.transits?.length) return "[Error] No transit route was found";
    const transit = data.route.transits[0];
    const durMin = Math.round(Number(transit.duration) / 60);
    const price = Number(transit.cost).toFixed(0);
    const walkDist = Number(transit.walking_distance);
    const walkStr = walkDist > 0 ? ` (including ${walkDist.toFixed(0)} m on foot)` : "";

    // Extract transfer plan summary
    const steps = transit.segments?.map((seg, i) => {
      if (seg.bus?.buslines?.length) {
        const bus = seg.bus.buslines[0];
        return `  ${i + 1}. Take ${bus.name}: ${bus.depart_stop.name} → ${bus.arrival_stop.name}`;
      }
      if (seg.walking) {
        return `  ${i + 1}. Walk ${Number(seg.walking.distance).toFixed(0)} m`;
      }
      return "";
    }).filter(Boolean) || [];

    const lines = [
      "🚌 Transit route",
      `Estimated duration: ${durMin} minutes`,
      `Fare: CNY ${price}${walkStr}`,
      data.route.taxi_cost ? `Estimated taxi fare: CNY ${data.route.taxi_cost}` : "",
      ...(steps.length ? ["Directions:", ...steps] : []),
    ].filter(Boolean);

    return lines.join("\n");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return "[Error] Transit route request failed: " + msg;
  } finally {
    clearTimeout(timer);
  }
}

// ══════════════════════════════════════════════════════════
// Tool entrypoint
// ══════════════════════════════════════════════════════════


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

  const amapKey = amapKeyGetter?.() ?? "";
  if (amapKey && !amapKey.startsWith("AIza")) {
    const [origLoc, destLoc] = await Promise.all([
      geocode(origin, amapKey),
      geocode(destination, amapKey),
    ]);
    if (origLoc && destLoc) {
      console.log(LOG_PREFIX, `Planning AMap route: "${origin}" → "${destination}", mode=${mode}`);
      switch (mode) {
        case "driving":
          return planDriving(origLoc, destLoc, amapKey);
        case "walking":
          return planWalking(origLoc, destLoc, amapKey);
        case "cycling":
          return planCycling(origLoc, destLoc, amapKey);
        case "transit": {
          const city = String(args.city ?? "").trim();
          if (!city) return "[Error] Transit routes require the city parameter, for example city='Beijing'";
          return planTransit(origLoc, destLoc, city, amapKey);
        }
      }
    }
  }

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
      "- origin (required): starting place, such as 'Forbidden City' or a full street address\n" +
      "- destination (required): destination place\n" +
      "- mode (optional, default driving): driving, walking, cycling, or transit\n" +
      "- city (required for transit only): city name, such as 'Beijing' or 'Shanghai'",
    enabled: true,
    risk: "network",
    inputSchema: {
      type: "object",
      properties: {
        origin:       { type: "string", description: "Starting place or address" },
        destination:  { type: "string", description: "Destination place or address" },
        mode:         { type: "string", enum: ["driving", "walking", "cycling", "transit"], description: "Travel mode (defaults to driving)" },
        city:         { type: "string", description: "City name; required for transit routes" },
      },
      required: ["origin", "destination"],
    },
    execute: executePlanTrip,
  });

  console.log(LOG_PREFIX, "Registered: plan_trip (🚗 Travel tool)");
}
