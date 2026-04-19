const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('sportsFrameNormalHack.html', 'utf8');
const dom = new JSDOM(html);
const document = dom.window.document;
const match = document.querySelector('.c-match');
console.log(match.innerHTML.substring(0, 1000));
