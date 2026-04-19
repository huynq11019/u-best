import * as cheerio from 'cheerio';
const html = `<div class="c-odds-button" id="987563470a" data-quickbet-open="false" data-odds-status=""
                        data-grey-out="false" data-selected="false"><span class="c-text">u</span><span
                            class="c-odds c-odds--minus" data-moid="123971857__987563470"
                            style="cursor: pointer;">-0.92</span></div>`;
const $ = cheerio.load(html);
const btnEl = $('.c-odds-button');
const oddsSpan = btnEl.find('.c-odds');
const fullText = (btnEl.text() || "").trim();
const priceText = oddsSpan.text().trim();
const goalText = fullText.replace(priceText, '').replace(/\s+/g, ' ').trim();
console.log({ fullText, priceText, goalText });
