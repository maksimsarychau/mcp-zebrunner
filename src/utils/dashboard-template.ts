/**
 * Self-contained HTML dashboard template for the Quality Dashboard tool.
 *
 * Produces a single HTML file with embedded Chart.js (CDN) and a
 * responsive 2-column grid of 5 metric panels.
 */

export interface DashboardSection {
  id: string;
  title: string;
  chartType: 'pie' | 'bar' | 'horizontal_bar' | 'stacked_bar' | 'line' | 'table';
  labels: string[];
  datasets: { label: string; data: number[]; backgroundColor?: string | string[] }[];
  tableRows?: string[][];
  tableHeaders?: string[];
  summary?: string;
}

export interface DashboardData {
  title: string;
  period: string;
  projects: string[];
  generatedAt: string;
  sections: DashboardSection[];
}

const CHART_JS_CDN = 'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js';

const COLORS = {
  passed: '#59a14f',
  failed: '#e15759',
  skipped: '#f28e2b',
  knownIssue: '#edc948',
  aborted: '#bab0ac',
  automated: '#4e79a7',
  manual: '#f28e2b',
  notAutomated: '#e15759',
  short: '#59a14f',
  medium: '#f28e2b',
  long: '#e15759',
};

const PALETTE = [
  '#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f',
  '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac',
];

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function chartTypeToChartJs(t: DashboardSection['chartType']): string {
  switch (t) {
    case 'pie': return 'pie';
    case 'bar': case 'stacked_bar': return 'bar';
    case 'horizontal_bar': return 'bar';
    case 'line': return 'line';
    default: return 'bar';
  }
}

function buildChartOptions(section: DashboardSection): string {
  const opts: any = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      title: { display: true, text: section.title, font: { size: 14, weight: 'bold' } },
      legend: { position: 'bottom', labels: { boxWidth: 12, padding: 8 } },
    },
  };

  if (section.chartType === 'stacked_bar') {
    opts.scales = {
      x: { stacked: true },
      y: { stacked: true, beginAtZero: true },
    };
  } else if (section.chartType === 'horizontal_bar') {
    opts.indexAxis = 'y';
    opts.scales = { x: { beginAtZero: true } };
  } else if (section.chartType === 'bar') {
    opts.scales = { y: { beginAtZero: true } };
  }

  return JSON.stringify(opts);
}

function buildChartData(section: DashboardSection): string {
  const datasets = section.datasets.map((ds, i) => {
    const bg = ds.backgroundColor ?? PALETTE[i % PALETTE.length];
    return {
      label: ds.label,
      data: ds.data,
      backgroundColor: bg,
      borderWidth: section.chartType === 'pie' ? 2 : 1,
      borderColor: section.chartType === 'pie' ? '#fff' : undefined,
    };
  });

  return JSON.stringify({ labels: section.labels, datasets });
}

function renderTableHtml(section: DashboardSection): string {
  if (!section.tableHeaders || !section.tableRows) return '';
  const headerRow = section.tableHeaders.map(h => `<th>${esc(h)}</th>`).join('');
  const bodyRows = section.tableRows.map(row =>
    '<tr>' + row.map(cell => `<td>${esc(cell)}</td>`).join('') + '</tr>'
  ).join('\n');

  return `
    <div class="panel" style="grid-column: 1 / -1;">
      <h3>${esc(section.title)}</h3>
      ${section.summary ? `<p class="summary">${esc(section.summary)}</p>` : ''}
      <div class="table-wrap">
        <table>
          <thead><tr>${headerRow}</tr></thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
    </div>`;
}

function renderChartPanel(section: DashboardSection, idx: number): string {
  const canvasId = `chart_${idx}`;
  return `
    <div class="panel">
      ${section.summary ? `<p class="summary">${esc(section.summary)}</p>` : ''}
      <div class="chart-container"><canvas id="${canvasId}"></canvas></div>
    </div>`;
}

export function generateDashboardHtml(data: DashboardData): string {
  const chartSections = data.sections.filter(s => s.chartType !== 'table');
  const tableSections = data.sections.filter(s => s.chartType === 'table');

  const chartPanels = chartSections.map((s, i) => renderChartPanel(s, i)).join('\n');
  const tablePanels = tableSections.map(s => renderTableHtml(s)).join('\n');

  const chartInitCode = chartSections.map((s, i) => `
    new Chart(document.getElementById('chart_${i}'), {
      type: '${chartTypeToChartJs(s.chartType)}',
      data: ${buildChartData(s)},
      options: ${buildChartOptions(s)}
    });`).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(data.title)}</title>
<script src="${CHART_JS_CDN}"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f6fa; color: #333; padding: 24px; }
  .header { text-align: center; margin-bottom: 24px; }
  .header h1 { font-size: 22px; margin-bottom: 4px; }
  .header .meta { color: #666; font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; max-width: 1200px; margin: 0 auto; }
  .panel { background: #fff; border-radius: 8px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .chart-container { position: relative; height: 280px; }
  .summary { font-size: 12px; color: #666; margin-bottom: 8px; }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { padding: 6px 10px; text-align: left; border-bottom: 1px solid #eee; }
  th { background: #f8f9fa; font-weight: 600; }
  tr:hover td { background: #f8f9fa; }
  @media (max-width: 768px) { .grid { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<div class="header">
  <h1>${esc(data.title)}</h1>
  <div class="meta">Projects: ${data.projects.map(esc).join(', ')} &middot; Period: ${esc(data.period)} &middot; Generated: ${esc(data.generatedAt)}</div>
</div>
<div class="grid">
${chartPanels}
${tablePanels}
</div>
<script>
document.addEventListener('DOMContentLoaded', function() {
${chartInitCode}
});
</script>
</body>
</html>`;
}
