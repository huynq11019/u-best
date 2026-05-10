import { api } from '../api.js';
import { fmtOdds, esc } from '../utils/formatter.js';
import { toast } from './toast.js';

let currentSelection = null;

export function openBetSlip(sel) {
  currentSelection = sel;
  const panel = document.getElementById('bet-slip');
  panel.classList.add('open');
  render();
}

export function closeBetSlip() {
  currentSelection = null;
  const panel = document.getElementById('bet-slip');
  panel.classList.remove('open');
}

function render() {
  const body = document.getElementById('bet-slip-body');
  if (!currentSelection) {
    body.innerHTML = '<p class="slip-empty">No selection</p>';
    return;
  }
  const s = currentSelection;
  body.innerHTML = `
    <div class="slip-selection">
      <div class="slip-event">${esc(s.home)} vs ${esc(s.away)}</div>
      <div class="slip-league">${esc(s.league || '')}</div>
      <div class="slip-market">${esc(s.marketType)} — ${esc(s.label)}</div>
      <div class="slip-odds">Odds: <strong>${fmtOdds(s.odds)}</strong>${s.line != null ? ` | Line: ${s.line}` : ''}</div>
      <div class="slip-book">Book: <strong>${esc(s.bookmakerKey)}</strong></div>
    </div>
    <div class="slip-form">
      <label for="slip-stake">Stake</label>
      <input type="number" id="slip-stake" min="1" step="1000" value="20000" placeholder="Enter stake..." />
      <button id="slip-place-btn" class="btn-place">Place Bet</button>
    </div>
    <div id="slip-result"></div>
  `;

  document.getElementById('slip-place-btn').addEventListener('click', placeBet);
}

async function placeBet() {
  const s = currentSelection;
  const stake = parseFloat(document.getElementById('slip-stake').value);
  if (!stake || stake <= 0) {
    toast('Enter a valid stake', 'error');
    return;
  }
  const btn = document.getElementById('slip-place-btn');
  btn.disabled = true;
  btn.textContent = 'Placing...';
  const resultEl = document.getElementById('slip-result');
  resultEl.innerHTML = '';

  try {
    const res = await api.betBySelection(s.bookmakerKey, {
      eventId: s.eventId,
      selectionId: s.selectionId,
      stake,
      expectedOdds: s.odds,
    });
    resultEl.innerHTML = `
      <div class="slip-success">
        <div>Order: <strong>${esc(res.order_ref)}</strong></div>
        <div>Placed odds: ${fmtOdds(res.placed_odds)}</div>
        <div>Stake: ${res.placed_stake}</div>
        ${res.balance_after != null ? `<div>Balance: ${res.balance_after}</div>` : ''}
      </div>
    `;
    toast('Bet placed successfully!', 'success');
  } catch (err) {
    const code = err.code || '';
    let msg = err.message || 'Unknown error';
    if (code === 'ODDS_DRIFTED') msg = 'Odds changed — refresh events and try again.';
    if (code === 'CACHE_MISS') msg = 'Cache miss — please load event detail first.';
    resultEl.innerHTML = `<div class="slip-error">${esc(msg)}</div>`;
    toast(msg, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Place Bet';
  }
}

export function initBetSlip() {
  document.getElementById('bet-slip-close').addEventListener('click', closeBetSlip);
}
