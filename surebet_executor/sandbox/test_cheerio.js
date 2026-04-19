import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const html = fs.readFileSync(path.join(__dirname, 'lu88_c-match-event.html'), 'utf-8');

function _parseOddsFromHtml(html, sportType, extractOdds = true, targetEventId = null) {
  const $ = cheerio.load(html);
  const results = [];
  const matches = $('.c-match');

  matches.each((_, m) => {
    const matchEl = $(m);

    // Determine event ID
    const firstOdds = matchEl.find('.c-odds[data-moid]').first();
    let eventId = firstOdds.attr('data-moid') ? firstOdds.attr('data-moid').split('__')[0] : `lu88-${_}`;

    if (targetEventId && eventId !== targetEventId) return;

    const teamNodes = matchEl.find('.c-match__team');
    let homeTeam = '', awayTeam = '';
    if (teamNodes.length >= 2) {
      homeTeam = $(teamNodes[0]).find('.c-team-name').text().trim();
      awayTeam = $(teamNodes[1]).find('.c-team-name').text().trim();
    }

    if (!homeTeam || !awayTeam) return;

    let league = '';
    const leagueParent = matchEl.closest('.c-league').length ? matchEl.closest('.c-league') : matchEl.closest('.c-match-group');
    if (leagueParent.length) {
      league = leagueParent.find('.c-league__name, .c-text-league .c-text').first().text().trim();
    }
    if (!league) {
      league = matchEl.find('.c-text-league .c-text').first().text().trim() || matchEl.find('div[title]').first().attr('title')?.trim() || '';
    }

    const timeEl = matchEl.find('.c-match-time');
    const startTime = timeEl.text().trim();
    const scope = startTime.includes("'") || startTime.toLowerCase().includes('live') ? 'live' : 'prematch';

    if (!extractOdds) {
      results.push({
        eventId, sport: sportType, home: homeTeam, away: awayTeam, league, startTime, markets: [], scope
      });
      return;
    }

    const cols = matchEl.find('.c-bettype-col');
    const markets = {};

    cols.each((_, col) => {
      const colEl = $(col);
      const bt = colEl.attr('data-bt');
      if (!bt) return;

      let marketType = 'Unknown';
      let marketScope = 'FT'; // FT or HT

      if (['1', '7'].includes(bt)) marketType = 'AH';
      else if (['3', '8'].includes(bt)) marketType = 'OU';
      else if (['5', '15'].includes(bt)) marketType = '1X2';
      else return; // Ignore unknown columns for now

      if (['7', '8', '15'].includes(bt)) marketScope = 'HT';
      
      const finalMarketType = marketScope === 'HT' ? marketType + '_HT' : marketType;

      const buttons = colEl.find('.c-odds-button');
      if (!buttons.length) return;

      buttons.each((idx, btn) => {
        const btnEl = $(btn);
        const oddsSpan = btnEl.find('.c-odds');
        if (!oddsSpan.length) return;

        const price = parseFloat(oddsSpan.text().trim());
        if (Number.isNaN(price)) return;

        const goalSpan = btnEl.find('.c-text-goal');
        const goalText = (goalSpan.text().trim() || '').replace(/\s+/g, ' ');
        const line = parseFloat(goalText) || null;

        let selectionLabel = 'Unknown';

        // Infer selection label based on position + market
        if (marketType === 'AH') {
            selectionLabel = idx === 0 ? 'Home' : 'Away';
        } else if (marketType === 'OU') {
            selectionLabel = idx === 0 ? 'Over' : 'Under';
        } else if (marketType === '1X2') {
            if (idx === 0) selectionLabel = 'Home';
            else if (idx === 1) selectionLabel = 'Away';
            else if (idx === 2) selectionLabel = 'Draw';
        }

        // Each column represents a group of odds. But sometimes LU88 has multiple columns for the same market (e.g. multiple lines for AH FT).
        // Since odds in HTML are listed vertically, a col contains the different teams.
        // Wait, a single cell in the HTML has Home/Away stacked! Yes.
        // So they belong to the same "market group", differentiated by `line`.
        // Let's create a key for the specific market instance (e.g., AH_1.5)
        // Or we can just push all selections and group them later, but the schema wants selections grouped by marketType.
        // Actually, if there are multiple AH lines, they are in different rows within the same match.
        // Let's just group them into the same `marketType`.
        if (!markets[finalMarketType]) {
          markets[finalMarketType] = { marketType: finalMarketType, selections: [] };
        }
        markets[finalMarketType].selections.push({ label: selectionLabel, odds: price, line });
      });
    });

    if (targetEventId) {
      const flatOdds = [];
      Object.values(markets).forEach((market) => {
        if (market.selections.length > 0) {
           flatOdds.push({
             eventId, sport: sportType, home: homeTeam, away: awayTeam, league,
             marketType: market.marketType, startTime, selections: market.selections, scope
           });
        }
      });
      results.push({
         eventId, sport: sportType, league, home: homeTeam, away: awayTeam, startTime, markets: flatOdds, scope
      });
    } else {
      Object.values(markets).forEach((market) => {
        if (market.selections.length > 0) {
          results.push({
            eventId, sport: sportType, home: homeTeam, away: awayTeam, league,
            marketType: market.marketType, startTime, selections: market.selections, scope
          });
        }
      });
    }
  });

  return targetEventId ? (results[0] || null) : results;
}

console.log(JSON.stringify(_parseOddsFromHtml(html, 'football', true, null), null, 2));
