// Lightweight charts in plain SVG/HTML (bundled locally, no libraries).
import { h, s, money, monthShortLabel, monthLabel } from './ui.js';

// Ranked horizontal bars: one series (magnitude), so one hue. Labels are text, not color.
export function rankedBars(items, { onSelect, max = 8 } = {}) {
  const top = items.slice(0, max);
  const rest = items.slice(max);
  const rows = rest.length ? [...top, { id: '__other', name: `אחר (${rest.length})`, icon: '…', amount: rest.reduce((a, b) => a + b.amount, 0), pct: Math.round(rest.reduce((a, b) => a + b.pct, 0) * 10) / 10 }] : top;
  const peak = Math.max(...rows.map(r => r.amount), 1);
  return h('ol', { class: 'ranked' }, rows.map(r =>
    h('li', {},
      h('button', { type: 'button', class: 'ranked-row', disabled: !onSelect || r.id === '__other', onclick: () => onSelect?.(r) },
        h('span', { class: 'ranked-icon', 'aria-hidden': 'true' }, r.icon || '•'),
        h('span', { class: 'ranked-main' },
          h('span', { class: 'ranked-top' }, h('span', { class: 'ranked-name' }, r.name), h('span', { class: 'ranked-amount' }, money(r.amount))),
          h('span', { class: 'ranked-track' }, h('span', { class: 'ranked-bar', style: { width: `${Math.max(r.amount / peak * 100, 1.5)}%` } })),
          h('span', { class: 'ranked-pct' }, `${r.pct}%`))))));
}

// Income vs expenses per month: two series, grouped bars, legend + tap tooltip + table view
export function incomeExpenseBars(months, { height = 180 } = {}) {
  const W = 340;
  const H = height;
  const padTop = 12;
  const padBottom = 24;
  const peak = Math.max(...months.flatMap(m => [m.income, m.expenses]), 1);
  const step = W / months.length;
  const barW = Math.min(14, step / 3.2);
  const y = v => padTop + (H - padTop - padBottom) * (1 - v / peak);
  const base = y(0);
  const tooltip = h('div', { class: 'chart-tip', hidden: true });

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'הכנסות מול הוצאות לפי חודש' });
  // Recessive grid: baseline + mid line
  svg.append(s('line', { x1: 0, x2: W, y1: base, y2: base, class: 'axis' }));
  svg.append(s('line', { x1: 0, x2: W, y1: y(peak / 2), y2: y(peak / 2), class: 'grid' }));

  months.forEach((m, i) => {
    // RTL: the latest month is on the left, like reading order
    const cx = W - (i + 0.5) * step;
    const bar = (v, cls, dx) => {
      const top = y(v);
      const hgt = Math.max(base - top, v > 0 ? 2 : 0);
      return s('path', { class: cls, d: roundedTop(cx + dx - barW / 2, base - hgt, barW, hgt, 4) });
    };
    const group = s('g', { class: 'bar-group' },
      bar(m.income, 'bar income', barW / 2 + 1),
      bar(m.expenses, 'bar expense', -barW / 2 - 1),
      s('text', { x: cx, y: H - 6, class: 'tick', 'text-anchor': 'middle' }, monthShortLabel(m.month)),
      s('rect', { x: cx - step / 2, y: 0, width: step, height: H, class: 'hit' }));
    group.addEventListener('click', () => showTip(m, i));
    svg.append(group);
  });

  function showTip(m, i) {
    svg.querySelectorAll('.bar-group').forEach((g, j) => g.classList.toggle('dim', j !== i));
    tooltip.replaceChildren(
      h('strong', {}, monthLabel(m.month)),
      h('span', {}, h('i', { class: 'key income' }), 'הכנסות ', money(m.income)),
      h('span', {}, h('i', { class: 'key expense' }), 'הוצאות ', money(m.expenses)),
      h('span', { class: m.net >= 0 ? 'pos' : 'neg' }, 'נטו ', money(m.net, { sign: true })));
    tooltip.hidden = false;
  }

  const legend = h('div', { class: 'legend' },
    h('span', {}, h('i', { class: 'key income' }), 'הכנסות'),
    h('span', {}, h('i', { class: 'key expense' }), 'הוצאות'));

  const table = h('details', { class: 'table-view' }, h('summary', {}, 'הצגה כטבלה'),
    h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'חודש'), h('th', {}, 'הכנסות'), h('th', {}, 'הוצאות'), h('th', {}, 'נטו'))),
      h('tbody', {}, months.map(m => h('tr', {}, h('td', {}, monthLabel(m.month)), h('td', {}, money(m.income)), h('td', {}, money(m.expenses)), h('td', {}, money(m.net, { sign: true })))))));

  return h('div', { class: 'chart-wrap' }, legend, svg, tooltip, table);
}

function roundedTop(x, y, w, hgt, r) {
  if (hgt <= 0) return '';
  const rr = Math.min(r, w / 2, hgt);
  return `M${x},${y + hgt} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + hgt} Z`;
}

// Tiny sparkline for a category's monthly amounts
export function sparkline(values, { width = 80, height = 24 } = {}) {
  const peak = Math.max(...values, 1);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const pts = values.map((v, i) => `${(width - i * step).toFixed(1)},${(height - 2 - (height - 4) * v / peak).toFixed(1)}`);
  return s('svg', { viewBox: `0 0 ${width} ${height}`, class: 'spark', 'aria-hidden': 'true' }, s('polyline', { points: pts.join(' ') }));
}
