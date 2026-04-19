const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('sportsFrameNormalHack.html', 'utf8');
const dom = new JSDOM(html);
const matches = dom.window.document.querySelectorAll('.c-match');
const m = matches[0];
const btn = m.querySelector('[data-odds-status]');
console.log('Button HTML:', btn.outerHTML);
