import { api } from '../api.js';
import { fmtOdds, esc, scopeBadge } from '../utils/formatter.js';
import { openBetSlip } from './betSlip.js';
import { toast } from './toast.js';

let refreshTimer = null;
let currentBook = '';
let currentMarketFilter = '';
// Cache event details đã load để tránh gọi API lại
const eventDetailsCache = new Map();

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

// Track open eventIds to preserve state across refreshes
const openEventIds = new Set();

function renderEvents(events) {
  const container = document.getElementById('events-list');
  if (!events.length) {
    container.innerHTML = '<div class="empty-state">No events found</div>';
    return;
  }

  // Capture currently open panels before re-rendering
  if (container._events) {
    container.querySelectorAll('.event-markets').forEach((mkts, idx) => {
      if (mkts.style.display !== 'none') {
        const ev = container._events[idx];
        if (ev) openEventIds.add(ev.eventId);
      }
    });
  }

  container.innerHTML = events.map((ev, idx) => {
    // Render score if available (live events)
    const score = ev.score;
    const hasScore = score && score.FS;
    const scoreHtml = hasScore
      ? `<span class="event-score">${score.FS.S1 || 0} - ${score.FS.S2 || 0}</span>`
      : '';
    const liveTimeHtml = hasScore && score.SLS
      ? `<span class="live-time">${esc(score.SLS)}</span>`
      : '';

    // Check if this event was open before (and we have cached data)
    const wasOpen = openEventIds.has(ev.eventId);
    const hasCachedData = eventDetailsCache.has(`${currentBook}:${ev.eventId}`);
    const displayStyle = wasOpen && hasCachedData ? 'block' : 'none';
    const iconHtml = wasOpen && hasCachedData ? '&#9650;' : '&#9660;';

    return `<div class="event-card" data-idx="${idx}" data-event-id="${ev.eventId}">
      <div class="event-header" data-toggle="${idx}">
        <div class="event-teams">
          <span class="team-home">${esc(ev.homeTeam || ev.home || '?')}</span>
          ${scoreHtml ? scoreHtml : '<span class="vs">vs</span>'}
          <span class="team-away">${esc(ev.awayTeam || ev.away || '?')}</span>
          ${liveTimeHtml}
        </div>
        <div class="event-meta">
          ${scopeBadge(ev.scope)}
          <span class="event-league">${esc(ev.league || '')}</span>
          <span class="event-time">${esc(ev.startTime || '')}</span>
        </div>
        <span class="event-toggle-icon">${iconHtml}</span>
      </div>
      <div class="event-markets" id="markets-${idx}" style="display:${displayStyle};">
        <div class="markets-toolbar">
          <button class="btn-refresh-odds" data-refresh="${ev.eventId}" data-idx="${idx}" title="Refresh odds">Refresh</button>
        </div>
        <div class="markets-content" id="markets-content-${idx}">
          ${wasOpen && hasCachedData ? renderMarkets(eventDetailsCache.get(`${currentBook}:${ev.eventId}`), idx) : renderMarkets(ev, idx)}
        </div>
      </div>
    </div>`;
  }).join('');

  container.querySelectorAll('[data-toggle]').forEach(el => {
    el.addEventListener('click', async () => {
      const idx = el.dataset.toggle;
      const mkts = document.getElementById(`markets-${idx}`);
      const isOpen = mkts.style.display !== 'none';
      const events = container._events || [];
      const ev = events[idx];
      if (!ev) return;

      if (isOpen) {
        // Đang mở -> đóng lại
        mkts.style.display = 'none';
        el.querySelector('.event-toggle-icon').innerHTML = '&#9660;';
        openEventIds.delete(ev.eventId);
      } else {
        // Đang đóng -> mở
        mkts.style.display = 'block';
        el.querySelector('.event-toggle-icon').innerHTML = '&#9650;';
        openEventIds.add(ev.eventId);

        // Load event detail từ API (nếu chưa có trong cache)
        const cacheKey = `${currentBook}:${ev.eventId}`;
        if (!eventDetailsCache.has(cacheKey)) {
          await loadEventDetail(ev, idx);
        }
      }
    });
  });

  container.querySelectorAll('[data-bet]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const d = JSON.parse(btn.dataset.bet);
      openBetSlip(d);
    });
  });

  // Refresh button handler
  container.querySelectorAll('[data-refresh]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const eventId = btn.dataset.refresh;
      const idx = btn.dataset.idx;
      const events = container._events || [];
      const ev = events[idx];
      if (!ev) return;

      // Clear cache and reload
      const cacheKey = `${currentBook}:${eventId}`;
      eventDetailsCache.delete(cacheKey);
      await loadEventDetail(ev, idx);
    });
  });

  // Store events for detail loading
  container._events = events;
}

/**
 * Load event detail từ API và render markets
 */
async function loadEventDetail(ev, idx) {
  const mktsContent = document.getElementById(`markets-content-${idx}`);
  if (!mktsContent) return;

  const cacheKey = `${currentBook}:${ev.eventId}`;

  // Hiển thị loading
  mktsContent.innerHTML = '<div class="loading-markets">Loading odds...</div>';

  try {
    // Check cache trước
    let eventDetail = eventDetailsCache.get(cacheKey);

    if (!eventDetail) {
      // Gọi API để load event detail
      const res = await api.eventDetail(currentBook, ev.eventId, 'football');
      eventDetail = res.event;
      eventDetailsCache.set(cacheKey, eventDetail);
    }

    // Render markets với data từ API
    mktsContent.innerHTML = renderMarkets(eventDetail, idx);

    // Re-attach bet button handlers
    mktsContent.querySelectorAll('[data-bet]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const d = JSON.parse(btn.dataset.bet);
        openBetSlip(d);
      });
    });

  } catch (err) {
    mktsContent.innerHTML = `<div class="error-markets">Failed to load odds: ${esc(err.message || 'unknown')}</div>`;
    toast('Failed to load event odds', 'error');
  }
}

function renderMarkets(ev, evIdx, isLoading = false) {
  if (isLoading) {
    return '<div class="loading-markets">Loading odds...</div>';
  }

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
  const marketType = market.marketType || '';
  const marketName = market.marketName || marketType;

  // Format 1: hasLines = false -> options array (1X2 style)
  if (market.hasLines === false && market.options && market.options.length > 0) {
    return market.options.map(opt => {
      const selData = {
        bookmakerKey: currentBook,
        eventId: ev.eventId,
        selectionId: opt.selectionId || '',
        home: ev.home || '',
        away: ev.away || '',
        league: ev.league || '',
        marketType: marketType,
        label: opt.selection || '',
        odds: opt.odds,
        line: opt.line,
        kind: opt.kind,
      };
      return `<tr>
        <td><span class="market-badge mkt-${marketType.toLowerCase()}">${esc(marketName)}</span></td>
        <td>${esc(opt.selection || '—')}</td>
        <td class="odds-cell">${fmtOdds(opt.odds)}</td>
        <td>${opt.line != null ? opt.line : '—'}</td>
        <td><button class="btn-bet" data-bet='${JSON.stringify(selData).replace(/'/g, "&#39;")}'>Bet</button></td>
      </tr>`;
    }).join('');
  }

  // Format 2: hasLines = true -> lines array with selections (OU/AH style)
  if (market.hasLines === true && market.lines && market.lines.length > 0) {
    return market.lines.map(line => {
      const selections = line.selections || [];
      return selections.map(sel => renderLineSelection(market, line, sel, ev)).join('');
    }).join('');
  }

  // Format 3: Old format with selections array (fallback)
  const selections = market.selections || [];
  if (selections.length > 0) {
    return selections.map(sel => {
      const selData = {
        bookmakerKey: currentBook,
        eventId: ev.eventId,
        selectionId: sel.selectionId || sel.id || '',
        home: ev.home || '',
        away: ev.away || '',
        league: ev.league || '',
        marketType: marketType,
        label: sel.label || sel.name || '',
        odds: sel.odds,
        line: sel.line ?? market.line,
      };
      return `<tr>
        <td><span class="market-badge mkt-${marketType.toLowerCase()}">${esc(marketName)}</span></td>
        <td>${esc(sel.label || sel.name || '—')}</td>
        <td class="odds-cell">${fmtOdds(sel.odds)}</td>
        <td>${sel.line != null ? sel.line : (market.line != null ? market.line : '—')}</td>
        <td><button class="btn-bet" data-bet='${JSON.stringify(selData).replace(/'/g, "&#39;")}'>Bet</button></td>
      </tr>`;
    }).join('');
  }

  // Empty market
  return `<tr>
    <td><span class="market-badge mkt-${marketType.toLowerCase()}">${esc(marketName)}</span></td>
    <td colspan="4" class="no-markets">No selections available</td>
  </tr>`;
}

function renderLineSelection(market, line, sel, ev) {
  const marketType = market.marketType || '';
  const marketName = market.marketName || marketType;

  const selData = {
    bookmakerKey: currentBook,
    eventId: ev.eventId,
    selectionId: sel.selectionId || '',
    home: ev.home || '',
    away: ev.away || '',
    league: ev.league || '',
    marketType: marketType,
    label: sel.selection || '',
    odds: sel.odds,
    line: sel.line ?? line.line,
    kind: sel.kind,
  };

  return `<tr>
    <td><span class="market-badge mkt-${marketType.toLowerCase()}">${esc(marketName)}</span></td>
    <td>${esc(sel.selection || '—')}</td>
    <td class="odds-cell">${fmtOdds(sel.odds)}</td>
    <td>${sel.line != null ? sel.line : (line.line != null ? line.line : '—')}</td>
    <td><button class="btn-bet" data-bet='${JSON.stringify(selData).replace(/'/g, "&#39;")}'>Bet</button></td>
  </tr>`;
}
