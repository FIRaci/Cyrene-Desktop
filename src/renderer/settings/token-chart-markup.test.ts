import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const html = fs.readFileSync(fileURLToPath(new URL("./index.html", import.meta.url)), "utf8");

describe("token consumption bar chart markup", () => {
  it("places daily average badge in token-section-header above the chart", () => {
    expect(html).toContain('class="token-section-header"');
    expect(html).toContain('id="token-avg-label"');
    expect(html).toMatch(/<div class="token-section-header"[\s\S]*?<span class="token-avg-badge" id="token-avg-label">/);
  });

  it("ensures token-avg-label is not inside mini-chart or mini-chart__avg", () => {
    const miniChartMatch = html.match(/<div class="mini-chart"[\s\S]*?<\/div>\s*<\/div>/);
    expect(miniChartMatch).toBeTruthy();
    const miniChartContent = miniChartMatch![0];
    expect(miniChartContent).not.toContain('id="token-avg-label"');
    expect(miniChartContent).toContain('id="token-avg-line"');
    expect(miniChartContent).toContain('id="token-bar-chart"');
  });

  it("includes svg icon and title for Daily Consumption Bar Chart", () => {
    expect(html).toContain("<title>Daily Consumption Bar Chart</title>");
  });
});
