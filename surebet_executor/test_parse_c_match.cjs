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
      eventId = `${homeTeam} vs ${awayTeam}`;
    }
    if (!homeTeam || !awayTeam) return;

    // extract odds buttons
    const btns = m.querySelectorAll('[data-odds-status]');
    btns.forEach(btn => {
      // e.g. class="c-odds-button" id="971465173h" data-quickbet-open="false" 
      // <span class="c-text-goal">0.5/1</span><span class="c-odds c-odds--minus" data-moid="124088005__971465173">-0.95</span>
      const oddsSpan = btn.querySelector('.c-odds');
      const goalSpan = btn.querySelector('.c-text-goal') || btn.querySelector('.l-text-goal');
      const valSpan = btn.querySelector('.c-odds-button__val');
      
      let price = '';
      if (oddsSpan) price = oddsSpan.textContent.trim();
      else if (valSpan) price = valSpan.textContent.trim();
      else price = btn.textContent.trim();

      let spec = '';
      if (goalSpan) spec = goalSpan.textContent.trim();

      results.push({
        eventId,
        homeTeam,
        awayTeam,
        price,
        spec,
        betType: btn.id // just to inspect
      });
    });
  });
  return results;
}

console.log(parseOdds().slice(0, 10));
