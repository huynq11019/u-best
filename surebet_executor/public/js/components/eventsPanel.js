import { api } from '../api.js';
import { fmtOdds, esc, scopeBadge } from '../utils/formatter.js';
import { openBetSlip } from './betSlip.js';
import { toast } from './toast.js';

let refreshTimer = null;
let currentBook = '';
let currentMarketFilter = '';

export function initEventsPanel() {
  document.getElementById('events-refresh-btn').addEventListener('click', () => loadEvents());
  document.getElementById('events-market-filter').addEventListener('change', (e) => {
    currentMarketFilter = e.target.value;
    loadEvents();
  });
}

export function setBookmaker(book) {
  currentBook = book;
  loadEvents();
}

export function startAutoRefresh(interval = 10000) {
  stopAutoRefresh();
  refreshTimer = setInterval(() => {
    if (currentBook && document.getElementById('events-auto-refresh').checked) {
      loadEvents(true);
    }
  }, interval);
}

export function stopAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
}

async function loadEvents(silent = false) {
  if (!currentBook) return;
  const container = document.getElementById('events-list');
  if (!silent) container.innerHTML = '<div class="loading">Loading events...</div>';

  try {
    const res = await api.events(currentBook, 'football', currentMarketFilter || undefined);
    renderEvents(res.events || []);
    document.getElementById('events-count').textContent = `${res.count || 0} events`;
    document.getElementById('events-book-label').textContent = currentBook.toUpperCase();
  } catch (err) {
    container.innerHTML = `<div class="error-msg">Failed to load events: ${esc(err.message || 'unknown')}</div>`;
    if (!silent) toast('Failed to load events', 'error');
  }
}

function renderEvents(events) {
  const container = document.getElementById('events-list');
  if (!events.length) {
    container.innerHTML = '<div class="empty-state">No events found</div>';
    return;
  }

  container.innerHTML = events.map((ev, idx) => `
    <div class="event-card" data-idx="${idx}">
      <div class="event-header" data-toggle="${idx}">
        <div class="event-teams">
          <span class="team-home">${esc(ev.homeTeam || ev.home || '?')}</span>
          <span class="vs">vs</span>
          <span class="team-away">${esc(ev.awayTeam || ev.away || '?')}</span>
        </div>
        <div class="event-meta">
          ${scopeBadge(ev.scope)}
          <span class="event-league">${esc(ev.league || '')}</span>
          <span class="event-time">${esc(ev.startTime || '')}</span>
        </div>
        <span class="event-toggle-icon">&#9660;</span>
      </div>
      <div class="event-markets" id="markets-${idx}" style="display:none;">
        ${renderMarkets(ev, idx)}
      </div>
    </div>
  `).join('');

  container.querySelectorAll('[data-toggle]').forEach(el => {
    el.addEventListener('click', () => {
      const idx = el.dataset.toggle;
      const mkts = document.getElementById(`markets-${idx}`);
      const isOpen = mkts.style.display !== 'none';
      mkts.style.display = isOpen ? 'none' : 'block';
      el.querySelector('.event-toggle-icon').innerHTML = isOpen ? '&#9660;' : '&#9650;';
    });
  });

  container.querySelectorAll('[data-bet]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const d = JSON.parse(btn.dataset.bet);
      openBetSlip(d);
    });
  });

  // Store events for detail loading
  container._events = events;
}

function renderMarkets(ev, evIdx) {
  const markets = ev.markets || [];
  if (!markets.length) return '<div class="no-markets">No markets available</div>';

  return `<table class="markets-table">
    <thead>
      <tr>
        <th>Market</th>
        <th>Selection</th>
        <th>Odds</th>
        <th>Line</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      ${markets.map(m => renderMarketRows(m, ev, evIdx)).join('')}
    </tbody>
  </table>`;
}

function renderMarketRows(market, ev, evIdx) {
  const selections = market.selections || [];
  if (selections.length === 0) {
    const selData = {
      bookmakerKey: currentBook,
      eventId: ev.eventId,
      selectionId: market.selectionId || '',
      home: ev.homeTeam || ev.home || '',
      away: ev.awayTeam || ev.away || '',
      league: ev.league || '',
      marketType: market.marketType,
      label: market.selection || market.label || market.marketType,
      odds: market.odds,
      line: market.line,
    };
    return `<tr>
      <td><span class="market-badge mkt-${(market.marketType || '').toLowerCase()}">${esc(market.marketType)}</span></td>
      <td>${esc(market.selection || market.label || '—')}</td>
      <td class="odds-cell">${fmtOdds(market.odds)}</td>
      <td>${market.line != null ? market.line : '—'}</td>
      <td>${market.odds ? `<button class="btn-bet" data-bet='${JSON.stringify(selData).replace(/'/g, "&#39;")}'>Bet</button>` : ''}</td>
    </tr>`;
  }

  return selections.map(sel => {
    const selData = {
      bookmakerKey: currentBook,
      eventId: ev.eventId,
      selectionId: sel.selectionId || sel.id || '',
      home: ev.homeTeam || ev.home || '',
      away: ev.awayTeam || ev.away || '',
      league: ev.league || '',
      marketType: market.marketType,
      label: sel.label || sel.name || '',
      odds: sel.odds,
      line: sel.line ?? market.line,
    };
    return `<tr>
      <td><span class="market-badge mkt-${(market.marketType || '').toLowerCase()}">${esc(market.marketType)}</span></td>
      <td>${esc(sel.label || sel.name || '—')}</td>
      <td class="odds-cell">${fmtOdds(sel.odds)}</td>
      <td>${sel.line != null ? sel.line : (market.line != null ? market.line : '—')}</td>
      <td><button class="btn-bet" data-bet='${JSON.stringify(selData).replace(/'/g, "&#39;")}'>Bet</button></td>
    </tr>`;
  }).join('');
}
