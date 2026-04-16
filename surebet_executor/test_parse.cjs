const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('error_screenshots/lu88_getActiveOdds_body.html', 'utf8');
const dom = new JSDOM(html);
const document = dom.window.document;

function parseHtml() {
  const matches = document.querySelectorAll('.YSWHH');
  console.log(`Found ${matches.length} matches`);
  
  matches.forEach(m => {
    let titleSpan = m.querySelector('.HFo7W span');
    let titleText = titleSpan ? titleSpan.textContent.trim() : 'No Title';
    console.log(`Match: ${titleText}`);
    
    let markets = m.querySelectorAll('.JL9GP');
    console.log(`  Found ${markets.length} markets`);
    markets.forEach(mk => {
      let marketName = mk.querySelector('.Tl6ta') ? mk.querySelector('.Tl6ta').textContent.trim() : '';
      console.log(`    Market: ${marketName}`);
      
      let selections = mk.querySelectorAll('.KnCPm');
      selections.forEach(sel => {
        let label = sel.querySelector('.Cgm4c') ? sel.querySelector('.Cgm4c').textContent.replace(/\s+/g, ' ').trim() : '';
        let price = sel.querySelector('.ZdNHr') ? sel.querySelector('.ZdNHr').textContent.trim() : '';
        if (price && price !== '--') {
           console.log(`      ${label} @ ${price}`);
        }
      });
    });
  });
}
parseHtml();
