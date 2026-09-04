import https from "node:https";

export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseName?: string;
  releaseNotes?: string;
  downloadUrl?: string;
  publishedAt?: string;
  error?: string;
}

export function compareSemver(current: string, target: string): number {
  const parse = (v: string): number[] => {
    const clean = v.replace(/^v/i, "").trim().split("-")[0];
    return clean.split(".").map((n) => parseInt(n, 10) || 0);
  };

  const cParts = parse(current);
  const tParts = parse(target);
  const len = Math.max(cParts.length, tParts.length);

  for (let i = 0; i < len; i++) {
    const c = cParts[i] ?? 0;
    const t = tParts[i] ?? 0;
    if (t > c) return 1; // target is newer
    if (t < c) return -1; // current is newer
  }
  return 0; // identical
}

export function isNewerVersion(current: string, target: string): boolean {
  return compareSemver(current, target) > 0;
}

export async function fetchLatestReleaseInfo(
  repo: string = "FIRaci/Cyrene-Desktop",
  timeoutMs: number = 8000,
): Promise<{
  tagName: string;
  name: string;
  body: string;
  publishedAt: string;
  downloadUrl: string;
}> {
  const url = `https://api.github.com/repos/${repo}/releases/latest`;

  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent": "Cyrene-Desktop-AutoUpdater",
          Accept: "application/vnd.github.v3+json",
        },
        timeout: timeoutMs,
      },
      (res) => {
        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          return reject(new Error(`GitHub API returned status ${res.statusCode}`));
        }

        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            const tagName = parsed.tag_name || "";
            const name = parsed.name || tagName;
            const body = parsed.body || "";
            const publishedAt = parsed.published_at || "";

            // Find zip or setup asset
            let downloadUrl = parsed.html_url || `https://github.com/${repo}/releases/latest`;
            if (Array.isArray(parsed.assets)) {
              const zipAsset = parsed.assets.find(
                (a: { name?: string }) =>
                  typeof a.name === "string" && a.name.toLowerCase().endsWith(".zip"),
              );
              if (zipAsset?.browser_download_url) {
                downloadUrl = zipAsset.browser_download_url;
              }
            }

            resolve({ tagName, name, body, publishedAt, downloadUrl });
          } catch (e) {
            reject(new Error(`Failed to parse release response: ${String(e)}`));
          }
        });
      },
    );

    req.on("error", (err) => reject(err));
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Update check timed out"));
    });
  });
}

export async function checkForAppUpdates(
  currentVersion: string,
  repo: string = "FIRaci/Cyrene-Desktop",
): Promise<UpdateCheckResult> {
  try {
    const release = await fetchLatestReleaseInfo(repo);
    const hasUpdate = isNewerVersion(currentVersion, release.tagName);

    return {
      hasUpdate,
      currentVersion,
      latestVersion: release.tagName.replace(/^v/i, ""),
      releaseName: release.name,
      releaseNotes: release.body,
      downloadUrl: release.downloadUrl,
      publishedAt: release.publishedAt,
    };
  } catch (err: unknown) {
    return {
      hasUpdate: false,
      currentVersion,
      latestVersion: currentVersion,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
