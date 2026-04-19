import * as cheerio from 'cheerio';
const html = `<div class="c-bettype-col c-has-goal" data-bt="3">
                    <div class="c-odds-button" id="987563470h" data-quickbet-open="false" data-odds-status=""
                        data-grey-out="false" data-selected="false"><span class="c-text-goal">3.5</span><span
                            class="c-odds" data-moid="123971857__987563470" style="cursor: pointer;">0.82</span></div>
                    <div class="c-odds-button" id="987563470a" data-quickbet-open="false" data-odds-status=""
                        data-grey-out="false" data-selected="false"><span class="c-text">u</span><span
                            class="c-odds c-odds--minus" data-moid="123971857__987563470"
                            style="cursor: pointer;">-0.92</span></div>
                </div>`;
const $ = cheerio.load(html);
const colEl = $('.c-bettype-col');
const buttons = colEl.find('.c-odds-button');
let sharedLine = null;
buttons.each((idx, btn) => {
    const btnEl = $(btn);
    const oddsSpan = btnEl.find('.c-odds');
    const goalSpan = btnEl.find('.c-text-goal');
    let goalText = '';
    if (goalSpan.length) {
        goalText = (goalSpan.text().trim() || '').replace(/\s+/g, ' ');
    } else {
        const fullText = (btnEl.text() || "").trim();
        const priceText = oddsSpan.text().trim();
        goalText = fullText.replace(priceText, '').replace(/\s+/g, ' ').trim();
    }
    
    let line = null;
    if (goalText) {
        const parsedLine = parseFloat(goalText);
        if (!isNaN(parsedLine)) {
            line = parsedLine;
            sharedLine = line; 
        } else {
            line = sharedLine;
        }
    } else {
        line = sharedLine;
    }
    console.log({ idx, goalText, line, sharedLine });
});
