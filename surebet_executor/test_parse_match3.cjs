const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('sportsFrameNormalHack.html', 'utf8');
const dom = new JSDOM(html);
const document = dom.window.document;
const matches = document.querySelectorAll('.c-match');
const m = matches[0];

console.log("== Teams ==");
m.querySelectorAll('.c-match__team').forEach(t => console.log('Team:', t.textContent.trim()));

console.log("\n== Odds Buttons ==");
const btns = m.querySelectorAll('[data-odds-status]');
btns.forEach(b => console.log('Button class:', b.className, '| Value:', b.textContent.trim(), '| Status:', b.getAttribute('data-odds-status')));
