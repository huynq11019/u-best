import { api } from '../api.js';
import { fmtOdds, esc, profitClass, timeAgo, scopeBadge } from '../utils/formatter.js';
import { toast } from './toast.js';

let refreshTimer = null;
let viewMode = 'all'; // 'all' = show all matched events+odds, 'surebet' = surebet only

export function initSurebetPanel() {
  document.getElementById('surebet-scan-btn').addEventListener('click', () => scanSurebets());
  document.getElementById('surebet-refresh-btn').addEventListener('click', () => loadLatest());
  document.getElementById('surebet-profit-min').addEventListener('change', () => loadLatest());
  document.getElementById('surebet-market-filter').addEventListener('change', () => applyClientFilter());
  document.getElementById('surebet-scope-filter').addEventListener('change', () => applyClientFilter());
  document.getElementById('surebet-match-type-filter').addEventListener('change', () => applyClientFilter());

  // View mode toggle
  document.querySelectorAll('#surebet-view-toggle .view-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      viewMode = btn.dataset.view;
      document.querySelectorAll('#surebet-view-toggle .view-mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyClientFilter();
    });
  });
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
let cachedMatchedEvents = [];

async function scanSurebets() {
  const listContainer = document.getElementById('surebet-list');
  const matchedContainer = document.getElementById('surebet-matched-events');
  const btn = document.getElementById('surebet-scan-btn');
  btn.disabled = true;
  btn.textContent = 'Scanning...';

  const activeContainer = viewMode === 'all' ? matchedContainer : listContainer;
  activeContainer.innerHTML = '<div class="loading">Scanning for surebets...</div>';

  try {
    const minProfit = parseFloat(document.getElementById('surebet-profit-min').value) || 0.5;
    const res = await api.surebetScan({ sport: 'football', minProfitPct: minProfit });
    cachedSurebets = res.surebets || [];
    cachedMatchedEvents = res.matched_events || [];

    applyClientFilter();

    document.getElementById('surebet-summary').innerHTML = `
      <span>${res.matched || 0} matched</span>
      <span class="sep">|</span>
      <span>${res.summary?.total_surebets || 0} surebets</span>
      <span class="sep">|</span>
      <span>Scan: ${res.scan_time_ms || 0}ms</span>
    `;
    toast(`Found ${cachedMatchedEvents.length} matched events, ${cachedSurebets.length} surebets`, 'success');
  } catch (err) {
    activeContainer.innerHTML = `<div class="error-msg">Scan failed: ${esc(err.message || 'unknown')}</div>`;
    toast('Surebet scan failed', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Scan Now';
  }
}

async function loadLatest(silent = false) {
  const listContainer = document.getElementById('surebet-list');
  if (!silent) listContainer.innerHTML = '<div class="loading">Loading surebets...</div>';

  try {
    const minProfit = parseFloat(document.getElementById('surebet-profit-min').value) || 0;
    const res = await api.surebetLatest({ limit: 100, minProfitPct: minProfit });
    cachedSurebets = res.surebets || [];
    // Latest endpoint may not have matched_events; keep existing cache
    if (res.matched_events) {
      cachedMatchedEvents = res.matched_events;
    }
    applyClientFilter();
    document.getElementById('surebet-summary').innerHTML = `
      <span>${cachedMatchedEvents.length} matched</span>
      <span class="sep">|</span>
      <span>${cachedSurebets.length} surebets</span>
      <span class="sep">|</span>
      <span>Updated: ${timeAgo(res.fetched_at)}</span>
    `;
  } catch (err) {
    if (!silent) {
      listContainer.innerHTML = `<div class="error-msg">Failed to load: ${esc(err.message || 'unknown')}</div>`;
    }
  }
}

function applyClientFilter() {
  const marketFilter = document.getElementById('surebet-market-filter').value;
  const scopeFilter = document.getElementById('surebet-scope-filter').value;
  const matchTypeFilter = document.getElementById('surebet-match-type-filter').value;

  const listContainer = document.getElementById('surebet-list');
  const matchedContainer = document.getElementById('surebet-matched-events');

  if (viewMode === 'all') {
    listContainer.style.display = 'none';
    matchedContainer.style.display = 'block';

    let filtered = cachedMatchedEvents;
    if (scopeFilter) {
      filtered = filtered.filter(m =>
        (m.eventA.scope || '').toLowerCase() === scopeFilter.toLowerCase() ||
        (m.eventB.scope || '').toLowerCase() === scopeFilter.toLowerCase()
      );
    }
    if (matchTypeFilter) {
      filtered = filtered.filter(m => m.matchType === matchTypeFilter);
    }
    renderMatchedEvents(filtered);
  } else {
    matchedContainer.style.display = 'none';
    listContainer.style.display = 'block';

    let filtered = cachedSurebets;
    if (marketFilter) {
      filtered = filtered.filter(s => (s.market || '').toUpperCase() === marketFilter.toUpperCase());
    }
    if (scopeFilter) {
      filtered = filtered.filter(s => (s.scope || '').toLowerCase() === scopeFilter.toLowerCase());
    }
    renderSurebets(filtered);
  }
}

/* ────── Matched Events View ────── */

function renderMatchedEvents(matchedEvents) {
  const container = document.getElementById('surebet-matched-events');
  if (!matchedEvents.length) {
    container.innerHTML = '<div class="empty-state">No matched events found — click "Scan Now" to start</div>';
    return;
  }

  // Sort: surebet events first, then by score descending
  const sorted = [...matchedEvents].sort((a, b) => {
    if (a.surebetCount > 0 && b.surebetCount === 0) return -1;
    if (a.surebetCount === 0 && b.surebetCount > 0) return 1;
    return b.score - a.score;
  });

  container.innerHTML = sorted.map((m, idx) => renderMatchedEventCard(m, idx)).join('');

  // Toggle collapse/expand
  container.querySelectorAll('[data-toggle-match]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.toggleMatch;
      const body = document.getElementById(`match-body-${id}`);
      const isOpen = body.style.display !== 'none';
      body.style.display = isOpen ? 'none' : 'block';
      el.querySelector('.match-toggle-icon').innerHTML = isOpen ? '&#9660;' : '&#9650;';
    });
  });
}

function renderMatchedEventCard(m, idx) {
  const hasSurebet = m.surebetCount > 0;
  const matchBadgeCls = m.matchType === 'exact' ? 'match-badge-exact' : 'match-badge-fuzzy';
  const scoreLabel = m.matchType === 'exact' ? 'Exact' : `Fuzzy ${(m.score * 100).toFixed(0)}%`;
  const cardCls = hasSurebet ? 'matched-card matched-card-surebet' : 'matched-card';

  return `
    <div class="${cardCls}">
      <div class="matched-header" data-toggle-match="${idx}">
        <div class="matched-teams">
          <span class="team-home">${esc(m.eventA.home)}</span>
          <span class="vs">vs</span>
          <span class="team-away">${esc(m.eventA.away)}</span>
        </div>
        <div class="matched-meta">
          ${scopeBadge(m.eventA.scope)}
          <span class="match-badge ${matchBadgeCls}">${scoreLabel}</span>
          <span class="event-league">${esc(m.eventA.league || '')}</span>
          ${hasSurebet ? `<span class="surebet-indicator">${m.surebetCount} surebet${m.surebetCount > 1 ? 's' : ''} · ${m.bestProfit.toFixed(2)}%</span>` : ''}
        </div>
        <span class="match-toggle-icon">&#9660;</span>
      </div>
      <div class="matched-body" id="match-body-${idx}" style="display:none;">
        ${renderOddsComparison(m)}
      </div>
    </div>
  `;
}

function renderOddsComparison(m) {
  const marketsA = m.eventA.markets || [];
  const marketsB = m.eventB.markets || [];

  if (!marketsA.length && !marketsB.length) {
    return '<div class="no-markets">No odds data available</div>';
  }

  // Build comparison rows: for each market type + line, show side-by-side odds
  const rows = [];
  const allMarketTypes = new Set([
    ...marketsA.map(mk => mk.marketType),
    ...marketsB.map(mk => mk.marketType),
  ]);

  for (const mktType of allMarketTypes) {
    const mktA = marketsA.find(mk => mk.marketType === mktType);
    const mktB = marketsB.find(mk => mk.marketType === mktType);
    const linesA = mktA ? (mktA.lines || []) : [];
    const linesB = mktB ? (mktB.lines || []) : [];

    const allLines = new Set([
      ...linesA.map(l => l.line),
      ...linesB.map(l => l.line),
    ]);

    for (const line of [...allLines].sort((a, b) => a - b)) {
      const lineA = linesA.find(l => l.line === line);
      const lineB = linesB.find(l => l.line === line);
      const selsA = lineA ? lineA.selections || [] : [];
      const selsB = lineB ? lineB.selections || [] : [];

      // Pair selections by side
      const sides = new Set([
        ...selsA.map(s => s.side),
        ...selsB.map(s => s.side),
      ]);

      for (const side of sides) {
        const selA = selsA.find(s => s.side === side);
        const selB = selsB.find(s => s.side === side);
        const oddsA = selA ? selA.odds : null;
        const oddsB = selB ? selB.odds : null;

        // Highlight the better odds
        let clsA = '', clsB = '';
        if (oddsA != null && oddsB != null) {
          if (oddsA > oddsB) clsA = 'odds-better';
          else if (oddsB > oddsA) clsB = 'odds-better';
        }

        rows.push({ mktType, line, side, oddsA, oddsB, clsA, clsB });
      }
    }
  }

  if (!rows.length) {
    return '<div class="no-markets">No comparable odds found</div>';
  }

  return `
    <div class="odds-comparison-header">
      <span class="comp-book comp-book-a">${esc(m.eventA.book).toUpperCase()}: ${esc(m.eventA.home)} vs ${esc(m.eventA.away)}</span>
      <span class="comp-vs">⟷</span>
      <span class="comp-book comp-book-b">${esc(m.eventB.book).toUpperCase()}: ${esc(m.eventB.home)} vs ${esc(m.eventB.away)}</span>
    </div>
    <table class="odds-comparison-table">
      <thead>
        <tr>
          <th>Market</th>
          <th>Line</th>
          <th>Side</th>
          <th>${esc(m.eventA.book).toUpperCase()}</th>
          <th>${esc(m.eventB.book).toUpperCase()}</th>
          <th>Diff</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => {
          const diff = (r.oddsA != null && r.oddsB != null) ? (r.oddsA - r.oddsB).toFixed(3) : '—';
          const diffCls = parseFloat(diff) > 0 ? 'diff-pos' : parseFloat(diff) < 0 ? 'diff-neg' : '';
          return `<tr>
            <td><span class="market-badge mkt-${(r.mktType || '').toLowerCase()}">${esc(r.mktType)}</span></td>
            <td>${r.line != null ? r.line : '—'}</td>
            <td>${esc(r.side || '—')}</td>
            <td class="odds-cell ${r.clsA}">${fmtOdds(r.oddsA)}</td>
            <td class="odds-cell ${r.clsB}">${fmtOdds(r.oddsB)}</td>
            <td class="diff-cell ${diffCls}">${diff}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
}

/* ────── Surebet-Only View (original) ────── */

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
    `<span class="leg-tag">${esc(l.label || l.side || l.type || '?')}@${esc(l.book || '?')}<span class="leg-odds">${fmtOdds(l.odds)}</span></span>`
  ).join('');

  return `<tr class="surebet-row ${pctClass}">
    <td class="match-cell">
      <div>${esc(s.home || '?')} vs ${esc(s.away || '?')}</div>
    </td>
    <td>${esc(s.b188_league_name || s.x1_league_name || s.saba_league_name || s.league || '—')}</td>
    <td><span class="market-badge mkt-${(s.market || s.combination || '').toLowerCase()}">${esc(s.market || s.combination || '—')}</span></td>
    <td>${s.line != null ? s.line : '—'}</td>
    <td>${esc(s.scope || '—')}</td>
    <td class="profit-cell ${pctClass}">${s.profit_pct != null ? s.profit_pct.toFixed(2) + '%' : '—'}</td>
    <td class="legs-cell">${legsHtml}</td>
    <td>${esc(s.from_books || legs.map(l => l.book).filter(Boolean).join(', ') || '—')}</td>
    <td class="time-cell">${timeAgo(s.updated_at || s.discovered_at || s.fetched_at)}</td>
  </tr>`;
}
