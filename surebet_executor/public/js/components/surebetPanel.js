import { api } from '../api.js';
import { fmtOdds, esc, profitClass, timeAgo, scopeBadge } from '../utils/formatter.js';
import { toast } from './toast.js';

let refreshTimer = null;
let viewMode = 'all'; // 'all' = show all matched events+odds, 'surebet' = surebet only
let sseSource = null;
let pendingNotifications = []; // queued surebet notifications awaiting user action

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

  // Connect to SSE stream for real-time notifications
  connectSSE();

  // Test notification button (simulate worker finding a surebet)
  document.getElementById('surebet-test-notif-btn').addEventListener('click', () => {
    const mockSurebet = {
      matchKey: 'test_' + Date.now(),
      sport: 'football',
      league: 'Premier League',
      home: 'Manchester United',
      away: 'Liverpool',
      scope: 'live',
      line: 2.5,
      matchType: 'exact',
      matchScore: 1.0,
      combination: 'Over_A_Under_B',
      legs: [
        { book: 'lu88', side: 'Over', odds: 2.10, selectionId: 'test_over', eventId: 'test_1', stake_ratio: 0.476 },
        { book: 'x1', side: 'Under', odds: 2.00, selectionId: 'test_under', eventId: 'test_2', stake_ratio: 0.524 },
      ],
      implied: 0.976,
      profit_pct: 2.46,
      fetched_at: new Date().toISOString(),
    };
    showSurebetNotification(mockSurebet);
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

/* ────── SSE Real-time Notifications ────── */

function connectSSE() {
  if (sseSource) sseSource.close();
  sseSource = new EventSource('/api/surebet/stream');

  sseSource.addEventListener('surebet', (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.surebets && data.surebets.length > 0) {
        for (const sb of data.surebets) {
          showSurebetNotification(sb);
        }
      }
    } catch (e) {
      console.error('SSE parse error:', e);
    }
  });

  sseSource.addEventListener('connected', () => {
    console.log('SSE connected to surebet stream');
  });

  sseSource.onerror = () => {
    // Auto-reconnect is handled by EventSource
    console.warn('SSE connection lost, reconnecting...');
  };
}

function showSurebetNotification(surebet) {
  pendingNotifications.push(surebet);

  // Play notification sound
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.value = 0.1;
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch (e) { /* audio not available */ }

  // Show notification toast with action button
  const notifId = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const container = ensureNotificationContainer();

  const profitPct = surebet.profit_pct != null ? surebet.profit_pct.toFixed(2) : '?';
  const leg0 = surebet.legs[0];
  const leg1 = surebet.legs[1];

  const html = `
    <div class="surebet-notification" id="${notifId}" data-surebet-idx="${pendingNotifications.length - 1}">
      <div class="notif-header">
        <span class="notif-icon">&#9889;</span>
        <span class="notif-title">Surebet Found!</span>
        <span class="notif-profit">+${profitPct}%</span>
        <button class="notif-dismiss" data-dismiss="${notifId}">&times;</button>
      </div>
      <div class="notif-body">
        <div class="notif-match">${esc(surebet.home || '?')} vs ${esc(surebet.away || '?')}</div>
        <div class="notif-details">
          <span class="notif-leg">${esc(leg0.book).toUpperCase()} ${esc(leg0.side)} @${fmtOdds(leg0.odds)}</span>
          <span class="notif-vs">+</span>
          <span class="notif-leg">${esc(leg1.book).toUpperCase()} ${esc(leg1.side)} @${fmtOdds(leg1.odds)}</span>
        </div>
        <div class="notif-meta">Line: ${surebet.line} | ${esc(surebet.league || '')} | ${esc(surebet.scope || '')}</div>
      </div>
      <div class="notif-actions">
        <div class="stake-input-group">
          <label>Stake:</label>
          <input type="number" class="notif-stake-input" value="100" min="1" step="10" />
        </div>
        <button class="btn btn-execute" data-execute="${notifId}">Place Bets</button>
        <button class="btn btn-skip" data-dismiss="${notifId}">Skip</button>
      </div>
      <div class="notif-execution-status" id="${notifId}-status" style="display:none;"></div>
    </div>
  `;

  container.insertAdjacentHTML('afterbegin', html);

  // Bind events
  const notifEl = document.getElementById(notifId);
  notifEl.querySelector(`[data-execute="${notifId}"]`).addEventListener('click', () => {
    const stakeInput = notifEl.querySelector('.notif-stake-input');
    const totalStake = parseFloat(stakeInput.value) || 100;
    executeSurebet(surebet, totalStake, notifId);
  });
  notifEl.querySelectorAll(`[data-dismiss="${notifId}"]`).forEach(btn => {
    btn.addEventListener('click', () => {
      notifEl.classList.add('notif-dismissed');
      setTimeout(() => notifEl.remove(), 300);
    });
  });

  // Auto-dismiss after 60 seconds if no action taken
  setTimeout(() => {
    const el = document.getElementById(notifId);
    if (el && !el.classList.contains('notif-executed')) {
      el.classList.add('notif-dismissed');
      setTimeout(() => el.remove(), 300);
    }
  }, 60000);

  toast(`Surebet detected: ${surebet.home} vs ${surebet.away} (+${profitPct}%)`, 'success', 5000);
}

async function executeSurebet(surebet, totalStake, notifId) {
  const notifEl = document.getElementById(notifId);
  const statusEl = document.getElementById(`${notifId}-status`);
  const executeBtn = notifEl.querySelector(`[data-execute="${notifId}"]`);

  // Disable button and show loading
  executeBtn.disabled = true;
  executeBtn.textContent = 'Placing...';
  statusEl.style.display = 'block';
  statusEl.innerHTML = '<div class="exec-loading">Placing bets on both bookmakers...</div>';
  notifEl.classList.add('notif-executing');

  try {
    const result = await api.surebetExecute(surebet, totalStake);

    notifEl.classList.remove('notif-executing');
    notifEl.classList.add('notif-executed');

    if (result.status === 'success' && result.legs) {
      const allPlaced = result.legs.every(l => l.status === 'PLACED');
      if (allPlaced) {
        statusEl.innerHTML = `
          <div class="exec-success">
            <span class="exec-icon">&#10003;</span>
            <span>Both bets placed successfully!</span>
          </div>
          <div class="exec-legs">
            ${result.legs.map(l => `
              <div class="exec-leg exec-leg-success">
                <span class="leg-book">${esc(l.book).toUpperCase()}</span>
                <span class="leg-odds">@${fmtOdds(l.placed_odds)}</span>
                <span class="leg-stake">\$${l.placed_stake}</span>
                <span class="leg-ref">${esc(l.order_ref || '')}</span>
              </div>
            `).join('')}
          </div>
          <div class="exec-profit">
            Expected profit: \$${result.expected_profit_amount} (${result.expected_profit_pct}%)
          </div>
        `;
        toast('Surebet executed successfully!', 'success');
      } else {
        const failedLegs = result.legs.filter(l => l.status !== 'PLACED');
        statusEl.innerHTML = `
          <div class="exec-partial">
            <span class="exec-icon">&#9888;</span>
            <span>Partial execution — ${failedLegs.length} leg(s) failed</span>
          </div>
          <div class="exec-legs">
            ${result.legs.map(l => `
              <div class="exec-leg ${l.status === 'PLACED' ? 'exec-leg-success' : 'exec-leg-failed'}">
                <span class="leg-book">${esc(l.book).toUpperCase()}</span>
                <span class="leg-status">${l.status}</span>
                ${l.error_code ? `<span class="leg-error">${esc(l.error_code)}</span>` : ''}
              </div>
            `).join('')}
          </div>
        `;
        toast('Surebet partially executed — check details', 'error');
      }
    }
  } catch (err) {
    notifEl.classList.remove('notif-executing');
    notifEl.classList.add('notif-failed');
    statusEl.innerHTML = `
      <div class="exec-error">
        <span class="exec-icon">&#10007;</span>
        <span>Execution failed: ${esc(err.message || 'Unknown error')}</span>
      </div>
    `;
    executeBtn.disabled = false;
    executeBtn.textContent = 'Retry';
    toast('Surebet execution failed', 'error');
  }
}

function ensureNotificationContainer() {
  let container = document.getElementById('surebet-notifications');
  if (!container) {
    container = document.createElement('div');
    container.id = 'surebet-notifications';
    container.className = 'surebet-notifications';
    document.body.appendChild(container);
  }
  return container;
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
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        ${surebets.map((s, idx) => renderSurebetRow(s, idx)).join('')}
      </tbody>
    </table>
  `;

  // Bind execute buttons in table
  container.querySelectorAll('[data-execute-row]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.executeRow);
      const sb = surebets[idx];
      if (sb) showSurebetNotification(sb);
    });
  });
}

function renderSurebetRow(s, idx) {
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
    <td class="action-cell"><button class="btn btn-execute-sm" data-execute-row="${idx}">Place</button></td>
  </tr>`;
}
