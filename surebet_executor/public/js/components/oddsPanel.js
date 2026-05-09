import { api } from '../api.js';
import { fmtOdds, esc, scopeBadge } from '../utils/formatter.js';
import { openBetSlip } from './betSlip.js';
import { toast } from './toast.js';

let refreshTimer = null;
let currentBook = '';
let currentMarketFilter = '';

export function initOddsPanel() {
  document.getElementById('odds-refresh-btn').addEventListener('click', () => loadOdds());
  document.getElementById('odds-market-filter').addEventListener('change', (e) => {
    currentMarketFilter = e.target.value;
    loadOdds();
  });
}

export function setOddsBookmaker(book) {
  currentBook = book;
  loadOdds();
}

export function startOddsAutoRefresh(interval = 10000) {
  stopOddsAutoRefresh();
  refreshTimer = setInterval(() => {
    if (currentBook && document.getElementById('odds-auto-refresh').checked) {
      loadOdds(true);
    }
  }, interval);
}

export function stopOddsAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
}

async function loadOdds(silent = false) {
  if (!currentBook) return;
  const container = document.getElementById('odds-list');
  if (!silent) container.innerHTML = '<div class="loading">Loading odds...</div>';

  try {
    const res = await api.odds(currentBook, 'football', currentMarketFilter || undefined);
    renderOdds(res.data || []);
    document.getElementById('odds-count').textContent = `${res.count || 0} odds`;
    document.getElementById('odds-book-label').textContent = currentBook.toUpperCase();
  } catch (err) {
    container.innerHTML = `<div class="error-msg">Failed to load odds: ${esc(err.message || 'unknown')}</div>`;
    if (!silent) toast('Failed to load odds', 'error');
  }
}

function renderOdds(data) {
  const container = document.getElementById('odds-list');
  if (!data.length) {
    container.innerHTML = '<div class="empty-state">No odds found</div>';
    return;
  }

  // Group by eventId
  const grouped = {};
  for (const odd of data) {
    const key = odd.eventId || 'unknown';
    if (!grouped[key]) grouped[key] = { event: odd, odds: [] };
    grouped[key].odds.push(odd);
  }

  const entries = Object.values(grouped);

  container.innerHTML = `
    <table class="odds-table">
      <thead>
        <tr>
          <th>Event</th>
          <th>Scope</th>
          <th>Market</th>
          <th>Selection</th>
          <th>Odds</th>
          <th>Line</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${entries.map(g => g.odds.map((o, i) => {
          const selData = {
            bookmakerKey: currentBook,
            eventId: o.eventId || '',
            selectionId: o.selectionId || o.id || '',
            home: o.homeTeam || o.home || g.event.homeTeam || g.event.home || '',
            away: o.awayTeam || o.away || g.event.awayTeam || g.event.away || '',
            league: o.league || g.event.league || '',
            marketType: o.marketType || '',
            label: o.selection || o.label || '',
            odds: o.odds,
            line: o.line,
          };
          return `<tr>
            ${i === 0 ? `<td rowspan="${g.odds.length}" class="event-cell">
              <div class="odds-event-name">${esc(g.event.homeTeam || g.event.home || '?')} vs ${esc(g.event.awayTeam || g.event.away || '?')}</div>
              <div class="odds-event-league">${esc(g.event.league || '')}</div>
            </td>` : ''}
            <td>${scopeBadge(o.scope)}</td>
            <td><span class="market-badge mkt-${(o.marketType || '').toLowerCase()}">${esc(o.marketType || '')}</span></td>
            <td>${esc(o.selection || o.label || '—')}</td>
            <td class="odds-cell">${fmtOdds(o.odds)}</td>
            <td>${o.line != null ? o.line : '—'}</td>
            <td><button class="btn-bet" data-bet='${JSON.stringify(selData).replace(/'/g, "&#39;")}'>Bet</button></td>
          </tr>`;
        }).join('')).join('')}
      </tbody>
    </table>
  `;

  container.querySelectorAll('[data-bet]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openBetSlip(JSON.parse(btn.dataset.bet));
    });
  });
}
