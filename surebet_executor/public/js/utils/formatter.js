/** Format odds with fixed 2 decimals */
export function fmtOdds(v) {
  if (v == null) return '—';
  return Number(v).toFixed(2);
}

/** Format profit % with color class */
export function profitClass(pct) {
  if (pct >= 3) return 'profit-high';
  if (pct >= 1.5) return 'profit-mid';
  return 'profit-low';
}

/** Relative time ago */
export function timeAgo(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

/** Escape HTML */
export function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

/** Format scope badge */
export function scopeBadge(scope) {
  if (!scope) return '';
  const s = scope.toLowerCase();
  const map = {
    live:     { cls: 'badge-live', label: 'LIVE' },
    prematch: { cls: 'badge-pre',  label: 'PRE' },
    ft:       { cls: 'badge-ft',   label: 'FT' },
    ht:       { cls: 'badge-ht',   label: 'HT' },
  };
  const entry = map[s] || { cls: 'badge-pre', label: scope.toUpperCase() };
  return `<span class="badge ${entry.cls}">${entry.label}</span>`;
}
