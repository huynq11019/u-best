const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('sportsFrameNormalHack.html', 'utf8');
const { window } = new JSDOM(html);
const document = window.document;

function parseOdds() {
  const matches = document.querySelectorAll('.c-match, .c-match-group');
  const results = [];
  matches.forEach(m => {
    let homeTeam = '', awayTeam = '', eventId = '';
    const teamNodes = m.querySelectorAll('.c-match__team');
    if (teamNodes.length >= 2) {
      homeTeam = teamNodes[0].textContent.trim();
      awayTeam = teamNodes[1].textContent.trim();
    }
    if (!homeTeam || !awayTeam) return;

    // Is there a header?
    const header = m.closest('.c-match-group, .c-match')?.querySelector('.c-match-header') || m.querySelector('.c-match-header');
    let title = '';
    if (header) title = header.textContent.trim();

    const btns = m.querySelectorAll('[data-odds-status]');
    let rawEventId = '';
    
    btns.forEach(btn => {
      const oddsSpan = btn.querySelector('.c-odds');
      if (oddsSpan && oddsSpan.getAttribute('data-moid')) {
        rawEventId = oddsSpan.getAttribute('data-moid').split('__')[0];
      }
    });

    results.push({
      title,
      eventId: rawEventId || `${homeTeam} vs ${awayTeam}`,
      homeTeam,
      awayTeam,
      oddsCount: btns.length
    });
  });
  return results;
}

console.log(parseOdds().slice(0, 3));
