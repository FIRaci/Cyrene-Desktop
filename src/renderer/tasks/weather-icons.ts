/**
 * Professional SVG Vector Icons for Hanoi Weather Telemetry
 * Replaces system emojis with sleek, high-fidelity vector icons matching Cyrene's theme.
 */

export const LOCATION_PIN_SVG = `<svg class="weather-svg-pin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <defs>
    <linearGradient id="cyrene-pin-grad" x1="4" y1="2" x2="20" y2="22" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#f472b6" />
      <stop offset="100%" stop-color="#db2777" />
    </linearGradient>
  </defs>
  <path d="M12 21.5C12 21.5 5 15.5 5 10A7 7 0 0 1 19 10C19 15.5 12 21.5 12 21.5Z" fill="url(#cyrene-pin-grad)" stroke="#f472b6" />
  <circle cx="12" cy="10" r="2.5" fill="#ffffff" stroke="none" />
</svg>`;

export function getWeatherIconSvg(code: number, _text?: string): string {
  // Clear Sky
  if (code === 0) {
    return `<svg class="weather-svg-icon weather-svg-sun" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs>
        <radialGradient id="sun-grad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#fde047" />
          <stop offset="100%" stop-color="#f59e0b" />
        </radialGradient>
      </defs>
      <circle cx="12" cy="12" r="5" fill="url(#sun-grad)" />
      <g stroke="#f59e0b" stroke-width="1.8" stroke-linecap="round">
        <line x1="12" y1="2" x2="12" y2="4.5" />
        <line x1="12" y1="19.5" x2="12" y2="22" />
        <line x1="2" y1="12" x2="4.5" y2="12" />
        <line x1="19.5" y1="12" x2="22" y2="12" />
        <line x1="4.93" y1="4.93" x2="6.7" y2="6.7" />
        <line x1="17.3" y1="17.3" x2="19.07" y2="19.07" />
        <line x1="4.93" y1="19.07" x2="6.7" y2="17.3" />
        <line x1="17.3" y1="6.7" x2="19.07" y2="4.93" />
      </g>
    </svg>`;
  }

  // Mainly Clear
  if (code === 1) {
    return `<svg class="weather-svg-icon weather-svg-mainly-clear" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs>
        <radialGradient id="sun-mc" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#fde047" />
          <stop offset="100%" stop-color="#f59e0b" />
        </radialGradient>
        <linearGradient id="cloud-mc" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#e0e7ff" />
          <stop offset="100%" stop-color="#94a3b8" />
        </linearGradient>
      </defs>
      <circle cx="9.5" cy="9.5" r="4.2" fill="url(#sun-mc)" />
      <g stroke="#f59e0b" stroke-width="1.5" stroke-linecap="round">
        <line x1="9.5" y1="2" x2="9.5" y2="3.8" />
        <line x1="2" y1="9.5" x2="3.8" y2="9.5" />
        <line x1="4.2" y1="4.2" x2="5.5" y2="5.5" />
        <line x1="14.8" y1="4.2" x2="13.5" y2="5.5" />
      </g>
      <path d="M7 19.5h10.5a4 4 0 0 0 .5-7.97 5 5 0 0 0-9.78-1.5A3.5 3.5 0 0 0 7 19.5z" fill="url(#cloud-mc)" opacity="0.95" />
    </svg>`;
  }

  // Partly Cloudy (Code 2)
  if (code === 2) {
    return `<svg class="weather-svg-icon weather-svg-partly-cloudy" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs>
        <radialGradient id="sun-pc" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#fde047" />
          <stop offset="100%" stop-color="#f59e0b" />
        </radialGradient>
        <linearGradient id="cloud-pc" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#ffffff" />
          <stop offset="100%" stop-color="#cbd5e1" />
        </linearGradient>
      </defs>
      <circle cx="8" cy="8.5" r="3.8" fill="url(#sun-pc)" />
      <path d="M7 19h11.5a3.5 3.5 0 0 0 .5-6.96 4.5 4.5 0 0 0-8.8-1.04A3.5 3.5 0 0 0 7 19z" fill="url(#cloud-pc)" stroke="rgba(255,255,255,0.4)" stroke-width="0.8" />
    </svg>`;
  }

  // Overcast / Cloudy (Code 3)
  if (code === 3) {
    return `<svg class="weather-svg-icon weather-svg-overcast" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="cloud-oc1" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#94a3b8" />
          <stop offset="100%" stop-color="#64748b" />
        </linearGradient>
        <linearGradient id="cloud-oc2" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#e2e8f0" />
          <stop offset="100%" stop-color="#94a3b8" />
        </linearGradient>
      </defs>
      <path d="M5 14h11a3.5 3.5 0 0 0 .5-6.96 4.5 4.5 0 0 0-8.8-1.04A3.5 3.5 0 0 0 5 14z" fill="url(#cloud-oc1)" opacity="0.6" transform="translate(4,-2)" />
      <path d="M4 20h13a4 4 0 0 0 .5-7.97 5 5 0 0 0-9.78-1.5A3.5 3.5 0 0 0 4 20z" fill="url(#cloud-oc2)" />
    </svg>`;
  }

  // Fog / Mist (Code 45, 48)
  if (code === 45 || code === 48) {
    return `<svg class="weather-svg-icon weather-svg-fog" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="fog-cloud" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#e2e8f0" />
          <stop offset="100%" stop-color="#94a3b8" />
        </linearGradient>
      </defs>
      <path d="M5 14h12.5a3.5 3.5 0 0 0 .5-6.96 4.5 4.5 0 0 0-8.8-1.04A3.5 3.5 0 0 0 5 14z" fill="url(#fog-cloud)" opacity="0.85" />
      <g stroke="#94a3b8" stroke-width="1.8" stroke-linecap="round">
        <line x1="4" y1="17" x2="20" y2="17" />
        <line x1="6" y1="20" x2="18" y2="20" opacity="0.8" />
      </g>
    </svg>`;
  }

  // Drizzle (Code 51 - 55)
  if (code >= 51 && code <= 55) {
    return `<svg class="weather-svg-icon weather-svg-drizzle" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="cloud-dz" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#cbd5e1" />
          <stop offset="100%" stop-color="#64748b" />
        </linearGradient>
      </defs>
      <path d="M4 14h13.5a3.5 3.5 0 0 0 .5-6.96 4.5 4.5 0 0 0-8.8-1.04A3.5 3.5 0 0 0 4 14z" fill="url(#cloud-dz)" />
      <g stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round">
        <line x1="7" y1="17" x2="6" y2="19.5" />
        <line x1="12" y1="17" x2="11" y2="19.5" />
        <line x1="17" y1="17" x2="16" y2="19.5" />
      </g>
    </svg>`;
  }

  // Rain (Code 61 - 65)
  if (code >= 61 && code <= 65) {
    return `<svg class="weather-svg-icon weather-svg-rain" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="cloud-rn" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#94a3b8" />
          <stop offset="100%" stop-color="#475569" />
        </linearGradient>
      </defs>
      <path d="M4 14h13.5a3.5 3.5 0 0 0 .5-6.96 4.5 4.5 0 0 0-8.8-1.04A3.5 3.5 0 0 0 4 14z" fill="url(#cloud-rn)" />
      <g stroke="#60a5fa" stroke-width="2" stroke-linecap="round">
        <line x1="6.5" y1="16.5" x2="4.5" y2="21.5" />
        <line x1="11.5" y1="16.5" x2="9.5" y2="21.5" />
        <line x1="16.5" y1="16.5" x2="14.5" y2="21.5" />
      </g>
    </svg>`;
  }

  // Snow (Code 71 - 75)
  if (code >= 71 && code <= 75) {
    return `<svg class="weather-svg-icon weather-svg-snow" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="cloud-sn" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#e0e7ff" />
          <stop offset="100%" stop-color="#94a3b8" />
        </linearGradient>
      </defs>
      <path d="M4 13h13.5a3.5 3.5 0 0 0 .5-6.96 4.5 4.5 0 0 0-8.8-1.04A3.5 3.5 0 0 0 4 13z" fill="url(#cloud-sn)" />
      <g stroke="#a5f3fc" stroke-width="1.6" stroke-linecap="round">
        <!-- Snowflake 1 -->
        <line x1="6.5" y1="16.5" x2="6.5" y2="20.5" />
        <line x1="4.5" y1="18.5" x2="8.5" y2="18.5" />
        <!-- Snowflake 2 -->
        <line x1="12" y1="16.5" x2="12" y2="20.5" />
        <line x1="10" y1="18.5" x2="14" y2="18.5" />
        <!-- Snowflake 3 -->
        <line x1="17.5" y1="16.5" x2="17.5" y2="20.5" />
        <line x1="15.5" y1="18.5" x2="19.5" y2="18.5" />
      </g>
    </svg>`;
  }

  // Showers (Code 80 - 82)
  if (code >= 80 && code <= 82) {
    return `<svg class="weather-svg-icon weather-svg-showers" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs>
        <radialGradient id="sun-sh" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#fde047" />
          <stop offset="100%" stop-color="#f59e0b" />
        </radialGradient>
        <linearGradient id="cloud-sh" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#cbd5e1" />
          <stop offset="100%" stop-color="#64748b" />
        </linearGradient>
      </defs>
      <circle cx="8" cy="8.5" r="3.5" fill="url(#sun-sh)" />
      <path d="M6.5 15h12a3.5 3.5 0 0 0 .5-6.96 4.5 4.5 0 0 0-8.8-1.04A3.5 3.5 0 0 0 6.5 15z" fill="url(#cloud-sh)" />
      <g stroke="#38bdf8" stroke-width="1.8" stroke-linecap="round">
        <line x1="8" y1="17.5" x2="6.5" y2="21" />
        <line x1="13" y1="17.5" x2="11.5" y2="21" />
        <line x1="17.5" y1="17.5" x2="16" y2="21" />
      </g>
    </svg>`;
  }

  // Thunderstorm (Code 95 - 99)
  if (code >= 95 && code <= 99) {
    return `<svg class="weather-svg-icon weather-svg-thunderstorm" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="cloud-ts" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#64748b" />
          <stop offset="100%" stop-color="#334155" />
        </linearGradient>
      </defs>
      <path d="M4 13h13.5a3.5 3.5 0 0 0 .5-6.96 4.5 4.5 0 0 0-8.8-1.04A3.5 3.5 0 0 0 4 13z" fill="url(#cloud-ts)" />
      <polygon points="12 13 8 18 11.5 18 10 22 15 16.5 12.5 16.5" fill="#facc15" stroke="#eab308" stroke-width="0.8" stroke-linejoin="round" />
    </svg>`;
  }

  // Fallback Partly Cloudy
  return `<svg class="weather-svg-icon weather-svg-partly-cloudy" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <defs>
      <radialGradient id="sun-def" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#fde047" />
        <stop offset="100%" stop-color="#f59e0b" />
      </radialGradient>
      <linearGradient id="cloud-def" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#ffffff" />
        <stop offset="100%" stop-color="#cbd5e1" />
      </linearGradient>
    </defs>
    <circle cx="8" cy="8.5" r="3.8" fill="url(#sun-def)" />
    <path d="M7 19h11.5a3.5 3.5 0 0 0 .5-6.96 4.5 4.5 0 0 0-8.8-1.04A3.5 3.5 0 0 0 7 19z" fill="url(#cloud-def)" />
  </svg>`;
}
