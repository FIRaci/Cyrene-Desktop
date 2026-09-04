import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const html = fs.readFileSync(fileURLToPath(new URL("./index.html", import.meta.url)), "utf8");
const source = fs.readFileSync(fileURLToPath(new URL("./settings.ts", import.meta.url)), "utf8");
const styles = fs.readFileSync(fileURLToPath(new URL("./settings.css", import.meta.url)), "utf8");
const icon = fs.readFileSync(
  fileURLToPath(new URL("../public/icons/providers/custom-endpoint.svg", import.meta.url)),
  "utf8",
);

describe("custom endpoint API settings UI", () => {
  it("contains cloud/local controls and a guide trigger", () => {
    expect(html).toContain('id="custom-endpoint-controls"');
    expect(html).toContain('data-custom-endpoint-mode="cloud"');
    expect(html).toContain('data-custom-endpoint-mode="local"');
    expect(html).toContain('id="custom-endpoint-guide-btn"');
  });

  it("exposes dynamic API field labels and hints", () => {
    expect(html).toContain('id="api-key-label"');
    expect(html).toContain('id="api-key-hint"');
    expect(html).toContain('id="transport-hint"');
  });

  it("ships a local custom endpoint icon", () => {
    expect(icon).toContain("<svg");
    expect(icon).toContain("<title>Custom endpoint</title>");
  });

  it("includes the support boundary and all requested FAQ topics", () => {
    expect(source).toContain("Local models and custom endpoints are not officially supported");
    expect(source).toContain("Local model response format error");
    expect(source).toContain("MiniMax Reasoning Mode Failed");
    expect(source).toContain("Fewer configs for Claude");
  });

  it("persists the inactive custom profile together with the active one", () => {
    expect(source).toContain("perProvider: { ...providerProfileCache }");
  });

  it("top-aligns fields with different amounts of helper text", () => {
    expect(styles).toMatch(/\.field\s*\{[^}]*align-content:\s*start;/s);
  });
});
