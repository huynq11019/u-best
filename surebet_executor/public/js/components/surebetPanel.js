import { api } from '../api.js';
import { fmtOdds, esc, profitClass, timeAgo } from '../utils/formatter.js';
import { toast } from './toast.js';

let refreshTimer = null;

export function initSurebetPanel() {
  document.getElementById('surebet-scan-btn').addEventListener('click', () => scanSurebets());
  document.getElementById('surebet-refresh-btn').addEventListener('click', () => loadLatest());
  document.getElementById('surebet-profit-min').addEventListener('change', () => loadLatest());
  document.getElementById('surebet-market-filter').addEventListener('change', () => applyClientFilter());
  document.getElementById('surebet-scope-filter').addEventListener('change', () => applyClientFilter());
}

export function startSurebetAutoRefresh(interval = 15000) {
  stopSurebetAutoRefresh();
  refreshTimer = setInterval(() => {
    if (document.getElementById('surebet-auto-refresh').checked) {
      loadLatest(true);
    }
  }, interval);
}

export function stopSurebetAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
}

let cachedSurebets = [];

async function scanSurebets() {
  const container = document.getElementById('surebet-list');
  const btn = document.getElementById('surebet-scan-btn');
  btn.disabled = true;
  btn.textContent = 'Scanning...';
  container.innerHTML = '<div class="loading">Scanning for surebets...</div>';

  try {
    const minProfit = parseFloat(document.getElementById('surebet-profit-min').value) || 0.5;
    const res = await api.surebetScan({ sport: 'football', minProfitPct: minProfit });
    cachedSurebets = res.surebets || [];
    renderSurebets(cachedSurebets);
    document.getElementById('surebet-summary').innerHTML = `
      <span>${res.summary?.total_surebets || 0} surebets</span>
      <span class="sep">|</span>
      <span>Scan: ${res.scan_time_ms || 0}ms</span>
      <span class="sep">|</span>
      <span>Matched: ${res.matched || 0} events</span>
    `;
    toast(`Found ${cachedSurebets.length} surebets`, 'success');
  } catch (err) {
    container.innerHTML = `<div class="error-msg">Scan failed: ${esc(err.message || 'unknown')}</div>`;
    toast('Surebet scan failed', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Scan Now';
  }
}

async function loadLatest(silent = false) {
  const container = document.getElementById('surebet-list');
  if (!silent) container.innerHTML = '<div class="loading">Loading surebets...</div>';

  try {
    const minProfit = parseFloat(document.getElementById('surebet-profit-min').value) || 0;
    const res = await api.surebetLatest({ limit: 100, minProfitPct: minProfit });
    cachedSurebets = res.surebets || [];
    applyClientFilter();
    document.getElementById('surebet-summary').innerHTML = `
      <span>${cachedSurebets.length} surebets</span>
      <span class="sep">|</span>
      <span>Updated: ${timeAgo(res.fetched_at)}</span>
    `;
  } catch (err) {
    if (!silent) {
      container.innerHTML = `<div class="error-msg">Failed to load: ${esc(err.message || 'unknown')}</div>`;
    }
  }
}

function applyClientFilter() {
  const marketFilter = document.getElementById('surebet-market-filter').value;
  const scopeFilter = document.getElementById('surebet-scope-filter').value;

  let filtered = cachedSurebets;
  if (marketFilter) {
    filtered = filtered.filter(s => (s.market || '').toUpperCase() === marketFilter.toUpperCase());
  }
  if (scopeFilter) {
    filtered = filtered.filter(s => (s.scope || '').toLowerCase() === scopeFilter.toLowerCase());
  }
  renderSurebets(filtered);
}

function renderSurebets(surebets) {
  const container = document.getElementById('surebet-list');
  if (!surebets.length) {
    container.innerHTML = '<div class="empty-state">No surebets found</div>';
    return;
  }

  container.innerHTML = `
    <table class="surebet-table">
      <thead>
        <tr>
          <th>Match</th>
          <th>League</th>
          <th>Market</th>
          <th>Line</th>
          <th>Scope</th>
          <th>Profit %</th>
          <th>Legs</th>
          <th>Books</th>
          <th>Updated</th>
        </tr>
      </thead>
      <tbody>
        ${surebets.map(s => renderSurebetRow(s)).join('')}
      </tbody>
    </table>
  `;
}

function renderSurebetRow(s) {
  const pctClass = profitClass(s.profit_pct);
  const legs = s.legs || (s.bet && s.bet.legs) || [];
  const legsHtml = legs.map(l =>
    `<span class="leg-tag">${esc(l.label || `${l.type}@${l.book}`)}<span class="leg-odds">${fmtOdds(l.odds)}</span></span>`
  ).join('');

  return `<tr class="surebet-row ${pctClass}">
    <td class="match-cell">
      <div>${esc(s.home || '?')} vs ${esc(s.away || '?')}</div>
    </td>
    <td>${esc(s.b188_league_name || s.x1_league_name || s.saba_league_name || s.league || '—')}</td>
    <td><span class="market-badge mkt-${(s.market || '').toLowerCase()}">${esc(s.market || '—')}</span></td>
    <td>${s.line != null ? s.line : '—'}</td>
    <td>${esc(s.scope || '—')}</td>
    <td class="profit-cell ${pctClass}">${s.profit_pct != null ? s.profit_pct.toFixed(2) + '%' : '—'}</td>
    <td class="legs-cell">${legsHtml}</td>
    <td>${esc(s.from_books || '—')}</td>
    <td class="time-cell">${timeAgo(s.updated_at)}</td>
  </tr>`;
}
