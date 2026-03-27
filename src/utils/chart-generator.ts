import sharp from 'sharp';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChartDataset {
  label: string;
  values: number[];
  color?: string;
}

export interface ChartConfig {
  type: 'pie' | 'bar' | 'horizontal_bar' | 'line' | 'stacked_bar';
  title: string;
  labels: string[];
  datasets: ChartDataset[];
  width?: number;
  height?: number;
}

type McpContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

// ─── Constants ────────────────────────────────────────────────────────────────

const PALETTE = [
  '#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f',
  '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac',
];

const FONT = 'sans-serif';
const BG = '#ffffff';
const TEXT_COLOR = '#333333';
const GRID_COLOR = '#e0e0e0';
const AXIS_COLOR = '#666666';

// ─── Utilities ────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function color(i: number): string {
  return PALETTE[i % PALETTE.length];
}

function truncate(s: string, max = 22): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '\u2026';
}

function fmtNum(n: number): string {
  if (Number.isInteger(n)) return n.toLocaleString('en-US');
  return n.toFixed(1);
}

function niceScale(dataMax: number, ticks = 5): { max: number; step: number; values: number[] } {
  if (dataMax <= 0) return { max: 1, step: 1, values: [0, 1] };
  const rough = dataMax / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const frac = rough / mag;
  let step: number;
  if (frac <= 1.5) step = mag;
  else if (frac <= 3.5) step = 2 * mag;
  else if (frac <= 7.5) step = 5 * mag;
  else step = 10 * mag;
  const nMax = Math.ceil(dataMax / step) * step;
  const values: number[] = [];
  for (let v = 0; v <= nMax + step * 0.01; v += step) values.push(Math.round(v * 1e6) / 1e6);
  return { max: nMax, step, values };
}

function pct(value: number, total: number): string {
  return total > 0 ? `${Math.round((value / total) * 100)}%` : '0%';
}

// ─── SVG Building Blocks ──────────────────────────────────────────────────────

function svgOpen(w: number, h: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
    + `<rect width="${w}" height="${h}" fill="${BG}"/>`;
}

function svgTitle(title: string, w: number, y = 28): string {
  return `<text x="${w / 2}" y="${y}" text-anchor="middle" font-family="${FONT}" font-size="16" font-weight="bold" fill="${TEXT_COLOR}">${esc(title)}</text>`;
}

function svgLegendItems(entries: { label: string; color: string }[], startX: number, startY: number, maxWidth: number): string {
  const boxSize = 12;
  const gap = 8;
  const itemGap = 18;
  let svg = '';
  let x = startX;
  let y = startY;

  for (const { label, color: c } of entries) {
    const textW = truncate(label, 18).length * 7;
    const itemW = boxSize + gap + textW + itemGap;
    if (x + itemW > startX + maxWidth && x !== startX) {
      x = startX;
      y += 20;
    }
    svg += `<rect x="${x}" y="${y - boxSize + 2}" width="${boxSize}" height="${boxSize}" rx="2" fill="${c}"/>`;
    svg += `<text x="${x + boxSize + gap}" y="${y + 2}" font-family="${FONT}" font-size="11" fill="${TEXT_COLOR}">${esc(truncate(label, 18))}</text>`;
    x += itemW;
  }
  return svg;
}

// ─── Pie Chart ────────────────────────────────────────────────────────────────

function renderPie(cfg: ChartConfig, w: number, h: number): string {
  const values = cfg.datasets[0]?.values ?? [];
  const total = values.reduce((s, v) => s + v, 0);
  if (total === 0 || values.length === 0) {
    return `<text x="${w / 2}" y="${h / 2}" text-anchor="middle" font-family="${FONT}" font-size="14" fill="${AXIS_COLOR}">No data</text>`;
  }

  const cx = w / 2;
  const legendH = Math.ceil(cfg.labels.length / 3) * 20 + 10;
  const cy = (h - legendH) / 2 + 20;
  const r = Math.min(cx - 40, cy - 40, 160);

  let svg = '';
  let angle = -Math.PI / 2;

  for (let i = 0; i < values.length; i++) {
    if (values[i] <= 0) continue;
    const sliceAngle = (values[i] / total) * 2 * Math.PI;
    const endAngle = angle + sliceAngle;

    if (values.length === 1 || sliceAngle >= 2 * Math.PI - 0.001) {
      svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color(i)}"/>`;
    } else {
      const x1 = cx + r * Math.cos(angle);
      const y1 = cy + r * Math.sin(angle);
      const x2 = cx + r * Math.cos(endAngle);
      const y2 = cy + r * Math.sin(endAngle);
      const large = sliceAngle > Math.PI ? 1 : 0;
      svg += `<path d="M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z" fill="${color(i)}"/>`;
    }

    const midAngle = angle + sliceAngle / 2;
    const pctVal = Math.round((values[i] / total) * 100);
    if (pctVal >= 4) {
      const lx = cx + r * 0.65 * Math.cos(midAngle);
      const ly = cy + r * 0.65 * Math.sin(midAngle);
      svg += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-family="${FONT}" font-size="12" font-weight="bold" fill="#fff">${pctVal}%</text>`;
    }

    angle = endAngle;
  }

  const entries = cfg.labels.map((l, i) => ({ label: `${l} (${fmtNum(values[i])})`, color: color(i) }));
  svg += svgLegendItems(entries, 20, h - legendH, w - 40);
  return svg;
}

// ─── Bar Chart ────────────────────────────────────────────────────────────────

function renderBar(cfg: ChartConfig, w: number, h: number): string {
  const { labels, datasets } = cfg;
  if (labels.length === 0 || datasets.length === 0) return '';

  const left = 70, right = 20, top = 50, bottom = 80;
  const legendH = datasets.length > 1 ? 30 : 0;
  const chartW = w - left - right;
  const chartH = h - top - bottom - legendH;

  const allVals = datasets.flatMap(d => d.values);
  const dataMax = Math.max(...allVals, 0);
  const scale = niceScale(dataMax);

  let svg = '';

  for (const v of scale.values) {
    const y = top + chartH - (v / scale.max) * chartH;
    svg += `<line x1="${left}" y1="${y}" x2="${left + chartW}" y2="${y}" stroke="${GRID_COLOR}" stroke-dasharray="3,3"/>`;
    svg += `<text x="${left - 8}" y="${y + 4}" text-anchor="end" font-family="${FONT}" font-size="10" fill="${AXIS_COLOR}">${fmtNum(v)}</text>`;
  }

  svg += `<line x1="${left}" y1="${top}" x2="${left}" y2="${top + chartH}" stroke="${AXIS_COLOR}"/>`;
  svg += `<line x1="${left}" y1="${top + chartH}" x2="${left + chartW}" y2="${top + chartH}" stroke="${AXIS_COLOR}"/>`;

  const groupW = chartW / labels.length;
  const numBars = datasets.length;
  const barW = Math.max(4, (groupW * 0.75) / numBars);
  const groupPad = (groupW - barW * numBars) / 2;

  for (let i = 0; i < labels.length; i++) {
    const gx = left + i * groupW;

    for (let d = 0; d < numBars; d++) {
      const val = datasets[d].values[i] ?? 0;
      const barH = scale.max > 0 ? (val / scale.max) * chartH : 0;
      const bx = gx + groupPad + d * barW;
      const by = top + chartH - barH;
      svg += `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" fill="${datasets[d].color || color(d)}" rx="1"/>`;

      if (barH > 16 && barW > 24) {
        svg += `<text x="${(bx + barW / 2).toFixed(1)}" y="${(by + 14).toFixed(1)}" text-anchor="middle" font-family="${FONT}" font-size="9" fill="#fff">${fmtNum(val)}</text>`;
      }
    }

    const lx = gx + groupW / 2;
    const rotated = labels[i].length > 8 || labels.length > 8;
    if (rotated) {
      svg += `<text x="${lx}" y="${top + chartH + 14}" text-anchor="end" font-family="${FONT}" font-size="10" fill="${AXIS_COLOR}" transform="rotate(-40,${lx},${top + chartH + 14})">${esc(truncate(labels[i], 16))}</text>`;
    } else {
      svg += `<text x="${lx}" y="${top + chartH + 18}" text-anchor="middle" font-family="${FONT}" font-size="10" fill="${AXIS_COLOR}">${esc(truncate(labels[i], 16))}</text>`;
    }
  }

  if (datasets.length > 1) {
    const entries = datasets.map((d, i) => ({ label: d.label, color: d.color || color(i) }));
    svg += svgLegendItems(entries, left, h - 20, chartW);
  }

  return svg;
}

// ─── Horizontal Bar Chart ─────────────────────────────────────────────────────

function renderHorizontalBar(cfg: ChartConfig, w: number, h: number): string {
  const { labels, datasets } = cfg;
  const values = datasets[0]?.values ?? [];
  if (labels.length === 0) return '';

  const left = 140, right = 60, top = 50, bottom = 30;
  const chartW = w - left - right;
  const chartH = h - top - bottom;

  const dataMax = Math.max(...values, 0);
  const scale = niceScale(dataMax);

  let svg = '';

  for (const v of scale.values) {
    const x = left + (v / scale.max) * chartW;
    svg += `<line x1="${x}" y1="${top}" x2="${x}" y2="${top + chartH}" stroke="${GRID_COLOR}" stroke-dasharray="3,3"/>`;
    svg += `<text x="${x}" y="${top + chartH + 16}" text-anchor="middle" font-family="${FONT}" font-size="10" fill="${AXIS_COLOR}">${fmtNum(v)}</text>`;
  }

  svg += `<line x1="${left}" y1="${top}" x2="${left}" y2="${top + chartH}" stroke="${AXIS_COLOR}"/>`;
  svg += `<line x1="${left}" y1="${top + chartH}" x2="${left + chartW}" y2="${top + chartH}" stroke="${AXIS_COLOR}"/>`;

  const barH = Math.max(4, (chartH / labels.length) * 0.7);
  const gap = (chartH / labels.length - barH) / 2;

  for (let i = 0; i < labels.length; i++) {
    const val = values[i] ?? 0;
    const bw = scale.max > 0 ? (val / scale.max) * chartW : 0;
    const by = top + i * (chartH / labels.length) + gap;

    svg += `<rect x="${left}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${barH.toFixed(1)}" fill="${color(i)}" rx="2"/>`;
    svg += `<text x="${left - 6}" y="${(by + barH / 2 + 4).toFixed(1)}" text-anchor="end" font-family="${FONT}" font-size="11" fill="${TEXT_COLOR}">${esc(truncate(labels[i], 20))}</text>`;
    svg += `<text x="${(left + bw + 6).toFixed(1)}" y="${(by + barH / 2 + 4).toFixed(1)}" font-family="${FONT}" font-size="10" fill="${AXIS_COLOR}">${fmtNum(val)}</text>`;
  }

  return svg;
}

// ─── Line Chart ───────────────────────────────────────────────────────────────

function renderLine(cfg: ChartConfig, w: number, h: number): string {
  const { labels, datasets } = cfg;
  if (labels.length === 0 || datasets.length === 0) return '';

  const left = 70, right = 20, top = 50, bottom = 80;
  const legendH = 30;
  const chartW = w - left - right;
  const chartH = h - top - bottom - legendH;

  const allVals = datasets.flatMap(d => d.values);
  const dataMax = Math.max(...allVals, 0);
  const scale = niceScale(dataMax);

  let svg = '';

  for (const v of scale.values) {
    const y = top + chartH - (v / scale.max) * chartH;
    svg += `<line x1="${left}" y1="${y}" x2="${left + chartW}" y2="${y}" stroke="${GRID_COLOR}" stroke-dasharray="3,3"/>`;
    svg += `<text x="${left - 8}" y="${y + 4}" text-anchor="end" font-family="${FONT}" font-size="10" fill="${AXIS_COLOR}">${fmtNum(v)}</text>`;
  }

  svg += `<line x1="${left}" y1="${top}" x2="${left}" y2="${top + chartH}" stroke="${AXIS_COLOR}"/>`;
  svg += `<line x1="${left}" y1="${top + chartH}" x2="${left + chartW}" y2="${top + chartH}" stroke="${AXIS_COLOR}"/>`;

  const stepX = labels.length > 1 ? chartW / (labels.length - 1) : chartW / 2;

  for (let i = 0; i < labels.length; i++) {
    const x = left + i * stepX;
    const rotated = labels[i].length > 8 || labels.length > 8;
    if (rotated) {
      svg += `<text x="${x}" y="${top + chartH + 14}" text-anchor="end" font-family="${FONT}" font-size="10" fill="${AXIS_COLOR}" transform="rotate(-40,${x},${top + chartH + 14})">${esc(truncate(labels[i], 16))}</text>`;
    } else {
      svg += `<text x="${x}" y="${top + chartH + 18}" text-anchor="middle" font-family="${FONT}" font-size="10" fill="${AXIS_COLOR}">${esc(truncate(labels[i], 16))}</text>`;
    }
  }

  for (let d = 0; d < datasets.length; d++) {
    const c = datasets[d].color || color(d);
    const points: string[] = [];
    for (let i = 0; i < datasets[d].values.length; i++) {
      const x = left + i * stepX;
      const y = top + chartH - (datasets[d].values[i] / scale.max) * chartH;
      points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    svg += `<polyline points="${points.join(' ')}" fill="none" stroke="${c}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;

    for (let i = 0; i < datasets[d].values.length; i++) {
      const x = left + i * stepX;
      const y = top + chartH - (datasets[d].values[i] / scale.max) * chartH;
      svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="${c}" stroke="#fff" stroke-width="1.5"/>`;
    }
  }

  const entries = datasets.map((d, i) => ({ label: d.label, color: d.color || color(i) }));
  svg += svgLegendItems(entries, left, h - 20, chartW);

  return svg;
}

// ─── Stacked Bar Chart ────────────────────────────────────────────────────────

function renderStackedBar(cfg: ChartConfig, w: number, h: number): string {
  const { labels, datasets } = cfg;
  if (labels.length === 0 || datasets.length === 0) return '';

  const left = 70, right = 20, top = 50, bottom = 80;
  const legendH = 30;
  const chartW = w - left - right;
  const chartH = h - top - bottom - legendH;

  const stackTotals = labels.map((_, i) => datasets.reduce((s, d) => s + (d.values[i] ?? 0), 0));
  const dataMax = Math.max(...stackTotals, 0);
  const scale = niceScale(dataMax);

  let svg = '';

  for (const v of scale.values) {
    const y = top + chartH - (v / scale.max) * chartH;
    svg += `<line x1="${left}" y1="${y}" x2="${left + chartW}" y2="${y}" stroke="${GRID_COLOR}" stroke-dasharray="3,3"/>`;
    svg += `<text x="${left - 8}" y="${y + 4}" text-anchor="end" font-family="${FONT}" font-size="10" fill="${AXIS_COLOR}">${fmtNum(v)}</text>`;
  }

  svg += `<line x1="${left}" y1="${top}" x2="${left}" y2="${top + chartH}" stroke="${AXIS_COLOR}"/>`;
  svg += `<line x1="${left}" y1="${top + chartH}" x2="${left + chartW}" y2="${top + chartH}" stroke="${AXIS_COLOR}"/>`;

  const groupW = chartW / labels.length;
  const barW = Math.max(4, groupW * 0.7);
  const pad = (groupW - barW) / 2;

  for (let i = 0; i < labels.length; i++) {
    let cumulative = 0;
    for (let d = 0; d < datasets.length; d++) {
      const val = datasets[d].values[i] ?? 0;
      const segH = scale.max > 0 ? (val / scale.max) * chartH : 0;
      const bx = left + i * groupW + pad;
      const by = top + chartH - cumulative / scale.max * chartH - segH;
      svg += `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${segH.toFixed(1)}" fill="${datasets[d].color || color(d)}"/>`;
      cumulative += val;
    }

    const lx = left + i * groupW + groupW / 2;
    const rotated = labels[i].length > 8 || labels.length > 8;
    if (rotated) {
      svg += `<text x="${lx}" y="${top + chartH + 14}" text-anchor="end" font-family="${FONT}" font-size="10" fill="${AXIS_COLOR}" transform="rotate(-40,${lx},${top + chartH + 14})">${esc(truncate(labels[i], 16))}</text>`;
    } else {
      svg += `<text x="${lx}" y="${top + chartH + 18}" text-anchor="middle" font-family="${FONT}" font-size="10" fill="${AXIS_COLOR}">${esc(truncate(labels[i], 16))}</text>`;
    }
  }

  const entries = datasets.map((d, i) => ({ label: d.label, color: d.color || color(i) }));
  svg += svgLegendItems(entries, left, h - 20, chartW);

  return svg;
}

// ─── Public API: SVG Generation ───────────────────────────────────────────────

export function generateSvgChart(config: ChartConfig): string {
  const w = config.width ?? 800;
  const h = config.height ?? 500;

  let svg = svgOpen(w, h);
  svg += svgTitle(config.title, w);

  switch (config.type) {
    case 'pie':            svg += renderPie(config, w, h); break;
    case 'bar':            svg += renderBar(config, w, h); break;
    case 'horizontal_bar': svg += renderHorizontalBar(config, w, h); break;
    case 'line':           svg += renderLine(config, w, h); break;
    case 'stacked_bar':    svg += renderStackedBar(config, w, h); break;
  }

  svg += '</svg>';
  return svg;
}

// ─── Public API: PNG via sharp ────────────────────────────────────────────────

export async function generatePngChart(config: ChartConfig): Promise<Buffer> {
  const svg = generateSvgChart(config);
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// ─── Public API: HTML with Chart.js ───────────────────────────────────────────

export function generateHtmlChart(config: ChartConfig): string {
  const chartJsType = config.type === 'horizontal_bar' ? 'bar'
    : config.type === 'stacked_bar' ? 'bar'
    : config.type;

  const indexAxis = config.type === 'horizontal_bar' ? `indexAxis: 'y',` : '';

  const stacked = config.type === 'stacked_bar'
    ? `scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } },`
    : `scales: { y: { beginAtZero: true } },`;

  const isPie = config.type === 'pie';

  const datasets = config.datasets.map((d, di) => {
    const colors = isPie
      ? config.labels.map((_, i) => color(i))
      : [d.color || color(di)];
    return {
      label: d.label,
      data: d.values,
      backgroundColor: isPie ? colors : colors[0],
      borderColor: isPie ? '#fff' : colors[0],
      borderWidth: isPie ? 2 : 1,
      tension: config.type === 'line' ? 0.3 : undefined,
      fill: false,
    };
  });

  const chartConfig = {
    type: chartJsType,
    data: { labels: config.labels, datasets },
    options: {
      responsive: true,
      plugins: { title: { display: true, text: config.title, font: { size: 18 } } },
    },
  };

  const optionsStr = `{
    responsive: true,
    ${indexAxis}
    plugins: {
      title: { display: true, text: ${JSON.stringify(config.title)}, font: { size: 18 } },
      legend: { position: '${isPie ? 'right' : 'top'}' }
    },
    ${isPie ? '' : stacked}
  }`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(config.title)}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 24px; background: #fafafa; }
  .container { max-width: 900px; margin: 0 auto; background: #fff; border-radius: 8px; padding: 24px; box-shadow: 0 1px 4px rgba(0,0,0,.1); }
  canvas { max-width: 100%; }
</style>
</head>
<body>
<div class="container">
<canvas id="chart"></canvas>
</div>
<script>
new Chart(document.getElementById('chart'), {
  type: '${chartJsType}',
  data: ${JSON.stringify({ labels: config.labels, datasets })},
  options: ${optionsStr}
});
</script>
</body>
</html>`;
}

// ─── Public API: Text / Markdown ──────────────────────────────────────────────

export function generateTextChart(config: ChartConfig): string {
  const { type, title, labels, datasets } = config;
  const maxBarLen = 30;

  let out = `## ${title}\n\n`;

  if (type === 'pie') {
    const values = datasets[0]?.values ?? [];
    const total = values.reduce((s, v) => s + v, 0);
    const maxLabelLen = Math.max(...labels.map(l => l.length), 5);

    out += `| ${'Label'.padEnd(maxLabelLen)} | Count | Pct    |${''.padEnd(maxBarLen + 2)}|\n`;
    out += `|${''.padEnd(maxLabelLen + 2, '-')}|-------|--------|${''.padEnd(maxBarLen + 2, '-')}|\n`;

    for (let i = 0; i < labels.length; i++) {
      const v = values[i] ?? 0;
      const p = total > 0 ? (v / total) * 100 : 0;
      const barLen = total > 0 ? Math.round((v / total) * maxBarLen) : 0;
      out += `| ${labels[i].padEnd(maxLabelLen)} | ${String(v).padStart(5)} | ${p.toFixed(1).padStart(5)}% | ${'█'.repeat(barLen).padEnd(maxBarLen)} |\n`;
    }
    out += `\n**Total: ${fmtNum(total)}**\n`;
    return out;
  }

  if (type === 'horizontal_bar' || (type === 'bar' && datasets.length === 1)) {
    const values = datasets[0]?.values ?? [];
    const maxVal = Math.max(...values, 1);
    const maxLabelLen = Math.max(...labels.map(l => l.length), 5);

    for (let i = 0; i < labels.length; i++) {
      const v = values[i] ?? 0;
      const barLen = Math.round((v / maxVal) * maxBarLen);
      out += `${labels[i].padEnd(maxLabelLen)} |${'█'.repeat(barLen)} ${fmtNum(v)}\n`;
    }
    return out;
  }

  if (type === 'line') {
    const header = ['#', ...datasets.map(d => d.label)];
    out += `| ${header.join(' | ')} |\n`;
    out += `|${header.map(() => '---').join('|')}|\n`;
    for (let i = 0; i < labels.length; i++) {
      const row = [labels[i], ...datasets.map(d => fmtNum(d.values[i] ?? 0))];
      out += `| ${row.join(' | ')} |\n`;
    }
    return out;
  }

  // stacked_bar or multi-dataset bar → table
  const header = ['Category', ...datasets.map(d => d.label), 'Total'];
  out += `| ${header.join(' | ')} |\n`;
  out += `|${header.map(() => '---').join('|')}|\n`;
  for (let i = 0; i < labels.length; i++) {
    const vals = datasets.map(d => d.values[i] ?? 0);
    const total = vals.reduce((s, v) => s + v, 0);
    out += `| ${labels[i]} | ${vals.map(v => fmtNum(v)).join(' | ')} | ${fmtNum(total)} |\n`;
  }
  return out;
}

// ─── Response Builder ─────────────────────────────────────────────────────────

export async function buildChartResponse(
  config: ChartConfig,
  format: 'png' | 'html' | 'text',
  summaryText: string
): Promise<{ content: McpContent[] }> {
  switch (format) {
    case 'png': {
      const buf = await generatePngChart(config);
      return {
        content: [
          { type: 'text' as const, text: summaryText },
          { type: 'image' as const, data: buf.toString('base64'), mimeType: 'image/png' },
        ],
      };
    }
    case 'html': {
      const html = generateHtmlChart(config);
      return { content: [{ type: 'text' as const, text: `${summaryText}\n\n${html}` }] };
    }
    case 'text': {
      const text = generateTextChart(config);
      return { content: [{ type: 'text' as const, text: `${summaryText}\n\n${text}` }] };
    }
  }
}
