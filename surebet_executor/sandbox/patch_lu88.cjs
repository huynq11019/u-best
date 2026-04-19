const fs = require('fs');

let content = fs.readFileSync('src/adapters/lu88Adapter.js', 'utf8');

const regex = /async getActiveOdds\(page, sportType = SportType\.FOOTBALL\) \{.*\}\n\n  async placeBet/s;
const replacement = `async getActiveOdds(page, sportType = SportType.FOOTBALL) {
    log.info({ sportType }, 'Lu88: getActiveOdds called');

    const checkFrameLoaded = async () => {
      try {
        const frame = page.frameLocator('#sportsFrame');
        return await frame.locator('body').count() > 0;
      } catch (e) {
        return false;
      }
    };

    const frameReady = await checkFrameLoaded();
    if (!frameReady) {
      log.warn('Lu88: sportsFrame not ready');
      return [];
    }

    try {
      const frame = page.frameLocator('#sportsFrame');
      log.info('Lu88: fetching active odds inside iframe...');

      // wait for matches to attach
      await frame.locator('.c-match').first().waitFor({ state: 'attached', timeout: 10000 }).catch(() => {});
      const matchesCount = await frame.locator('.c-match').count();
      log.info({ count: matchesCount }, 'Lu88: found match elements');

      // (Optional debug HTML dump)
      const html = await frame.locator('body').innerHTML();
      import('fs').then(fs => fs.default.writeFileSync('./error_screenshots/lu88_getActiveOdds_body.html', html.substring(0, 150000)));

      if (matchesCount === 0) {
        log.warn('Lu88: No matches found. Returning empty array.');
        return [];
      }

      const odds = await frame.locator('body').evaluate((body, parsedSportType) => {
        const document = body.ownerDocument;
        const results = [];
        
        // Grab .c-match elements (avoid finding identical structures within groups)
        const matches = document.querySelectorAll('.c-match');

        matches.forEach((m) => {
          const teamNodes = m.querySelectorAll('.c-match__team');
          let homeTeam = '', awayTeam = '';
          if (teamNodes.length >= 2) {
            homeTeam = teamNodes[0].textContent.trim();
            awayTeam = teamNodes[1].textContent.trim();
          }
          if (!homeTeam || !awayTeam) return;

          let rawEventId = \`\${homeTeam} vs \${awayTeam}\`;

          // find odds buttons
          const btns = m.querySelectorAll('[data-odds-status]');
          if (btns.length === 0) return;

          // get clean event id if possible
          const oddsSpan = btns[0].querySelector('.c-odds');
          if (oddsSpan && oddsSpan.getAttribute('data-moid')) {
            rawEventId = oddsSpan.getAttribute('data-moid').split('__')[0];
          }

          btns.forEach((btn) => {
            const valSpan = btn.querySelector('.c-odds');
            const goalSpan = btn.querySelector('.c-text-goal') || btn.querySelector('.l-text-goal');
            let priceText = '';
            
            if (valSpan) priceText = valSpan.textContent.trim();
            else priceText = btn.textContent.trim();

            const price = parseFloat(priceText);
            if (Number.isNaN(price) || price === 0) return;

            let spec = '';
            if (goalSpan) spec = goalSpan.textContent.trim();

            // determine bet type from button id suffix
            let betType = btn.id || '';
            let market = 'Unknown';
            let selection = betType;
            
            if (betType.endsWith('h')) { market = 'Handicap'; selection = 'Home'; }
            else if (betType.endsWith('a')) { market = 'Handicap'; selection = 'Away'; }
            else if (betType.endsWith('1')) { market = '1X2'; selection = 'Home'; }
            else if (betType.endsWith('2')) { market = '1X2'; selection = 'Away'; }
            else if (betType.endsWith('x')) { market = '1X2'; selection = 'Draw'; }
            else if (betType.includes('u') || spec.toLowerCase().includes('u') || priceText.toLowerCase().includes('u')) {
              // Note: O/U buttons might not end cleanly in simple suffix, but logic can be refined later if needed.
              market = 'Over/Under';
            }

            results.push({
              bookmaker: 'lu88',
              eventId: rawEventId,
              homeTeam,
              awayTeam,
              sportType: parsedSportType,
              marketId: market,
              spec,
              selection,
              price,
              extractedAt: new Date().toISOString(),
            });
          });
        });

        return results;
      }, sportType);

      log.info({ numOdds: odds.length }, 'Lu88: successfully extracted odds');
      return odds;
    } catch (error) {
      log.error({ error: error.message }, 'Lu88: frame evaluation failed');
      return [];
    }
  }

  async placeBet`;

content = content.replace(regex, replacement);
fs.writeFileSync('src/adapters/lu88Adapter.js', content, 'utf8');

