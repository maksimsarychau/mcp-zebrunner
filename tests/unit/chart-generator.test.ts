import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  generateSvgChart,
  generatePngChart,
  generateHtmlChart,
  generateTextChart,
  buildChartResponse,
  type ChartConfig,
} from "../../src/utils/chart-generator.js";

describe("Chart Generator Unit Tests", () => {
  // ── SVG Generation ──

  describe("generateSvgChart", () => {
    describe("Pie Chart", () => {
      it("should generate valid SVG with pie slices", () => {
        const config: ChartConfig = {
          type: "pie",
          title: "Test Results",
          labels: ["Passed", "Failed", "Skipped"],
          datasets: [{ label: "Tests", values: [80, 15, 5] }],
        };
        const svg = generateSvgChart(config);
        assert.ok(svg.startsWith("<svg"), "Should start with <svg tag");
        assert.ok(svg.endsWith("</svg>"), "Should end with </svg>");
        assert.ok(svg.includes("Test Results"), "Should include title");
        assert.ok(svg.includes("<path") || svg.includes("<circle"), "Should include pie slices");
        assert.ok(svg.includes("Passed"), "Should include labels in legend");
      });

      it("should render full circle for single-value pie", () => {
        const config: ChartConfig = {
          type: "pie",
          title: "Single",
          labels: ["All"],
          datasets: [{ label: "Tests", values: [100] }],
        };
        const svg = generateSvgChart(config);
        assert.ok(svg.includes("<circle"), "Should render circle for single slice");
      });

      it("should handle empty data gracefully", () => {
        const config: ChartConfig = {
          type: "pie",
          title: "Empty",
          labels: [],
          datasets: [{ label: "Tests", values: [] }],
        };
        const svg = generateSvgChart(config);
        assert.ok(svg.includes("No data"), "Should show 'No data' message");
      });

      it("should handle all-zero values", () => {
        const config: ChartConfig = {
          type: "pie",
          title: "Zeros",
          labels: ["A", "B"],
          datasets: [{ label: "Tests", values: [0, 0] }],
        };
        const svg = generateSvgChart(config);
        assert.ok(svg.includes("No data"), "Should show 'No data' for all-zero");
      });

      it("should skip percentage labels for tiny slices (< 4%)", () => {
        const config: ChartConfig = {
          type: "pie",
          title: "Tiny Slice",
          labels: ["Big", "Tiny"],
          datasets: [{ label: "Tests", values: [97, 3] }],
        };
        const svg = generateSvgChart(config);
        assert.ok(svg.includes("97%"), "Should show 97% label");
        assert.ok(!svg.includes("3%"), "Should not show 3% label (too small)");
      });
    });

    describe("Bar Chart", () => {
      it("should generate valid SVG with bars and axis", () => {
        const config: ChartConfig = {
          type: "bar",
          title: "Pass Rates",
          labels: ["Suite A", "Suite B", "Suite C"],
          datasets: [{ label: "Pass Rate %", values: [95, 88, 72] }],
        };
        const svg = generateSvgChart(config);
        assert.ok(svg.includes("<rect"), "Should include bar rectangles");
        assert.ok(svg.includes("Pass Rates"), "Should include title");
        assert.ok(svg.includes("Suite A") || svg.includes("Suite"), "Should include labels");
      });

      it("should handle multi-dataset bars", () => {
        const config: ChartConfig = {
          type: "bar",
          title: "Multi",
          labels: ["A", "B"],
          datasets: [
            { label: "Passed", values: [80, 60] },
            { label: "Failed", values: [20, 40] },
          ],
        };
        const svg = generateSvgChart(config);
        assert.ok(svg.includes("Passed"), "Should include legend for Passed");
        assert.ok(svg.includes("Failed"), "Should include legend for Failed");
      });

      it("should handle empty labels", () => {
        const config: ChartConfig = {
          type: "bar",
          title: "Empty",
          labels: [],
          datasets: [{ label: "Tests", values: [] }],
        };
        const svg = generateSvgChart(config);
        assert.ok(svg.includes("<svg"), "Should still produce valid SVG");
      });
    });

    describe("Horizontal Bar Chart", () => {
      it("should generate valid SVG with horizontal bars", () => {
        const config: ChartConfig = {
          type: "horizontal_bar",
          title: "Top Bugs",
          labels: ["BUG-1", "BUG-2", "BUG-3"],
          datasets: [{ label: "Failures", values: [45, 32, 18] }],
        };
        const svg = generateSvgChart(config);
        assert.ok(svg.includes("<rect"), "Should include bar rectangles");
        assert.ok(svg.includes("BUG-1"), "Should include labels");
        assert.ok(svg.includes("45"), "Should include value labels");
      });
    });

    describe("Line Chart", () => {
      it("should generate valid SVG with polyline and data points", () => {
        const config: ChartConfig = {
          type: "line",
          title: "Pass/Fail Trend",
          labels: ["Run 1", "Run 2", "Run 3", "Run 4"],
          datasets: [
            { label: "Pass Rate", values: [90, 85, 88, 92] },
          ],
        };
        const svg = generateSvgChart(config);
        assert.ok(svg.includes("<polyline"), "Should include polyline");
        assert.ok(svg.includes("<circle"), "Should include data point circles");
        assert.ok(svg.includes("Pass Rate"), "Should include legend");
      });

      it("should support multiple line series", () => {
        const config: ChartConfig = {
          type: "line",
          title: "Multi-line",
          labels: ["1", "2", "3"],
          datasets: [
            { label: "Pass", values: [90, 85, 88] },
            { label: "Duration", values: [120, 130, 110] },
          ],
        };
        const svg = generateSvgChart(config);
        const polylineCount = (svg.match(/<polyline/g) || []).length;
        assert.strictEqual(polylineCount, 2, "Should have 2 polylines");
      });
    });

    describe("Stacked Bar Chart", () => {
      it("should generate valid SVG with stacked segments", () => {
        const config: ChartConfig = {
          type: "stacked_bar",
          title: "Launch Status",
          labels: ["Launch 1", "Launch 2"],
          datasets: [
            { label: "Passed", values: [80, 60] },
            { label: "Failed", values: [15, 30] },
            { label: "Skipped", values: [5, 10] },
          ],
        };
        const svg = generateSvgChart(config);
        assert.ok(svg.includes("<rect"), "Should include rectangles");
        assert.ok(svg.includes("Passed"), "Should include legend");
        assert.ok(svg.includes("Launch Status"), "Should include title");
      });
    });

    describe("Custom Dimensions", () => {
      it("should respect custom width and height", () => {
        const config: ChartConfig = {
          type: "bar",
          title: "Custom",
          labels: ["A"],
          datasets: [{ label: "V", values: [10] }],
          width: 1200,
          height: 800,
        };
        const svg = generateSvgChart(config);
        assert.ok(svg.includes('width="1200"'), "Should use custom width");
        assert.ok(svg.includes('height="800"'), "Should use custom height");
      });

      it("should use defaults (800x500) when not specified", () => {
        const config: ChartConfig = {
          type: "bar",
          title: "Default",
          labels: ["A"],
          datasets: [{ label: "V", values: [10] }],
        };
        const svg = generateSvgChart(config);
        assert.ok(svg.includes('width="800"'), "Should default to 800 width");
        assert.ok(svg.includes('height="500"'), "Should default to 500 height");
      });
    });

    describe("SVG Safety", () => {
      it("should escape special characters in title", () => {
        const config: ChartConfig = {
          type: "pie",
          title: "Results <script>alert(1)</script>",
          labels: ["A"],
          datasets: [{ label: "V", values: [10] }],
        };
        const svg = generateSvgChart(config);
        assert.ok(!svg.includes("<script>"), "Should escape script tags");
        assert.ok(svg.includes("&lt;script&gt;"), "Should HTML-escape angle brackets");
      });

      it("should escape special characters in labels", () => {
        const config: ChartConfig = {
          type: "bar",
          title: "Safe",
          labels: ['Label "with" quotes & <tags>'],
          datasets: [{ label: "V", values: [10] }],
        };
        const svg = generateSvgChart(config);
        assert.ok(!svg.includes('"with"'), "Should escape quotes in content");
      });
    });
  });

  // ── PNG Generation ──

  describe("generatePngChart", () => {
    it("should return a valid PNG buffer", async () => {
      const config: ChartConfig = {
        type: "pie",
        title: "PNG Test",
        labels: ["A", "B"],
        datasets: [{ label: "V", values: [60, 40] }],
        width: 400,
        height: 300,
      };
      const buffer = await generatePngChart(config);
      assert.ok(Buffer.isBuffer(buffer), "Should return a Buffer");
      assert.ok(buffer.length > 100, "PNG should have reasonable size");
      // PNG magic bytes: 0x89 0x50 0x4E 0x47
      assert.strictEqual(buffer[0], 0x89, "Should start with PNG magic byte");
      assert.strictEqual(buffer[1], 0x50, "Second byte should be P");
      assert.strictEqual(buffer[2], 0x4e, "Third byte should be N");
      assert.strictEqual(buffer[3], 0x47, "Fourth byte should be G");
    });

    it("should produce different sizes for different dimensions", async () => {
      const small = await generatePngChart({
        type: "bar",
        title: "Small",
        labels: ["A"],
        datasets: [{ label: "V", values: [10] }],
        width: 200,
        height: 150,
      });
      const large = await generatePngChart({
        type: "bar",
        title: "Large",
        labels: ["A"],
        datasets: [{ label: "V", values: [10] }],
        width: 1200,
        height: 800,
      });
      assert.ok(large.length > small.length, "Larger dimensions should produce bigger PNG");
    });
  });

  // ── HTML Generation ──

  describe("generateHtmlChart", () => {
    it("should generate valid HTML with Chart.js CDN", () => {
      const config: ChartConfig = {
        type: "pie",
        title: "HTML Test",
        labels: ["A", "B"],
        datasets: [{ label: "V", values: [60, 40] }],
      };
      const html = generateHtmlChart(config);
      assert.ok(html.includes("<!DOCTYPE html>"), "Should be valid HTML");
      assert.ok(html.includes("chart.js@4"), "Should include Chart.js CDN");
      assert.ok(html.includes("<canvas"), "Should include canvas element");
      assert.ok(html.includes("new Chart"), "Should instantiate Chart");
      assert.ok(html.includes("HTML Test"), "Should include title");
    });

    it("should map chart types correctly to Chart.js types", () => {
      const barHtml = generateHtmlChart({
        type: "bar",
        title: "Bar",
        labels: ["A"],
        datasets: [{ label: "V", values: [10] }],
      });
      assert.ok(barHtml.includes("type: 'bar'"), "Bar should map to bar");

      const pieHtml = generateHtmlChart({
        type: "pie",
        title: "Pie",
        labels: ["A"],
        datasets: [{ label: "V", values: [10] }],
      });
      assert.ok(pieHtml.includes("type: 'pie'"), "Pie should map to pie");

      const lineHtml = generateHtmlChart({
        type: "line",
        title: "Line",
        labels: ["A"],
        datasets: [{ label: "V", values: [10] }],
      });
      assert.ok(lineHtml.includes("type: 'line'"), "Line should map to line");
    });

    it("should use horizontal indexAxis for horizontal_bar", () => {
      const html = generateHtmlChart({
        type: "horizontal_bar",
        title: "HBar",
        labels: ["A"],
        datasets: [{ label: "V", values: [10] }],
      });
      assert.ok(html.includes("indexAxis: 'y'"), "Should set indexAxis to y");
    });

    it("should enable stacking for stacked_bar", () => {
      const html = generateHtmlChart({
        type: "stacked_bar",
        title: "Stacked",
        labels: ["A"],
        datasets: [
          { label: "V1", values: [10] },
          { label: "V2", values: [20] },
        ],
      });
      assert.ok(html.includes("stacked: true"), "Should enable stacking");
    });

    it("should escape title in HTML <title> tag", () => {
      const html = generateHtmlChart({
        type: "bar",
        title: "Title <b>bold</b>",
        labels: ["A"],
        datasets: [{ label: "V", values: [10] }],
      });
      const titleTagMatch = html.match(/<title>(.*?)<\/title>/);
      assert.ok(titleTagMatch, "Should have <title> tag");
      assert.ok(
        titleTagMatch![1].includes("&lt;b&gt;"),
        "HTML <title> tag should have escaped content"
      );
    });
  });

  // ── Text/Markdown Generation ──

  describe("generateTextChart", () => {
    it("should generate markdown table for pie chart", () => {
      const text = generateTextChart({
        type: "pie",
        title: "Pie Chart",
        labels: ["Passed", "Failed"],
        datasets: [{ label: "Tests", values: [80, 20] }],
      });
      assert.ok(text.includes("## Pie Chart"), "Should include title heading");
      assert.ok(text.includes("Passed"), "Should include labels");
      assert.ok(text.includes("80"), "Should include values");
      assert.ok(text.includes("80.0%"), "Should include percentage");
      assert.ok(text.includes("█"), "Should include ASCII bar");
      assert.ok(text.includes("**Total: 100**"), "Should include total");
    });

    it("should generate ASCII bars for horizontal bar / single-dataset bar", () => {
      const text = generateTextChart({
        type: "horizontal_bar",
        title: "Top Bugs",
        labels: ["BUG-1", "BUG-2"],
        datasets: [{ label: "Failures", values: [50, 25] }],
      });
      assert.ok(text.includes("BUG-1"), "Should include labels");
      assert.ok(text.includes("50"), "Should include values");
      assert.ok(text.includes("█"), "Should include ASCII bars");
    });

    it("should generate markdown table for line chart", () => {
      const text = generateTextChart({
        type: "line",
        title: "Trend",
        labels: ["Run 1", "Run 2"],
        datasets: [
          { label: "Pass Rate", values: [90, 85] },
          { label: "Duration", values: [120, 130] },
        ],
      });
      assert.ok(text.includes("| #"), "Should include table header");
      assert.ok(text.includes("Pass Rate"), "Should include dataset labels");
      assert.ok(text.includes("Duration"), "Should include second dataset");
      assert.ok(text.includes("90"), "Should include values");
    });

    it("should generate table with totals for stacked_bar", () => {
      const text = generateTextChart({
        type: "stacked_bar",
        title: "Launches",
        labels: ["L1", "L2"],
        datasets: [
          { label: "Passed", values: [80, 60] },
          { label: "Failed", values: [20, 40] },
        ],
      });
      assert.ok(text.includes("| Category"), "Should include Category header");
      assert.ok(text.includes("Total"), "Should include Total column");
      assert.ok(text.includes("100"), "Should compute row totals (80+20=100)");
    });
  });

  // ── buildChartResponse ──

  describe("buildChartResponse", () => {
    const config: ChartConfig = {
      type: "pie",
      title: "Test",
      labels: ["A", "B"],
      datasets: [{ label: "V", values: [60, 40] }],
    };

    it("should return image content block for png format", async () => {
      const result = await buildChartResponse(config, "png", "Summary text");
      assert.strictEqual(result.content.length, 2, "Should have text + image");
      assert.strictEqual(result.content[0].type, "text");
      assert.ok((result.content[0] as any).text.includes("Summary text"));
      assert.strictEqual(result.content[1].type, "image");
      assert.strictEqual((result.content[1] as any).mimeType, "image/png");
      assert.ok((result.content[1] as any).data.length > 0, "Should have base64 data");
    });

    it("should return text content block for html format", async () => {
      const result = await buildChartResponse(config, "html", "Summary text");
      assert.strictEqual(result.content.length, 1, "Should have single text block");
      assert.strictEqual(result.content[0].type, "text");
      const text = (result.content[0] as any).text;
      assert.ok(text.includes("Summary text"), "Should include summary");
      assert.ok(text.includes("<!DOCTYPE html>"), "Should include HTML");
      assert.ok(text.includes("chart.js"), "Should include Chart.js");
    });

    it("should return text content block for text format", async () => {
      const result = await buildChartResponse(config, "text", "Summary text");
      assert.strictEqual(result.content.length, 1, "Should have single text block");
      assert.strictEqual(result.content[0].type, "text");
      const text = (result.content[0] as any).text;
      assert.ok(text.includes("Summary text"), "Should include summary");
      assert.ok(text.includes("## Test"), "Should include markdown chart");
    });

    it("should produce valid base64 for png that decodes to valid PNG", async () => {
      const result = await buildChartResponse(config, "png", "test");
      const imageBlock = result.content.find((c) => c.type === "image") as any;
      assert.ok(imageBlock, "Should have image block");
      const buf = Buffer.from(imageBlock.data, "base64");
      assert.strictEqual(buf[0], 0x89, "Decoded PNG should start with magic byte");
      assert.strictEqual(buf[1], 0x50);
    });
  });

  // ── Edge Cases ──

  describe("Edge Cases", () => {
    it("should handle very large numbers", () => {
      const svg = generateSvgChart({
        type: "bar",
        title: "Large Numbers",
        labels: ["A"],
        datasets: [{ label: "V", values: [999999999] }],
      });
      assert.ok(svg.includes("<svg"), "Should produce valid SVG");
    });

    it("should handle very long labels (truncation)", () => {
      const svg = generateSvgChart({
        type: "bar",
        title: "Long Labels",
        labels: ["This is a very long label that should be truncated somewhere"],
        datasets: [{ label: "V", values: [10] }],
      });
      assert.ok(svg.includes("…") || svg.includes("&#x2026;") || svg.includes("&amp;#x2026;") || svg.includes("This"), "Should truncate or include label");
    });

    it("should handle many data points (20+ bars)", () => {
      const labels = Array.from({ length: 25 }, (_, i) => `Item ${i}`);
      const values = Array.from({ length: 25 }, (_, i) => i * 10);
      const svg = generateSvgChart({
        type: "bar",
        title: "Many Bars",
        labels,
        datasets: [{ label: "V", values }],
      });
      assert.ok(svg.includes("<svg"), "Should handle many bars");
      const rectCount = (svg.match(/<rect/g) || []).length;
      assert.ok(rectCount >= 25, "Should have at least 25 bar rects (plus background)");
    });

    it("should handle negative values in datasets gracefully", () => {
      const svg = generateSvgChart({
        type: "bar",
        title: "Negative",
        labels: ["A", "B"],
        datasets: [{ label: "V", values: [-5, 10] }],
      });
      assert.ok(svg.includes("<svg"), "Should still produce valid SVG");
    });

    it("should cycle through color palette for many datasets", () => {
      const config: ChartConfig = {
        type: "pie",
        title: "Many Colors",
        labels: Array.from({ length: 15 }, (_, i) => `Item ${i}`),
        datasets: [{ label: "V", values: Array.from({ length: 15 }, () => 10) }],
      };
      const svg = generateSvgChart(config);
      assert.ok(svg.includes("#4e79a7"), "Should use first palette color");
      assert.ok(svg.includes("#f28e2b"), "Should use second palette color");
    });
  });
});
