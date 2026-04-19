// Lu88 bookmaker adapter
// API-first flow:
// 1) POST /gw/api/v2/auth/login to get JWT token
// 2) GET /gw/api/v2/game/url with Authorization: Bearer <token>
// 3) page.goto(DepositProcessLogin URL) and follow redirects to final SportV page
import { BaseAdapter, SportType } from './baseAdapter.js';
import { childLogger } from '../config/logger.js';
import * as cheerio from 'cheerio';

const log = childLogger({ component: 'lu88Adapter' });

const BASE_URL = 'https://lu88.moe';

const SPORTV_GAME_URL_PARAMS = {
  partner_provider: 'sportv',
  partner_game_type: 'sport',
  home: 'https://lu88.moe?ref_domain=false',
  device: 'pc',
};

export default class Lu88Adapter extends BaseAdapter {
  constructor(bookmakerKey, bookkieConfig) {
    super(bookmakerKey, bookkieConfig);
    this._authToken = null;
    this._sportvGameUrl = null;
  }

  /**
   * Internal helper to parse HTML from the Lu88 frame using cheerio.
   * Eliminates the need for evaluating scraping logic in the browser context.
   */
  _parseOddsFromHtml(html, sportType, extractOdds = true, targetEventId = null) {
    const $ = cheerio.load(html);
    const results = [];
    const matches = $('.c-match');

    matches.each((_, m) => {
      const matchEl = $(m);

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
        let marketScope = 'FT';

        if (['1', '7'].includes(bt)) marketType = 'AH';
        else if (['3', '8'].includes(bt)) marketType = 'OU';
        else if (['5', '15'].includes(bt)) marketType = '1X2';
        else return;

        if (['7', '8', '15'].includes(bt)) marketScope = 'HT';
        const finalMarketType = marketScope === 'HT' ? marketType + '_HT' : marketType;

        const buttons = colEl.find('.c-odds-button');
        if (!buttons.length) return;

        let sharedLine = null; // Sometimes LU88 sets line on Home/Over, but not Away/Under

        buttons.each((idx, btn) => {
          const btnEl = $(btn);
          const oddsSpan = btnEl.find('.c-odds');
          if (!oddsSpan.length) return;

          const price = parseFloat(oddsSpan.text().trim());
          if (Number.isNaN(price)) return;

          const goalSpan = btnEl.find('.c-text-goal');
          let goalText = '';
          if (goalSpan.length) {
              goalText = (goalSpan.text().trim() || '').replace(/\s+/g, ' ');
          } else {
              // Try to fallback if odds are sometimes weirdly formatted
              const fullText = (btnEl.text() || "").trim();
              const priceText = oddsSpan.text().trim();
              goalText = fullText.replace(priceText, '').replace(/\s+/g, ' ').trim();
          }

          let line = null;
          if (goalText) {
             let parsedLine = NaN;
             if (goalText.includes('/')) {
                 const parts = goalText.split('/');
                 if (parts.length === 2 && !isNaN(parseFloat(parts[0])) && !isNaN(parseFloat(parts[1]))) {
                     parsedLine = (parseFloat(parts[0]) + parseFloat(parts[1])) / 2;
                 }
             } else {
                 parsedLine = parseFloat(goalText);
             }

             if (!isNaN(parsedLine)) {
                 line = parsedLine;
                 sharedLine = line; // Share between pairs
             } else {
                 line = sharedLine;
             }
          } else {
             line = sharedLine;
          }

          let selectionLabel = 'Unknown';
          if (marketType === 'AH') {
              selectionLabel = idx === 0 ? 'Home' : 'Away';
          } else if (marketType === 'OU') {
              selectionLabel = idx === 0 ? 'Over' : 'Under';
          } else if (marketType === '1X2') {
              if (idx === 0) selectionLabel = 'Home';
              else if (idx === 1) selectionLabel = 'Away';
              else if (idx === 2) selectionLabel = 'Draw';
          }

          if (!markets[finalMarketType]) {
            markets[finalMarketType] = { marketType: finalMarketType, selections: [] };
          }
           markets[finalMarketType].selections.push({ label: selectionLabel, odds: price, line, lineRaw: line !== null ? goalText : null });
        });

        Object.values(markets).forEach((market) => {
          if (market.selections.length > 0) {
            results.push({
              eventId, sport: sportType, home: homeTeam, away: awayTeam, league,
              marketType: market.marketType, startTime, selections: market.selections, scope
            });
          }
        });
      }); // close cols.each
    }); // close matches.each

    return targetEventId ? (results[0] || null) : results;
  }

  _buildApiUrls() {
    const baseUrl = (this.config.baseUrl || BASE_URL).replace(/\/$/, '');
    return {
      login: `${baseUrl}/gw/api/v2/auth/login`,
      gameUrl: `${baseUrl}/gw/api/v2/game/url`,
      userInfo: `${baseUrl}/gw/api/v2/user/info`,
      baseUrl,
    };
  }

  /**
   * Log in to Lu88 via API and cache Bearer token.
   * @param {import('playwright').Page} page
   */
  async login(page) {
    log.info('Lu88: logging in via API');

    const initialUrls = this._buildApiUrls();
    await page.goto(initialUrls.baseUrl, { waitUntil: 'commit', timeout: 30000 });

    // The page might have been redirected (e.g. lu88.moe -> lu88.uno)
    const currentUrl = new URL(page.url());
    if (currentUrl.origin !== initialUrls.baseUrl) {
      log.info(`Lu88: base URL redirected from ${initialUrls.baseUrl} to ${currentUrl.origin}`);
      this.config.baseUrl = currentUrl.origin;
    }

    const { login: loginUrl } = this._buildApiUrls();

    if (await this._checkIsLoggedIn(page)) {
      log.info('Lu88: existing API token is still valid');
      this._isLoggedIn = true;
      return;
    }

    if (!this.config.username || !this.config.password) {
      throw new Error('Lu88: missing credentials (LU88_USERNAME/LU88_PASSWORD)');
    }

    let result;
    try {
      result = await page.evaluate(async ({ url, username, password }) => {
        const resp = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: {
            Accept: 'application/json, text/plain, */*',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ username, password }),
        });

        return {
          status: resp.status,
          body: await resp.text(),
        };
      }, {
        url: loginUrl,
        username: this.config.username,
        password: this.config.password,
      });
    } catch (err) {
      log.error({ err: err.message }, 'Lu88: login API request failed');
      await this._saveErrorScreenshot(page, 'login_api_request_failed');
      throw new Error(`Lu88: login API request failed - ${err.message}`);
    }

    let payload = null;
    try {
      payload = result.body ? JSON.parse(result.body) : null;
    } catch (_) {
      payload = null;
    }

    if (result.status < 200 || result.status >= 300) {
      const serverMessage = payload?.message || payload?.status || result.body || 'unknown error';
      log.error({ status: result.status, serverMessage }, 'Lu88: login API returned non-2xx');
      await this._saveErrorScreenshot(page, 'login_api_non_2xx');
      throw new Error(`Lu88: login API failed (${result.status}) - ${serverMessage}`);
    }

    if (!payload || payload.status !== 'OK' || !payload.data?.token) {
      log.error({ payload }, 'Lu88: login API invalid response');
      await this._saveErrorScreenshot(page, 'login_api_invalid_response');
      throw new Error('Lu88: login API response missing token');
    }

    this._authToken = payload.data.token;
    this._isLoggedIn = true;
    log.info('Lu88: API login successful, token acquired');
  }

  /**
   * Call game/url with Bearer token and navigate to returned DepositProcessLogin URL.
   * @param {import('playwright').Page} page
   */
  async warmUp(page) {
    log.info('Lu88: warming up via API — fetching SportV game URL');

    if (!this._authToken) {
      throw new Error('Lu88: missing auth token, login() must run before warmUp()');
    }

    const { gameUrl } = this._buildApiUrls();
    const qs = new URLSearchParams(SPORTV_GAME_URL_PARAMS).toString();
    const apiUrl = `${gameUrl}?${qs}`;

    let result;
    try {
      result = await page.evaluate(async ({ url, token }) => {
        const resp = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          headers: {
            Accept: 'application/json, text/plain, */*',
            Authorization: `Bearer ${token}`,
          },
        });

        return {
          status: resp.status,
          body: await resp.text(),
        };
      }, {
        url: apiUrl,
        token: this._authToken,
      });
    } catch (err) {
      log.warn({ err: err.message }, 'Lu88: game URL API request failed');
      result = { status: 0, body: '' };
    }

    log.info({ status: result.status }, 'Lu88: game URL API response');

    let sportvUrl = null;
    if (result.status === 200) {
      try {
        const parsed = JSON.parse(result.body);
        if (parsed.status === 'OK' && typeof parsed.data === 'string' && parsed.data.length > 0) {
          sportvUrl = parsed.data.replace('act=Virtualsports', 'act=sports');
          this._sportvGameUrl = sportvUrl;
          log.info({ sportvUrl }, 'Lu88: received DepositProcessLogin URL');
        } else {
          log.warn({ parsed }, 'Lu88: unexpected game URL API response format');
        }
      } catch (err) {
        log.warn({ err: err.message, body: result.body }, 'Lu88: failed to parse game URL API response');
      }
    } else {
      log.warn({ result }, 'Lu88: game URL API returned non-200');
    }

    const targetUrl = sportvUrl || this._sportvGameUrl;
    if (!targetUrl) {
      log.warn('Lu88: could not obtain SportV URL — warm-up incomplete');
      return;
    }

    if (!sportvUrl) {
      log.info({ targetUrl }, 'Lu88: using cached SportV URL');
    }

    log.info('Lu88: navigating to DepositProcessLogin URL');
    await page.goto(targetUrl, { waitUntil: 'commit', timeout: 90000 });
    await page.waitForTimeout(5000);
    log.info({ finalUrl: page.url() }, 'Lu88: warm-up complete after redirect chain');
  }

  /**
   * Fetch active odds from the Lu88 SportV page, including all market types (1X2, AH, OU).
   * Returns odds in standard format with marketType and selections array.
   *
   * @param {import('playwright').Page} page
   * @param {string} [sportType=SportType.FOOTBALL]
   * @returns {Promise<import('./baseAdapter.js').ActiveOdd[]>}
   */
  async getActiveOdds(page, sportType = SportType.FOOTBALL) {
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
      await frame.locator('.c-match').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(5000);
      const matchesCount = await frame.locator('.c-match').count();
      log.info({ count: matchesCount }, 'Lu88: found match elements');

      // (Optional debug HTML dump)
      const html = await frame.locator('body').innerHTML();
      import('fs').then(fs => fs.default.writeFileSync('./error_screenshots/lu88_getActiveOdds_body.html', html.substring(0, 150000)));

      if (matchesCount === 0) {
        log.warn('Lu88: No matches found. Returning empty array.');
        return [];
      }

      const odds = this._parseOddsFromHtml(html, sportType, true);

      log.info({ numOdds: odds.length }, 'Lu88: successfully extracted odds');
      return odds;
    } catch (error) {
      log.error({ error: error.message }, 'Lu88: frame evaluation failed');
      return [];
    }
  }

  /**
   * Fetch only event metadata (no odds) from Lu88
   */
  async getEvents(page, sportType = SportType.FOOTBALL) {
    log.info({ sportType }, 'Lu88: getEvents called');

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
      log.warn('Lu88: sportsFrame not ready for events');
      return [];
    }

    try {
      const frame = page.frameLocator('#sportsFrame');
      await frame.locator('.c-match').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
      const matchesCount = await frame.locator('.c-match').count();
      if (matchesCount === 0) return [];

      const html = await frame.locator('body').innerHTML();
      const events = this._parseOddsFromHtml(html, sportType, false);

      log.info({ count: events.length }, 'Lu88: successfully extracted events');
      return events;
    } catch (error) {
      log.error({ error: error.message }, 'Lu88: getEvents failed');
      return [];
    }
  }

  /**
   * Fetch full odds details for only the specified event 
   */
  async getEventOdds(page, eventId, sportType = SportType.FOOTBALL) {
    log.info({ sportType, eventId }, 'Lu88: getEventOdds called');

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
      return null;
    }

    try {
      const frame = page.frameLocator('#sportsFrame');
      await frame.locator('.c-match').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
      
      const html = await frame.locator('body').innerHTML();
      const eventDetails = this._parseOddsFromHtml(html, sportType, true, eventId);

      return eventDetails;
    } catch (error) {
      log.error({ error: error.message }, 'Lu88: getEventOdds failed');
      return null;
    }
  }

  async placeBet(page, leg) {
    throw new Error('Lu88Adapter.placeBet() not yet implemented');
  }

  async hedgeLeg(page, leg) {
    throw new Error('Lu88Adapter.hedgeLeg() not yet implemented');
  }

  async voidLeg(page, orderRef) {
    throw new Error('Lu88Adapter.voidLeg() not yet implemented');
  }

  async _checkIsLoggedIn(page) {
    if (!this._authToken) {
      return false;
    }

    const { userInfo } = this._buildApiUrls();
    try {
      const result = await page.evaluate(async ({ url, token }) => {
        const resp = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          headers: {
            Accept: 'application/json, text/plain, */*',
            Authorization: `Bearer ${token}`,
          },
        });

        return {
          status: resp.status,
          body: await resp.text(),
        };
      }, {
        url: userInfo,
        token: this._authToken,
      });

      if (result.status < 200 || result.status >= 300) {
        return false;
      }

      const payload = result.body ? JSON.parse(result.body) : null;
      return Boolean(payload && payload.status === 'OK' && payload.data && typeof payload.data === 'object');
    } catch (err) {
      log.debug({ err: err.message }, 'Lu88: user info check failed');
      return false;
    }
  }

  async _saveErrorScreenshot(page, label) {
    try {
      await page.screenshot({
        path: `./error_screenshots/lu88_${label}_${Date.now()}.png`,
        fullPage: false,
      });
    } catch (_) {}
  }
}
