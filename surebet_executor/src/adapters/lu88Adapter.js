// Lu88 bookmaker adapter
// API-first flow:
// 1) POST /gw/api/v2/auth/login to get JWT token
// 2) GET /gw/api/v2/game/url with Authorization: Bearer <token>
// 3) page.goto(DepositProcessLogin URL) and follow redirects to final SportV page
import { BaseAdapter, SportType } from './baseAdapter.js';
import { childLogger } from '../config/logger.js';
import * as cheerio from 'cheerio';
import crypto from 'crypto';

const log = childLogger({ component: 'lu88Adapter' });

/**
 * Map marketType → marketName hiển thị theo UI (tiếng Việt).
 */
const MARKET_TYPE_TO_NAME = {
  '1X2': 'Chung cuộc',
  '1X2_HT': 'Chung cuộc hiệp 1',
  'AH': 'Chấp Châu Á',
  'AH_HT': 'Chấp Châu Á hiệp 1',
  'OU': 'Tài xỉu',
  'OU_HT': 'Tài xỉu hiệp 1',
};

export default class Lu88Adapter extends BaseAdapter {
  constructor(bookmakerKey, bookkieConfig) {
    super(bookmakerKey, bookkieConfig);
    this._authToken = null;
    this._sportvGameUrl = null;
    // Flat map: selectionId → LU88 metadata, populated by getEventOdds
    this._lu88SelectionCache = new Map();
    // Session context captured during warmUp via request interception
    this._sportvBearerToken = null;
    this._sportvSessionUrl = null;
    this._sportvCustId = null;
    this._sportvUid = null;
    this._sportvUsername = null;
    this._sportvLicUserName = null;
  }

  /**
   * Chuyển đổi flat odds sang grouped markets format (giống x1Adapter).
   * @param {Array} oddsList - Kết quả từ _parseOddsFromHtml
   * @returns {Array} - Grouped markets với marketType, marketName, hasLines, options/lines
   */
  _groupMarketsForEvent(oddsList) {
    if (!Array.isArray(oddsList) || oddsList.length === 0) return [];

    // Group theo marketType
    const marketGroups = {};
    
    for (const odd of oddsList) {
      const key = odd.marketType;
      if (!marketGroups[key]) {
        marketGroups[key] = {
          marketType: key,
          marketName: MARKET_TYPE_TO_NAME[key] || key,
          selections: [],
        };
      }
      // Thêm tất cả selections từ odds entry này
      if (odd.selections && Array.isArray(odd.selections)) {
        marketGroups[key].selections.push(...odd.selections);
      }
    }

    // Chuyển đổi sang format chuẩn
    return Object.values(marketGroups).map((group) => {
      const hasLines = group.selections.some((s) => s.line !== null && s.line !== undefined);

      if (!hasLines) {
        // 1X2: options array
        return {
          marketType: group.marketType,
          marketName: group.marketName,
          hasLines: false,
          options: group.selections.map((s) => ({
            selectionId: s.oddsId && s.betteam ? `lu88_${s.oddsId}_${s.betteam}` : undefined,
            selection: s.label,
            odds: s.odds,
            line: s.line,
          })),
        };
      }

      // OU/AH: group theo line
      const lineMap = new Map();
      for (const sel of group.selections) {
        const lineKey = Math.abs(sel.line ?? 0);
        if (!lineMap.has(lineKey)) lineMap.set(lineKey, []);
        lineMap.get(lineKey).push(sel);
      }

      const lines = [];
      for (const [, pairSelections] of lineMap) {
        if (pairSelections.length < 2) continue;
        // sorted: Home/Over (idx 0) trước Away/Under (idx 1) theo label
        const sorted = pairSelections.sort((a, b) => a.label.localeCompare(b.label));
        const sA = sorted[0];
        const sB = sorted[1];
        // Tách thành 2 selection đơn lẻ trong cùng line
        const selectionA = {
          selectionId: sA?.oddsId && sA?.betteam ? `lu88_${sA.oddsId}_${sA.betteam}` : undefined,
          selection: sA?.label ?? '',
          odds: sA?.odds ?? 0,
          line: sA?.line ?? null,
        };
        const selectionB = {
          selectionId: sB?.oddsId && sB?.betteam ? `lu88_${sB.oddsId}_${sB.betteam}` : undefined,
          selection: sB?.label ?? '',
          odds: sB?.odds ?? 0,
          line: sB?.line ?? null,
        };
        lines.push({ line: sA?.line ?? null, selections: [selectionA, selectionB] });
      }

      return {
        marketType: group.marketType,
        marketName: group.marketName,
        hasLines: true,
        lines: lines.sort((a, b) => a.line - b.line),
      };
    });
  }

  /**
   * Internal helper to parse HTML from the Lu88 frame using cheerio.
   * Eliminates the need for evaluating scraping logic in the browser context.
   */
  _parseOddsFromHtml(html, sportType, extractOdds = true, targetEventId = null) {
    const $ = cheerio.load(html);
    const results = [];
    const matches = $('.c-match');
    log.info({ matchCount: matches.length, targetEventId }, 'Lu88: parsing matches from HTML');

    matches.each((_, m) => {
      const matchEl = $(m);

      let eventId = (matchEl.attr('data-matchid') || `lu88-${_}`).toString().trim();

      if (targetEventId) {
        const targetId = targetEventId.toString().trim();
        log.info({ eventId, targetId, match: eventId === targetId }, 'EventId matching check');
        if (eventId !== targetId) return;
      }

      const teamNodes = matchEl.find('.c-match__team');
      let homeTeam = '', awayTeam = '';
      if (teamNodes.length >= 2) {
        homeTeam = $(teamNodes[0]).find('.c-team-name').text().trim();
        awayTeam = $(teamNodes[1]).find('.c-team-name').text().trim();
      }

      // Parse live scores from scoreboard
      let homeScore = null, awayScore = null;
      const scoreRows = matchEl.find('.c-scoreboard__row');
      scoreRows.each((_, row) => {
        const rowEl = $(row);
        const teamName = rowEl.find('.c-team-name');
        const scoreEl = rowEl.find('.c-text-total');
        if (!teamName.length || !scoreEl.length) return;
        const score = parseInt(scoreEl.text().trim(), 10);
        if (!isNaN(score)) {
          if (teamName.attr('data-team') === 'H') homeScore = score;
          else if (teamName.attr('data-team') === 'A') awayScore = score;
        }
      });

      if (!homeTeam || !awayTeam) return;

      let league = '';
      let leagueId = '';
      const leagueParent = matchEl.closest('.c-league').length ? matchEl.closest('.c-league') : matchEl.closest('.c-match-group');
      if (leagueParent.length) {
        league = leagueParent.find('.c-league__name, .c-text-league .c-text').first().text().trim();
        leagueId = leagueParent.attr('data-leagueid') || '';
      }
      if (!league) {
        league = matchEl.find('.c-text-league .c-text').first().text().trim() || matchEl.find('div[title]').first().attr('title')?.trim() || '';
      }

      const timeEl = matchEl.find('.c-match-time');
      const startTime = timeEl.text().trim();
      const scope = startTime.includes("'") || startTime.toLowerCase().includes('live') ? 'live' : 'prematch';

      if (!extractOdds) {
        results.push({
          eventId, leagueId, sport: sportType, home: homeTeam, away: awayTeam, league, startTime, markets: [], scope
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
        let sharedOddsId = null;

        buttons.each((idx, btn) => {
          const btnEl = $(btn);
          const oddsSpan = btnEl.find('.c-odds');
          if (!oddsSpan.length) return;

          // Parse oddsId and betteam from button id (e.g. "987563457h" → oddsId="987563457", betteam="h")
          const btnId = btnEl.attr('id') || '';
          const btnIdMatch = btnId.match(/^(\d+)([a-z0-9]+)$/i);
          let oddsId = '';
          let betteam = '';
          if (btnIdMatch) {
            oddsId = btnIdMatch[1];
            betteam = btnIdMatch[2].toLowerCase();
            sharedOddsId = oddsId;
          } else if (sharedOddsId) {
            oddsId = sharedOddsId;
          }

          // Normalize betteam for OU: button suffix may be 'h'/'a' but semantic meaning is 'o'/'u'
          if (marketType === 'OU') {
            betteam = idx === 0 ? 'o' : 'u';
          }

          const rawOddsText = oddsSpan.clone().children().remove().end().text().trim();
          const price = parseFloat(rawOddsText);
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
           // Extract sinfo from button data attributes if available
          let sinfo = '';
          try {
            sinfo = btnEl.attr('data-sinfo') || btnEl.data('sinfo') || '';
            if (!sinfo) {
              // Try to find sinfo in nested elements
              const sinfoEl = btnEl.find('[data-sinfo], .sinfo');
              if (sinfoEl.length) {
                sinfo = sinfoEl.attr('data-sinfo') || sinfoEl.text().trim();
              }
            }
            if (sinfo) {
              log.info({ oddsId, sinfo }, 'Lu88: extracted sinfo from odds button');
              // Store sinfo with oddsId for later use
              if (!this._lu88SelectionCache) this._lu88SelectionCache = new Map();
              const cacheKey = `${oddsId}_${betteam}`;
              this._lu88SelectionCache.set(cacheKey, { sinfo, timestamp: Date.now() });
            }
          } catch (e) {
            log.debug({ error: e.message }, 'Lu88: failed to extract sinfo from button');
          }

          markets[finalMarketType].selections.push({
             label: selectionLabel,
             odds: price,
             line,
             lineRaw: line !== null ? goalText : null,
             oddsId,
             betteam,
             bettype: Number(bt),
             sinfo,
           });
        });
      }); // close cols.each

      // Push sau khi tất cả cols đã được xử lý (tránh duplicate)
      Object.values(markets).forEach((market) => {
        if (market.selections.length > 0) {
          results.push({
            eventId, leagueId, sport: sportType, home: homeTeam, away: awayTeam, league,
            marketType: market.marketType, startTime, selections: market.selections, scope,
            homeScore, awayScore,
          });
        }
      });
    }); // close matches.each

    return results;
  }

  _buildSportvGameUrlParams() {
    const baseUrl = this.config.baseUrl.replace(/\/$/, '');
    return {
      partner_provider: 'sportv',
      partner_game_type: 'sport',
      home: `${baseUrl}?ref_domain=false`,
      device: 'pc',
    };
  }

  _buildApiUrls() {
    const baseUrl = this.config.baseUrl.replace(/\/$/, '');
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
    const qs = new URLSearchParams(this._buildSportvGameUrlParams()).toString();
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
      log.error({ err: err.message }, 'Lu88: game URL API request failed');
      result = { status: 0, body: '' };
    }

    log.info({ status: result.status, bodyPreview: result.body?.slice?.(0, 200) }, 'Lu88: game URL API response');

    let sportvUrl = null;
    if (result.status === 200) {
      try {
        const parsed = JSON.parse(result.body);
        if (parsed.status === 'OK' && typeof parsed.data === 'string' && parsed.data.length > 0) {
          sportvUrl = parsed.data.replace('act=Virtualsports', 'act=sports');
          this._sportvGameUrl = sportvUrl;
          log.info({ sportvUrl }, 'Lu88: received DepositProcessLogin URL');
        } else {
          log.error({ parsed }, 'Lu88: unexpected game URL API response format');
          throw new Error(`game/url API returned unexpected format: ${JSON.stringify(parsed)}`);
        }
      } catch (err) {
        log.error({ err: err.message, body: result.body?.slice?.(0, 500) }, 'Lu88: failed to parse game URL API response');
        throw new Error(`Failed to parse game/url response: ${err.message}`);
      }
    } else {
      log.error({ status: result.status, body: result.body?.slice?.(0, 500) }, 'Lu88: game URL API returned non-200');
      throw new Error(`game/url API failed with status ${result.status}`);
    }

    const targetUrl = sportvUrl || this._sportvGameUrl;
    if (!targetUrl) {
      log.error('Lu88: could not obtain SportV URL — warm-up incomplete. Make sure game/url API succeeds.');
      throw new Error('Lu88 warmUp failed: could not obtain SportV URL. game/url API may have failed.');
    }

    if (!sportvUrl) {
      log.info({ targetUrl }, 'Lu88: using cached SportV URL');
    }

    log.info({ targetUrl }, 'Lu88: navigating to DepositProcessLogin URL');

    // Intercept requests from the SportV iframe to capture session credentials
    const capturedCtx = {
      bearer: null, custId: null, uid: null, username: null, licUserName: null, sessionUrl: null,
    };
    const onRequest = (request) => {
      try {
        const url = request.url();
        // Capture from SportV API endpoints or menu endpoint (contains Bearer token)
        const isSportVApi = url.includes('/Betting/') || url.includes('/Sports/') || url.includes('/BFOdds/') || url.includes('/SportV/');
        const isMenuEndpoint = url.includes('/api/menu/desktopMenu');
        if (!isSportVApi && !isMenuEndpoint) return;
        const headers = request.headers();
        if (headers['authorization'] && !capturedCtx.bearer) {
          capturedCtx.bearer = headers['authorization'].replace(/^bearer\s+/i, '').trim();
          log.info({ url: url.slice(0, 100) }, 'Lu88: captured Bearer token from request');
        }
        if (headers['custid'] && !capturedCtx.custId) capturedCtx.custId = headers['custid'];
        if (headers['uid'] && !capturedCtx.uid) capturedCtx.uid = headers['uid'];
        if (headers['username'] && !capturedCtx.username) capturedCtx.username = headers['username'];
        // Capture session URL pattern (S(xxx)) from request URL
        if (!capturedCtx.sessionUrl) {
          const sessionMatch = url.match(/(https?:\/\/[^/]+\/\(S\([^)]+\)\))/i);
          if (sessionMatch) capturedCtx.sessionUrl = sessionMatch[1];
        }
      } catch (err) {
        log.debug({ err: err.message }, 'Lu88: request interception error');
      }
    };

    // Persistent sinfo interceptor via CDP — bắt được cả iframe response (cross-origin)
    // page.on('response') không bắt được cross-origin iframe, phải dùng CDP
    if (!this._cdpSinfoInterceptorInstalled) {
      try {
        const cdpSession = await page.context().newCDPSession(page);
        await cdpSession.send('Network.enable');
        const walkAndCacheSinfo = (obj, url) => {
          if (!obj || typeof obj !== 'object') return;
          if (Array.isArray(obj)) { obj.forEach(o => walkAndCacheSinfo(o, url)); return; }
          if ((obj.OddsID || obj.OddsId || obj.oddsId) && obj.sinfo) {
            const oid = String(obj.OddsID ?? obj.OddsId ?? obj.oddsId);
            const betteam = (obj.Betteam || obj.betteam || '').toLowerCase();
            const shortKey = betteam ? `${oid}_${betteam}` : oid;
            const sinfo = obj.sinfo;
            if (!this._lu88SelectionCache) this._lu88SelectionCache = new Map();
            const existing = this._lu88SelectionCache.get(shortKey);
            if (existing) {
              existing.sinfo = sinfo;
            } else {
              this._lu88SelectionCache.set(shortKey, { sinfo });
            }
            this._lu88SelectionCache.set(oid, { ...(this._lu88SelectionCache.get(oid) || {}), sinfo });
            log.info({ oid, betteam, sinfo, url: url.slice(0, 100) }, 'Lu88: CDP interceptor captured sinfo');
          }
          Object.values(obj).forEach(v => walkAndCacheSinfo(v, url));
        };
        cdpSession.on('Network.responseReceived', async (evt) => {
          try {
            const ct = evt.response?.mimeType || '';
            if (!ct.includes('json')) return;
            const url = evt.response.url || '';
            const body = await cdpSession.send('Network.getResponseBody', { requestId: evt.requestId }).catch(() => null);
            if (!body?.body) return;
            const text = body.base64Encoded ? Buffer.from(body.body, 'base64').toString('utf8') : body.body;
            if (!text.includes('sinfo')) return;
            log.debug({ url: url.slice(0, 150) }, 'Lu88: CDP — JSON response with sinfo found');
            let parsed;
            try { parsed = JSON.parse(text); } catch (_) { return; }
            walkAndCacheSinfo(parsed, url);
          } catch (_) {}
        });
        this._cdpSinfoInterceptorInstalled = true;
        log.info('Lu88: installed CDP sinfo interceptor (captures iframe responses)');
      } catch (cdpErr) {
        log.warn({ err: cdpErr.message }, 'Lu88: CDP sinfo interceptor failed to install, falling back to page.on');
        // Fallback: page.on response (won't catch cross-origin iframe but better than nothing)
        if (!this._persistentSinfoInterceptor) {
          this._persistentSinfoInterceptor = async (response) => {
            try {
              const ct = response.headers()['content-type'] || '';
              if (!ct.includes('json')) return;
              const text = await response.text().catch(() => '');
              if (!text.includes('sinfo')) return;
              const url = response.url();
              let parsed;
              try { parsed = JSON.parse(text); } catch (_) { return; }
              const walk = (obj) => {
                if (!obj || typeof obj !== 'object') return;
                if (Array.isArray(obj)) { obj.forEach(walk); return; }
                if ((obj.OddsID || obj.OddsId || obj.oddsId) && obj.sinfo) {
                  const oid = String(obj.OddsID ?? obj.OddsId ?? obj.oddsId);
                  const betteam = (obj.Betteam || obj.betteam || '').toLowerCase();
                  const shortKey = betteam ? `${oid}_${betteam}` : oid;
                  const sinfo = obj.sinfo;
                  if (!this._lu88SelectionCache) this._lu88SelectionCache = new Map();
                  const existing = this._lu88SelectionCache.get(shortKey);
                  if (existing) { existing.sinfo = sinfo; } else { this._lu88SelectionCache.set(shortKey, { sinfo }); }
                  this._lu88SelectionCache.set(oid, { ...(this._lu88SelectionCache.get(oid) || {}), sinfo });
                  log.info({ oid, betteam, sinfo, url: url.slice(0, 80) }, 'Lu88: page interceptor captured sinfo (fallback)');
                }
                Object.values(obj).forEach(walk);
              };
              walk(parsed);
            } catch (_) {}
          };
          page.on('response', this._persistentSinfoInterceptor);
        }
      }
    }

    page.on('request', onRequest);

    // Navigate with fallback strategy: try networkidle first, then domcontentloaded if timeout
    try {
      await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 60000 });
      log.info('Lu88: navigation complete (networkidle)');
    } catch (navErr) {
      log.warn({ err: navErr.message }, 'Lu88: networkidle navigation failed, trying domcontentloaded');
      try {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        log.info('Lu88: navigation complete (domcontentloaded fallback)');
      } catch (fallbackErr) {
        log.error({ err: fallbackErr.message }, 'Lu88: both navigation strategies failed');
        page.off('request', onRequest);
        throw new Error(`Lu88 warmUp navigation failed: ${fallbackErr.message}`);
      }
    }
    
    // Wait for SportV iframe to initialize and make API calls
    log.info('Lu88: waiting for SportV iframe to load...');
    await page.waitForTimeout(8000);

    page.off('request', onRequest);
    // Note: persistent sinfo interceptor (_persistentSinfoInterceptor) intentionally stays active

    // If not yet captured via request intercept, try reading from iframe URL
    if (!capturedCtx.sessionUrl) {
      try {
        const frameUrl = await page.frameLocator('#sportsFrame').locator('body').evaluate(() => window.location.href).catch(() => '');
        const sessionMatch = frameUrl.match(/(https?:\/\/[^/]+\/\(S\([^)]+\)\))/i);
        if (sessionMatch) capturedCtx.sessionUrl = sessionMatch[1];
        if (!capturedCtx.sessionUrl) {
          // fallback: use current page URL base
          const pageUrl = page.url();
          const m = pageUrl.match(/(https?:\/\/[^/]+\/\(S\([^)]+\)\))/i);
          if (m) capturedCtx.sessionUrl = m[1];
        }
      } catch (_) {}
    }

    // Try extracting LicUserName from page JS context
    if (!capturedCtx.licUserName) {
      try {
        const frame = page.frameLocator('#sportsFrame');
        capturedCtx.licUserName = await frame.locator('body').evaluate(() => {
          return window.__LicUserName || window.licUserName || document.querySelector('[data-licusername]')?.dataset?.licusername || '';
        }).catch(() => '');
      } catch (_) {}
    }

    if (capturedCtx.bearer) {
      this._sportvBearerToken = capturedCtx.bearer;
      log.info('Lu88: warmUp — Bearer token captured via interception');
    } else {
      log.error({ 
        sessionUrl: capturedCtx.sessionUrl,
        hasCustId: !!capturedCtx.custId,
        hasUid: !!capturedCtx.uid,
        hasUsername: !!capturedCtx.username,
        currentUrl: page.url(),
      }, 'Lu88: warmUp — Bearer token NOT captured; placeBet will fail');
      throw new Error('Lu88 warmUp failed: Bearer token not captured from SportV requests. Check if SportV iframe loaded correctly.');
    }
    if (capturedCtx.sessionUrl) {
      this._sportvSessionUrl = capturedCtx.sessionUrl;
      log.info({ sessionUrl: this._sportvSessionUrl }, 'Lu88: warmUp — session URL captured');
    }
    if (capturedCtx.custId) this._sportvCustId = capturedCtx.custId;
    if (capturedCtx.uid) this._sportvUid = capturedCtx.uid;
    if (capturedCtx.username) this._sportvUsername = capturedCtx.username;
    if (capturedCtx.licUserName) this._sportvLicUserName = capturedCtx.licUserName;

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

    const checkFrameLoaded = async (retries = 3) => {
      for (let i = 0; i < retries; i++) {
        try {
          const frame = page.frameLocator('#sportsFrame');
          const count = await frame.locator('body').count();
          if (count > 0) return true;
        } catch (e) {
          log.debug({ attempt: i + 1, err: e.message }, 'Lu88: frame check failed, retrying...');
        }
        await page.waitForTimeout(1000);
      }
      return false;
    };

    const frameReady = await checkFrameLoaded();
    if (!frameReady) {
      log.warn('Lu88: sportsFrame not ready after retries');
      return [];
    }

    try {
      const frame = page.frameLocator('#sportsFrame');
      log.info('Lu88: fetching active odds inside iframe...');

      // wait for matches to attach with shorter timeout and fallback
      let matchesFound = false;
      try {
        await frame.locator('.c-match').first().waitFor({ state: 'attached', timeout: 15000 });
        matchesFound = true;
      } catch (e) {
        log.warn('Lu88: timeout waiting for .c-match, proceeding anyway');
      }
      
      await page.waitForTimeout(3000);
      const matchesCount = await frame.locator('.c-match').count();
      log.info({ count: matchesCount, matchesFound }, 'Lu88: found match elements');

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
   * Fetch full odds details for only the specified event.
   * Returns event with grouped markets format (giống x1Adapter).
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

      // Debug: dump outerHTML of first odds button to check if sinfo is embedded
      try {
        const firstBtnHtml = await frame.locator('.c-odds-button').first().evaluate(el => el.outerHTML).catch(() => '');
        if (firstBtnHtml) log.info({ firstBtnHtml: firstBtnHtml.slice(0, 500) }, 'Lu88: sample c-odds-button HTML');
      } catch (_) {}
      
      const html = await frame.locator('body').innerHTML();
      const oddsList = this._parseOddsFromHtml(html, sportType, true, eventId);

      log.info({ oddsListLength: oddsList.length, eventId }, 'Lu88: parsed odds for event');

      if (oddsList.length === 0) {
        log.warn({ eventId }, 'Lu88: no odds found for event');
        return null;
      }

      // Lấy event info từ entry đầu tiên
      const firstEntry = oddsList[0];
      const markets = this._groupMarketsForEvent(oddsList);

      const eventData = {
        eventId: firstEntry.eventId,
        leagueId: firstEntry.leagueId,
        sport: sportType,
        home: firstEntry.home,
        away: firstEntry.away,
        league: firstEntry.league,
        startTime: firstEntry.startTime,
        scope: firstEntry.scope,
        homeScore: firstEntry.homeScore ?? null,
        awayScore: firstEntry.awayScore ?? null,
        markets,
      };

      // Populate selectionId cache từ oddsList raw (có đủ oddsId/betteam/bettype)
      this._populateSelectionCache(oddsList, eventData);

      return eventData;
    } catch (error) {
      log.error({ error: error.message }, 'Lu88: getEventOdds failed');
      return null;
    }
  }

  /**
   * Build flat _lu88SelectionCache từ oddsList raw (output của _parseOddsFromHtml).
   * Cache entry: selectionId → { oddsId, betteam, bettype, line, odds, eventId, home, away, homeScore, awayScore, isInPlay }
   * @param {Array} oddsList  - raw parsed odds có đủ selections với oddsId/betteam/bettype
   * @param {object} eventData - event info để lấy home/away/score/scope
   */
  _populateSelectionCache(oddsList, eventData) {
    if (!Array.isArray(oddsList) || oddsList.length === 0) return;

    const isInPlay = eventData.scope === 'live';
    const base = {
      eventId: eventData.eventId,
      home: eventData.home,
      away: eventData.away,
      homeScore: eventData.homeScore ?? 0,
      awayScore: eventData.awayScore ?? 0,
      isInPlay,
    };

    for (const entry of oddsList) {
      if (!Array.isArray(entry.selections)) continue;
      for (const sel of entry.selections) {
        if (!sel.oddsId || !sel.betteam) continue;
        const selectionId = `lu88_${sel.oddsId}_${sel.betteam}`;
        const shortKey = `${sel.oddsId}_${sel.betteam}`;
        // Giữ lại sinfo đã có trong cache (từ HTML parse) nếu sel không cung cấp
        const existingSinfo = this._lu88SelectionCache.get(shortKey)?.sinfo || this._lu88SelectionCache.get(selectionId)?.sinfo || '';
        const entry2 = {
          ...base,
          oddsId: sel.oddsId,
          betteam: sel.betteam,
          bettype: sel.bettype,
          line: sel.line ?? 0,
          odds: sel.odds,
          sinfo: sel.sinfo || existingSinfo,
        };
        this._lu88SelectionCache.set(selectionId, entry2);
        // Ghi cả short-key để _callGetTickets lookup được
        this._lu88SelectionCache.set(shortKey, entry2);
      }
    }

    log.debug({ eventId: eventData.eventId, cacheSize: this._lu88SelectionCache.size }, 'Lu88: selectionCache populated');
  }

  /**
   * Place bet by selection ID from cached odds data.
   * API endpoint: POST /api/:bookmakerKey/bets/by-selection
   *
   * Prerequisites: Gọi GET /api/:bookmakerKey/events/:eventId trước để populate cache.
   *
   * @param {import('playwright').Page} page
   * @param {object} params
   * @param {string} params.eventId - Event ID (để validate)
   * @param {string} params.selectionId - Selection ID từ cache (e.g., "lu88_982453812_a")
   * @param {number} params.stake - Số tiền đặt
   * @param {number} [params.expectedOdds] - Optional: validate odds không drift quá threshold
   * @param {number} [params.oddsDriftThreshold=0.05] - Ngưỡng chấp nhận odds drift (5% mặc định)
   * @returns {Promise<{ order_ref: string, placed_odds: number, placed_stake: number }>}
   */
  async placeBetBySelection(page, { eventId, selectionId, stake, expectedOdds, oddsDriftThreshold = 0.05 }) {
    log.info({ eventId, selectionId, stake }, 'Lu88: placeBetBySelection — looking up cached data');

    // 1. Validate selectionId format
    if (!selectionId || !selectionId.startsWith('lu88_')) {
      throw new Error(`Lu88 placeBetBySelection: invalid selectionId format "${selectionId}". Expected "lu88_{oddsId}_{betteam}"`);
    }

    // 2. Lookup from cache
    const cached = this._lu88SelectionCache.get(selectionId);
    if (!cached) {
      throw new Error(`Lu88 placeBetBySelection: no cached data for selection "${selectionId}". Call getEventOdds first.`);
    }

    // 3. Validate eventId matches
    if (cached.eventId !== eventId) {
      throw new Error(`Lu88 placeBetBySelection: eventId mismatch. Expected "${cached.eventId}", got "${eventId}"`);
    }

    // 4. Validate odds drift if expectedOdds provided
    const currentOdds = cached.odds;
    if (expectedOdds !== undefined && expectedOdds > 0) {
      const drift = Math.abs(currentOdds - expectedOdds) / expectedOdds;
      if (drift > oddsDriftThreshold) {
        throw new Error(`Lu88 placeBetBySelection: odds drifted too much. Expected ${expectedOdds}, got ${currentOdds} (drift ${(drift * 100).toFixed(1)}% > threshold ${(oddsDriftThreshold * 100).toFixed(1)}%)`);
      }
    }

    log.info({
      eventId, selectionId,
      oddsId: cached.oddsId, betteam: cached.betteam, bettype: cached.bettype,
      line: cached.line, currentOdds, stake
    }, 'Lu88: placeBetBySelection — resolved from cache, delegating to placeBet');

    // 5. Build leg và delegate to placeBet
    const leg = {
      eventId: cached.eventId,
      selectionId,
      oddsId: cached.oddsId,
      betteam: cached.betteam,
      bettype: cached.bettype,
      line: cached.line,
      odds: currentOdds,
      stake,
      home: cached.home,
      away: cached.away,
      homeScore: cached.homeScore,
      awayScore: cached.awayScore,
      isInPlay: cached.isInPlay,
      sinfo: cached.sinfo,
    };

    return this.placeBet(page, leg);
  }

  /**
   * Map data-bt number → Type string gửi lên ProcessBet.
   * Theo quan sát thực tế từ curl: bt=1 (AH) vẫn dùng Type="OU".
   * @param {number} bettype
   * @returns {string}
   */
  _bettypeToTypeStr(bettype) {
    if (bettype === 5 || bettype === 15) return '1X2';
    return 'OU';
  }

  /**
   * Xác định ChoiceValue hiển thị dựa trên loại kèo và betteam.
   * @param {import('../models/index.js').BetLeg} leg
   * @returns {string}
   */
  _buildChoiceValue(leg) {
    const bt = leg.bettype;
    const betteam = (leg.betteam || '').toLowerCase();

    if (bt === 3 || bt === 8) {
      // OU
      return (betteam === 'o' || betteam === 'h') ? 'Tài' : 'Xỉu';
    }
    if (bt === 1 || bt === 7) {
      // AH — dùng tên đội
      return (betteam === 'h') ? (leg.home || 'Home') : (leg.away || 'Away');
    }
    if (bt === 5 || bt === 15) {
      // 1X2
      if (betteam === 'h' || betteam === '1') return '1';
      if (betteam === 'x') return 'X';
      return '2';
    }
    return leg.label || '';
  }

  /**
   * Lấy session context từ cached warmUp interception.
   * Ném lỗi nếu thiếu thông tin bắt buộc.
   * @returns {{ bearer: string, sessionUrl: string, custId: string, uid: string, username: string, licUserName: string }}
   */
  async _extractSportVSession(page) {
    if (!this._sportvBearerToken) {
      throw new Error('Lu88 placeBet: Bearer token not captured — run warmUp() first or check if SportV requests were intercepted');
    }
    if (!this._sportvSessionUrl) {
      throw new Error('Lu88 placeBet: session URL (S(xxx)) not captured — run warmUp() first');
    }

    // Extract LicUserName from HTML if not cached
    if (!this._sportvLicUserName) {
      try {
        // Try multiple selectors for LicUserName
        this._sportvLicUserName = await page.evaluate(() => {
          const selectors = ['.l-text-group .c-text', '[data-licusername]', '.user-info .username', '.account-info'];
          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el?.textContent?.trim()) return el.textContent.trim();
          }
          // Try from global JS variable
          return window.__LicUserName || window.licUserName || window.LicUserName || '';
        });
        if (this._sportvLicUserName) {
          log.info({ licUserName: this._sportvLicUserName }, 'Lu88: Extracted LicUserName from HTML/JS');
        } else {
          log.warn('Lu88: LicUserName not found in HTML/JS');
        }
      } catch (e) {
        log.warn({ error: e.message }, 'Lu88: Failed to extract LicUserName from HTML');
      }
    }

    // Fallback: get bearer token from sessionStorage if not captured
    if (!this._sportvBearerToken) {
      try {
        const sessionToken = await page.evaluate(() => {
          return sessionStorage.getItem('at') || '';
        });
        if (sessionToken) {
          this._sportvBearerToken = sessionToken;
          log.info('Lu88: Retrieved bearer token from sessionStorage key "at"');
        }
      } catch (e) {
        log.warn({ error: e.message }, 'Lu88: Failed to get bearer token from sessionStorage');
      }
    }

    return {
      bearer: this._sportvBearerToken,
      sessionUrl: this._sportvSessionUrl,
      custId: this._sportvCustId || '',
      uid: this._sportvUid || '',
      username: this._sportvUsername || '',
      licUserName: this._sportvLicUserName || '',
    };
  }

  /**
   * Build URLSearchParams body cho /Betting/GetTickets hoặc /Betting/ProcessBet API.
   * Hai endpoint dùng cùng schema params, chỉ khác:
   *   - GetTickets: sinfo rỗng, KHÔNG có Guid/betAction/MMR/... một số field, có thêm `lastReq=<unix>`
   *   - ProcessBet: sinfo lấy từ response của GetTickets, kèm full set fields
   * @param {import('../models/index.js').BetLeg} leg
   * @param {{ custId: string, uid: string, username: string, licUserName: string }} sessionCtx
   * @param {{ sinfo?: string, guid?: string, lastReq?: number, mode?: 'getTickets'|'processBet' }} opts
   * @returns {string} URL-encoded form body
   */
  _buildBetBody(leg, sessionCtx, opts = {}) {
    const mode = opts.mode || 'processBet';
    const bettype = leg.bettype ?? 3;
    const typeStr = this._bettypeToTypeStr(bettype);
    const choiceValue = this._buildChoiceValue(leg);
    const lineVal = leg.line != null ? leg.line : 0;
    // Hdp1 = abs(line) theo format LU88; sign conveyed via Betteam
    const hdp1 = leg.hdp1 != null ? leg.hdp1 : Math.abs(lineVal);
    const hdp2 = leg.hdp2 != null ? leg.hdp2 : 0;
    const betteamRaw = (leg.betteam || 'h').toLowerCase();
    // LU88 API: Betteam = '1' (Home/Over) hoặc '2' (Away/Under)
    const betteam = (betteamRaw === 'h' || betteamRaw === 'o' || betteamRaw === '1') ? '1' : '2';

    const params = new URLSearchParams();
    params.set('ItemList[0][Type]', typeStr);
    params.set('ItemList[0][Bettype]', String(bettype));
    params.set('ItemList[0][Oddsid]', String(leg.oddsId || ''));
    params.set('ItemList[0][Odds]', String(leg.odds));
    params.set('ItemList[0][Line]', String(lineVal));
    params.set('ItemList[0][Hdp1]', String(hdp1));
    params.set('ItemList[0][Hdp2]', String(hdp2));
    params.set('ItemList[0][Hscore]', String(leg.homeScore ?? 0));
    params.set('ItemList[0][Ascore]', String(leg.awayScore ?? 0));
    params.set('ItemList[0][Betteam]', betteam);
    // Stake chỉ cần cho ProcessBet, GetTickets không cần (để trống)
    if (mode === 'processBet') {
      params.set('ItemList[0][Stake]', String(leg.stake));
    }
    params.set('ItemList[0][Matchid]', String(leg.eventId || ''));
    params.set('ItemList[0][ChoiceValue]', choiceValue);
    params.set('ItemList[0][SrcOddsInfo]', '');
    // ErrorCode chỉ cần cho ProcessBet
    if (mode === 'processBet') {
      params.set('ItemList[0][ErrorCode]', '0');
    }
    params.set('ItemList[0][Home]', leg.home || '');
    params.set('ItemList[0][Away]', leg.away || '');
    params.set('ItemList[0][Gameid]', '1');
    params.set('ItemList[0][ProgramID]', '');
    params.set('ItemList[0][RaceNum]', '0');
    params.set('ItemList[0][Runner]', '0');
    // MRPercentage chỉ cần cho ProcessBet
    if (mode === 'processBet') {
      params.set('ItemList[0][MRPercentage]', '');
    }
    params.set('ItemList[0][AcceptBetterOdds]', 'true');
    params.set('ItemList[0][isQuickBet]', 'false');
    params.set('ItemList[0][isTablet]', 'false');
    params.set('ItemList[0][IsInPlay]', leg.isInPlay ? 'true' : 'false');
    // LU88: only send sinfo when it has value; sending empty string causes dummy "0000X0000" response
    if (opts.sinfo) {
      params.set('ItemList[0][sinfo]', opts.sinfo);
    }
    params.set('ItemList[0][parentMatchId]', '0');
    // RecommendType chỉ cần cho ProcessBet
    if (mode === 'processBet') {
      params.set('ItemList[0][RecommendType]', '0');
    }
    // Guid chỉ cần cho ProcessBet
    if (mode === 'processBet') {
      params.set('ItemList[0][Guid]', opts.guid || crypto.randomUUID());
    }
    // TicketTime, MMR, LuckyDrawMinBet chỉ cần cho ProcessBet
    if (mode === 'processBet') {
      params.set('ItemList[0][TicketTime]', '0');
      params.set('ItemList[0][MMR]', '');
      params.set('ItemList[0][LuckyDrawMinBet]', '');
    }
    params.set('ItemList[0][IsFromParlayPage]', 'false');
    params.set('ItemList[0][betAction]', '0');
    if (mode === 'getTickets') {
      params.set('lastReq', String(opts.lastReq ?? Math.floor(Date.now() / 1000)));
    }
    params.set('OddsType', '4');
    params.set('WebSkinType', '3');
    params.set('LicUserName', sessionCtx.licUserName);
    return params.toString();
  }

  /**
   * Gọi /Betting/GetTickets để lấy `sinfo` thật + odds/line/hdp đã chốt từ server.
   * Đây là step bắt buộc trước khi ProcessBet (LU88 yêu cầu sinfo do server cấp).
   * @param {import('playwright').Page} page
   * @param {import('../models/index.js').BetLeg} leg
   * @param {object} sessionCtx
   * @param {object} headers - headers chung (auth/custid/...) đã build sẵn
   * @returns {Promise<{ sinfo: string, displayOdds: number, srcOdds: number, line: number, hdp1: number, hdp2: number, message?: string, errorCode: number, raw: object }>}
   */
  async _callGetTickets(page, leg, sessionCtx, headers) {
    const oddsId = String(leg.oddsId);
    const betteamRaw = (leg.betteam || '').toLowerCase();
    const betteamMapped = (['h', 'o', '1'].includes(betteamRaw)) ? '1' : '2';

    log.info({ oddsId, betteam: leg.betteam, betteamMapped, eventId: leg.eventId },
      'Lu88: GetTickets — clicking UI button to capture real sinfo');

    // --- Chuẩn bị intercept response TRƯỚC khi click ---
    const getTicketsResponsePromise = page.waitForResponse(
      resp => resp.url().includes('/Betting/GetTickets') && resp.status() === 200,
      { timeout: 10000 }
    ).catch(err => { throw new Error(`Lu88 GetTickets: timeout waiting for network response after click — ${err.message}`); });

    // --- Tìm và click odds button ---
    // Selector: span/div có data-moid="eventId__oddsId" nằm trong .c-odds-button
    // Server dùng data-moid để map odds; betteam=1 = phần tử đầu, betteam=2 = phần tử thứ hai
    const selectors = [
      `[data-moid="${leg.eventId}__${oddsId}"]`,
      `[data-moid*="__${oddsId}"]`,
    ];

    let clicked = false;

    // Thử click trong sportsFrame (outer page có iframe)
    for (const sel of selectors) {
      if (clicked) break;
      try {
        const frame = page.frameLocator('#sportsFrame');
        const matches = frame.locator(sel);
        const count = await matches.count().catch(() => 0);
        if (count > 0) {
          const idx = betteamMapped === '1' ? 0 : Math.min(1, count - 1);
          await matches.nth(idx).dispatchEvent('click');
          clicked = true;
          log.info({ selector: sel, idx, count }, 'Lu88: GetTickets — clicked via sportsFrame');
        }
      } catch (_) {}
    }

    // Fallback: page trực tiếp (khi đã navigate đến sports page, không có iframe)
    if (!clicked) {
      for (const sel of selectors) {
        if (clicked) break;
        try {
          const matches = page.locator(sel);
          const count = await matches.count().catch(() => 0);
          if (count > 0) {
            const idx = betteamMapped === '1' ? 0 : Math.min(1, count - 1);
            await matches.nth(idx).dispatchEvent('click');
            clicked = true;
            log.info({ selector: sel, idx, count }, 'Lu88: GetTickets — clicked on direct page');
          }
        } catch (_) {}
      }
    }

    if (!clicked) {
      getTicketsResponsePromise.catch(() => {});
      throw new Error(`Lu88 GetTickets: không tìm thấy odds button trên UI — oddsId=${oddsId}, eventId=${leg.eventId}`);
    }

    // --- Chờ response GetTickets từ network ---
    const networkResponse = await getTicketsResponsePromise;

    let json;
    try {
      json = await networkResponse.json();
    } catch (e) {
      const rawText = await networkResponse.text().catch(() => '');
      throw new Error(`Lu88 GetTickets: invalid JSON response — ${rawText.slice(0, 200)}`);
    }

    log.info({ json }, 'Lu88: GetTickets response (intercepted from UI click)');

    if (json.ErrorCode !== 0) {
      throw new Error(`Lu88 GetTickets API error (${json.ErrorCode})`);
    }

    const item = Array.isArray(json.Data) ? json.Data[0] : json.Data?.ItemList?.[0];
    if (!item) {
      throw new Error('Lu88 GetTickets: empty Data in response');
    }

    // Kèo đóng tạm thời
    if (item.OddsStatus === 'closeprice' || item.Code === 6) {
      const msg = item.Message || 'Tỷ lệ cược tạm thời bị đóng';
      log.warn({ oddsId, oddsStatus: item.OddsStatus, code: item.Code }, 'Lu88: GetTickets — odds closed');
      throw new Error(`Lu88 GetTickets: odds closed — ${msg}`);
    }

    if (item.ErrorCode !== 0) {
      const msg = item.Message || `item ErrorCode ${item.ErrorCode}`;
      log.error({ itemErrorCode: item.ErrorCode, message: msg }, 'Lu88: GetTickets item-level error');
      throw new Error(`Lu88 GetTickets item error (${item.ErrorCode}): ${msg}`);
    }

    const isDummySinfo = !item.sinfo || item.sinfo === '0000X0000';
    if (isDummySinfo) {
      log.warn({ returnedSinfo: item.sinfo, oddsId, betteam: leg.betteam },
        'Lu88: GetTickets from UI click still returned dummy sinfo');
      throw new Error(`Lu88 GetTickets: server returned dummy sinfo "${item.sinfo}" even after UI click`);
    }

    return {
      sinfo: item.sinfo,
      guid: item.Guid,
      displayOdds: parseFloat(item.DisplayOdds ?? item.SrcOdds ?? leg.odds),
      srcOdds: parseFloat(item.SrcOdds ?? item.DisplayOdds ?? leg.odds),
      line: item.Line != null ? parseFloat(item.Line) : leg.line,
      hdp1: item.Hdp1 != null ? parseFloat(item.Hdp1) : null,
      hdp2: item.Hdp2 != null ? parseFloat(item.Hdp2) : null,
      message: item.Message,
      errorCode: item.ErrorCode,
      isOddsChange: !!item.isOddsChange,
      isLineChange: !!item.isLineChange,
      raw: item,
    };
  }

  /**
   * Place a bet via LU88 ProcessBet API.
   *
   * leg phải có các trường:
   *   - leg.eventId   {string|number} — Matchid
   *   - leg.oddsId    {string}        — ID tỷ lệ (từ .c-odds-button id)
   *   - leg.bettype   {number}        — data-bt (1=AH, 3=OU, 5=1X2, ...)
   *   - leg.betteam   {string}        — "h"|"a"|"o"|"u"
   *   - leg.odds      {number}        — tỷ lệ ăn
   *   - leg.stake     {number}        — số tiền đặt
   *   - leg.line      {number}        — mốc kèo
   *   - leg.home      {string}        — tên đội nhà
   *   - leg.away      {string}        — tên đội khách
   *   - leg.isInPlay  {boolean}       [optional]
   *   - leg.homeScore {number}        [optional]
   *   - leg.awayScore {number}        [optional]
   *
   * @param {import('playwright').Page} page
   * @param {import('../models/index.js').BetLeg} leg
   * @returns {Promise<{ order_ref: string, placed_odds: number, placed_stake: number }>}
   */
  async placeBet(page, leg) {
    // --- Resolve LU88-specific metadata từ selectionId nếu oddsId chưa có ---
    if (leg.selectionId && !leg.oddsId) {
      const cached = this._lu88SelectionCache.get(leg.selectionId);
      if (!cached) {
        throw new Error(`Lu88 placeBet: selectionId "${leg.selectionId}" not found in cache — call getEventOdds() first`);
      }
      leg = { ...leg, ...cached };
      log.info({ selectionId: leg.selectionId, resolved: cached }, 'Lu88: placeBet — resolved metadata from selectionId');
    }

    log.info(
      { eventId: leg.eventId, oddsId: leg.oddsId, bettype: leg.bettype, betteam: leg.betteam, odds: leg.odds, stake: leg.stake },
      'Lu88: placeBet via ProcessBet API'
    );

    // --- Validate bắt buộc ---
    if (!leg.eventId) throw new Error('Lu88 placeBet: leg.eventId (Matchid) is required');
    if (!leg.oddsId) throw new Error('Lu88 placeBet: leg.oddsId is required — provide leg.oddsId or leg.selectionId');
    if (leg.bettype == null) throw new Error('Lu88 placeBet: leg.bettype is required');
    if (!leg.betteam) throw new Error('Lu88 placeBet: leg.betteam is required');
    if (!leg.odds || leg.odds === 0) throw new Error('Lu88 placeBet: leg.odds is required');
    if (!leg.stake || leg.stake <= 0) throw new Error('Lu88 placeBet: leg.stake must be > 0');
    if (!leg.home || !leg.away) throw new Error('Lu88 placeBet: leg.home and leg.away are required');

    // --- Lấy session context ---
    const sessionCtx = await this._extractSportVSession(page);

    const betUrl = `${sessionCtx.sessionUrl}/Betting/ProcessBet`;

    const headers = {
      'accept': 'application/json, text/javascript, */*; q=0.01',
      'accept-language': 'vi-VN',
      'authorization': `bearer ${sessionCtx.bearer}`,
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'custid': sessionCtx.custId,
      'devicetype': '1',
      'origin': new URL(sessionCtx.sessionUrl).origin,
      'referer': `${sessionCtx.sessionUrl}/Sports/?mode=m0&market=T`,
      'uid': sessionCtx.uid || sessionCtx.username,
      'username': sessionCtx.username,
      'x-requested-with': 'XMLHttpRequest',
    };

    // --- Step 1: GetTickets để lấy sinfo + odds/line đã chốt ---
    const ticket = await this._callGetTickets(page, leg, sessionCtx, headers);
    log.info(
      { sinfo: ticket.sinfo, displayOdds: ticket.displayOdds, line: ticket.line, isOddsChange: ticket.isOddsChange, isLineChange: ticket.isLineChange },
      'Lu88: GetTickets confirmed — proceeding to ProcessBet'
    );

    // Cập nhật leg với odds/line/hdp do server chốt (AcceptBetterOdds=true cho phép thay đổi)
    const finalLeg = {
      ...leg,
      odds: ticket.displayOdds,
      line: ticket.line ?? leg.line,
      hdp1: ticket.hdp1 ?? undefined,
      hdp2: ticket.hdp2 ?? undefined,
    };

    // --- Step 2: ProcessBet với sinfo + Guid từ GetTickets response ---
    // Guid phải dùng từ GetTickets response, không tự sinh mới
    const guid = ticket.guid || crypto.randomUUID();
    const body = this._buildBetBody(finalLeg, sessionCtx, { mode: 'processBet', sinfo: ticket.sinfo, guid });

    log.info({ betUrl, eventId: leg.eventId, oddsId: leg.oddsId, sinfo: ticket.sinfo, licUserName: sessionCtx.licUserName }, 'Lu88: ProcessBet request');
    log.info({ headers }, 'Lu88: ProcessBet request headers');
    log.info({ body }, 'Lu88: ProcessBet request body (URL-encoded form data)');

    const response = await page.request.post(betUrl, {
      headers,
      data: body,
      timeout: 20000,
    });

    if (!response.ok()) {
      const statusCode = response.status();
      const respText = await response.text().catch(() => '');
      log.error({ statusCode, body: respText.slice(0, 500) }, 'Lu88: ProcessBet HTTP error');
      throw new Error(`Lu88 ProcessBet failed with HTTP ${statusCode}: ${respText.slice(0, 200)}`);
    }

    let json;
    try {
      json = await response.json();
    } catch (e) {
      const rawText = await response.text().catch(() => '');
      throw new Error(`Lu88 ProcessBet: invalid JSON response — ${rawText.slice(0, 200)}`);
    }

    log.info({ json }, 'Lu88: ProcessBet response');

    // --- Xử lý API-level error ---
    if (json.ErrorCode !== 0) {
      const msg = json.Data?.ItemList?.[0]?.Message || json.Data?.ErrorMsg || `ErrorCode ${json.ErrorCode}`;
      log.error({ errorCode: json.ErrorCode, message: msg, fullResponse: json }, 'Lu88: ProcessBet API error');
      throw new Error(`Lu88 ProcessBet API error (${json.ErrorCode}): ${msg}`);
    }

    const item = json.Data?.ItemList?.[0];
    if (!item) {
      throw new Error('Lu88 ProcessBet: empty ItemList in response');
    }

    if (item.ErrorCode !== 0 && item.Code !== 0) {
      const msg = item.Message || item.Common?.ErrorMsg || `item ErrorCode ${item.ErrorCode ?? item.Code}`;
      log.error({ itemErrorCode: item.ErrorCode ?? item.Code, message: msg, item }, 'Lu88: ProcessBet item-level error');
      throw new Error(`Lu88 ProcessBet item error (${item.ErrorCode ?? item.Code}): ${msg}`);
    }

    const ticketId = item.BetID || item.TransId_Cash || item.TransId_Bonus || String(item.Key || '');
    const placedOdds = parseFloat(item.DisplayOdds ?? leg.odds);
    const placedStake = parseFloat(item.Stake ?? leg.stake);

    if (item.isOddsChange) {
      log.warn({ requestedOdds: leg.odds, confirmedOdds: placedOdds }, 'Lu88: ProcessBet — odds changed');
    }
    if (item.isLineChange) {
      log.warn({ requestedLine: leg.line }, 'Lu88: ProcessBet — line changed');
    }

    log.info({ ticketId, placedOdds, placedStake }, 'Lu88: placeBet confirmed');

    return {
      order_ref: ticketId,
      placed_odds: placedOdds,
      placed_stake: placedStake,
    };
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
