// Lu88 bookmaker adapter
// API-first flow:
// 1) POST /gw/api/v2/auth/login to get JWT token
// 2) GET /gw/api/v2/game/url with Authorization: Bearer <token>
// 3) page.goto(DepositProcessLogin URL) and follow redirects to final SportV page
import { BaseAdapter, SportType } from './baseAdapter.js';
import { childLogger } from '../config/logger.js';

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

    const { login: loginUrl, baseUrl } = this._buildApiUrls();
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 30000 });

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
   * Fetch active odds from the Lu88 SportV page.
   * Currently returns an empty array — extend with actual SportV DOM scraping.
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

          let rawEventId = `${homeTeam} vs ${awayTeam}`;

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
