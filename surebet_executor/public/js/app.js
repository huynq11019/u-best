import { api } from './api.js';
import { initEventsPanel, setBookmaker, startAutoRefresh } from './components/eventsPanel.js';
import { initSurebetPanel, startSurebetAutoRefresh } from './components/surebetPanel.js';
import { initBetSlip } from './components/betSlip.js';
import { toast } from './components/toast.js';

const tabs = ['events', 'surebets'];
let activeTab = 'events';
let bookmakers = [];
let activeBook = '';

async function init() {
  initBetSlip();
  initEventsPanel();
  initSurebetPanel();
  setupTabs();
  await loadBookmakers();
  setupBookmakerSelector();
  startAutoRefresh(10000);
  startSurebetAutoRefresh(15000);
}

function setupTabs() {
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(tab) {
  activeTab = tab;
  tabs.forEach(t => {
    const panel = document.getElementById(`panel-${t}`);
    const btn = document.querySelector(`[data-tab="${t}"]`);
    if (t === tab) {
      panel.classList.add('active');
      btn.classList.add('active');
    } else {
      panel.classList.remove('active');
      btn.classList.remove('active');
    }
  });
}

async function loadBookmakers() {
  try {
    const res = await api.bookmakers();
    bookmakers = res.bookmakers || [];
  } catch {
    bookmakers = ['lu88', 'x1', 'saba'];
  }
  if (bookmakers.length > 0) {
    activeBook = bookmakers[0];
  }
}

function setupBookmakerSelector() {
  const container = document.getElementById('book-selector');
  container.innerHTML = bookmakers.map(b =>
    `<button class="book-btn ${b === activeBook ? 'active' : ''}" data-book="${b}">${b.toUpperCase()}</button>`
  ).join('');

  container.querySelectorAll('[data-book]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeBook = btn.dataset.book;
      container.querySelectorAll('.book-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setBookmaker(activeBook);
    });
  });

  if (activeBook) {
    setBookmaker(activeBook);
  }
}

document.addEventListener('DOMContentLoaded', init);
