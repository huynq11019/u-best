// T015 - 1xBet UI Adapter: login, warmUp, placeBet, hedgeLeg, voidLeg, getActiveOdds
import { BaseAdapter, SportType } from './baseAdapter.js';
import { childLogger } from '../config/logger.js';

const log = childLogger({ component: 'x1Adapter' });

const LOGGED_IN_SELECTORS = [
  '.double-row-header-user-office-dropdown__trigger',
  '.double-row-header-user-office-dropdown',
  '[class*="user-office-dropdown"]'
];

const LOGIN_TRIGGER_SELECTORS = [
  '.auth-dropdown-trigger',
  '[class*="auth-dropdown-trigger"]',
  'button:has-text("Đăng nhập")',
  'a:has-text("Đăng nhập")',
  'button:has-text("Login")',
  'a:has-text("Login")',
];

const LOGIN_USERNAME_SELECTORS = [
  'input#username:visible',
  'input[name="username"]:visible',
  'input[name="login"]:visible',
  'input[type="email"]:visible',
  'input[autocomplete="username"]:visible',
];

const LOGIN_PASSWORD_SELECTORS = [
  'input#username-password:visible',
  'input[name="password"]:visible',
  'input[type="password"]:visible',
  'input[autocomplete="current-password"]:visible',
];

const LOGIN_ERROR_HINTS = [
  'sai tên người dùng hoặc mật khẩu',
  'tài khoản hoặc mật khẩu sai',
  'username or password',
  'invalid login',
  'invalid credentials',
];

/**
 * Map SportType keys to 1xBet URL path segments and sport IDs.
 * Update path values if 1xBet changes their routing.
 */
const SPORT_URL_MAP = {
  [SportType.FOOTBALL]: { path: 'football', sportId: 1 },
  [SportType.BASKETBALL]: { path: 'basketball', sportId: 3 },
  [SportType.TENNIS]: { path: 'tennis', sportId: 5 },
  [SportType.BASEBALL]: { path: 'baseball', sportId: 11 },
  [SportType.HOCKEY]: { path: 'hockey', sportId: 12 },
  [SportType.VOLLEYBALL]: { path: 'volleyball', sportId: 21 },
  [SportType.ALL]: { path: '', sportId: null },
};

/**
 * Nhóm kèo (G) theo tài liệu GetGameZip.
 * Chỉ map các nhóm cần thiết cho surebet (1X2, Handicap, O/U).
 */
const MARKET_GROUP = {
  G_1X2_FULLTIME: 1,   // Thắng / Hòa / Thua - toàn trận
  G_HANDICAP: 2,       // Kèo chấp Châu Á
  G_TOTAL_OU: 17,      // Tài / Xỉu toàn trận
  G_BTTS: 19,          // Hai đội cùng ghi bàn
  G_1ST_HALF_OU: 15,   // Tài / Xỉu hiệp 1
};

/**
 * Selection Type (T) cần thiết khi đặt cược.
 * Đây là giá trị T gửi lên server lúc placeBet.
 */
const SELECTION_TYPE = {
  // 1X2
  HOME: 1, DRAW: 2, AWAY: 3,
  // Handicap
  HANDICAP_TEAM1: 7, HANDICAP_TEAM2: 8,
  // O/U
  OVER: 9, UNDER: 10,
};

/**
 * Headers giả lập trình duyệt để bypass anti-bot của 1xBet.
 * Phải khớp chính xác với request từ trình duyệt thật (đặc biệt accept-language & content-type).
 */
const API_HEADERS = {
  'accept': 'application/json, text/plain, */*',
  'accept-language': 'vi-VN',
  'content-type': 'application/json',
  'is-srv': 'false',
  'x-app-n': '__BETTING_APP__',
  'x-svc-source': '__BETTING_APP__',
  'x-requested-with': 'XMLHttpRequest',
  'x-mobile-project-id': '0',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
};

/**
 * Danh sách sport IDs bị loại trừ khi lọc bóng đá (antisports).
 * Lấy từ request thực tế của 1xBet frontend — loại tất cả trừ sportId=1 (Football).
 */
const FOOTBALL_ANTISPORTS = '2,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,94,95,96,97,98,99,100';

/**
 * Map sportId → tham số antisports (loại trừ sport còn lại để chỉ lấy sport cần).
 * Nếu không có entry thì dùng tham số sports= trực tiếp như fallback.
 */
const SPORT_FILTER_PARAMS = {
  1: { gr: '819', antisports: FOOTBALL_ANTISPORTS, virtualSports: 'true' }, // Football
};

/**
 * Reverse lookup: sportId (số) → path URL (vd: 1 → 'football').
 * Dùng để xây dựng chi tiết URL cho từng sport.
 */
const SPORT_ID_TO_PATH = Object.fromEntries(
  Object.values(SPORT_URL_MAP)
    .filter(v => v.sportId !== null)
    .map(v => [v.sportId, v.path])
);

/**
 * 1xBet bookmaker adapter.
 * Uses Playwright to interact with the 1xBet UI for bet placement.
 *
 * NOTE: Selectors and URLs are placeholders — update with real 1xBet UI locators.
 */
export default class X1Adapter extends BaseAdapter {
  constructor(bookmakerKey, bookkieConfig) {
    super(bookmakerKey, bookkieConfig);
    /**
     * Cache lưu metadata event sau mỗi lần getActiveOdds.
     * Key: composite eventId ("leagueId-gameId"), Value: { sportType, sportPath, leagueId, gameId, league, home, away }
     * TTL: tự xóa sau 5 phút để tránh stale data.
     */
    this._eventCache = new Map();
    this._eventCacheTimer = null;
  }

  /**
   * Lưu danh sách event vào cache với TTL 5 phút.
   * @param {Array} events - Mảng kết quả từ getActiveOdds
   * @param {string} sportType
   */
  _populateEventCache(events, sportType) {
    const sport = SPORT_URL_MAP[sportType] || SPORT_URL_MAP[SportType.FOOTBALL];
    for (const ev of events) {
      this._eventCache.set(ev.eventId, {
        sportType,
        sportPath: sport.path || 'football',
        leagueId: ev.leagueId,
        gameId: ev.eventId.split('-').map(Number).reduce((a, b) => Math.max(a, b), 0).toString(),
        league: ev.league,
        home: ev.home,
        away: ev.away,
      });
    }
    // Reset TTL: xóa cache sau 5 phút
    if (this._eventCacheTimer) clearTimeout(this._eventCacheTimer);
    this._eventCacheTimer = setTimeout(() => {
      this._eventCache.clear();
      log.info('1xBet: event cache cleared (TTL expired)');
    }, 5 * 60 * 1000);
    log.info({ size: this._eventCache.size }, '1xBet: event cache updated');
  }

  /**
   * Log in to 1xBet and wait for the home page to load.
   * @param {import('playwright').Page} page
   */
  async login(page) {
    log.info('1xBet: navigating to home page for login');
    const baseUrl = this.config.baseUrl || 'https://1xfun888bet.com/vi';

    await page.goto(baseUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Let client-side rendering settle before checking auth state.
    await page.waitForTimeout(1200);

    // Check if we are already logged in via existing session/cookies
    const isLoggedIn = await this._isLoggedInUIVisible(page);
    if (isLoggedIn) {
      log.info('1xBet: already logged in - skipping authentication');
      this._isLoggedIn = true;
      return;
    }

    log.info('1xBet: opening login dropdown');
    const loginTriggerSelector = await this._findVisibleSelector(page, LOGIN_TRIGGER_SELECTORS, 6000);

    if (!loginTriggerSelector) {
      // Retry auth-state check once more in case user widget renders late.
      await page.waitForTimeout(1500);
      const delayedLoggedIn = await this._isLoggedInUIVisible(page);
      if (delayedLoggedIn) {
        log.info('1xBet: already logged in (detected after delayed render)');
        this._isLoggedIn = true;
        return;
      }

      await page.screenshot({ path: './error_screenshots/login_trigger_missing_' + Date.now() + '.png', fullPage: true });
      throw new Error('1xBet: login trigger not found. UI selector likely changed.');
    }

    await page.click(loginTriggerSelector);

    log.info('1xBet: filling credentials');
    const usernameSelector = await this._findVisibleSelector(page, LOGIN_USERNAME_SELECTORS, 10000);
    const passwordSelector = await this._findVisibleSelector(page, LOGIN_PASSWORD_SELECTORS, 10000);

    if (!usernameSelector || !passwordSelector) {
      await page.screenshot({ path: './error_screenshots/login_inputs_missing_' + Date.now() + '.png', fullPage: true });
      throw new Error('1xBet: login inputs not found. UI selector likely changed.');
    }

    // Clear inputs first, then type to trigger validation events
    const usernameInput = page.locator(usernameSelector).first();
    const passwordInput = page.locator(passwordSelector).first();

    await usernameInput.click({ delay: 50 });
    await usernameInput.fill('');
    await page.waitForTimeout(200); // short wait to let UI react
    await usernameInput.pressSequentially(this.config.username || '', { delay: 100 });
    await usernameInput.dispatchEvent('input').catch(() => { });
    await usernameInput.dispatchEvent('change').catch(() => { });

    await passwordInput.click({ delay: 50 });
    await passwordInput.fill('');
    await page.waitForTimeout(200);
    await passwordInput.pressSequentially(this.config.password || '', { delay: 100 });
    await passwordInput.dispatchEvent('input').catch(() => { });
    await passwordInput.dispatchEvent('change').catch(() => { });

    await page.waitForTimeout(250);

    // Verify inputs before submitting
    log.info(`1xBet: taking screenshot before submit to verify inputs`);
    await page.screenshot({ path: './error_screenshots/before_submit_' + Date.now() + '.png', fullPage: false });

    log.info('1xBet: submitting login');
    await page.click('.auth-form-fields__submit');

    log.info('1xBet: waiting for result (success indicator, redirect, or error message)');
    // đợi không cần timeout
    const outcome = await this._waitForLoginOutcome(page, 60000);
    if (outcome.status === 'error') {
      log.error({ errorMsg: outcome.message || 'Unknown error' }, '1xBet: login failed with error message');
      throw new Error(`Login failed: ${outcome.message || 'Unknown error'}`);
    }

    if (outcome.status === 'timeout') {
      log.error({ loginUrl: page.url() }, '1xBet: login timed out without explicit success/error signal');
      throw new Error('Login timed out waiting for success or failure indicator');
    }

    log.info('1xBet: login complete');
    this._isLoggedIn = true;

    // Immediately fetch active football odds after login as a warm-up signal
    try {
      const activeOdds = await this.getActiveOdds(page, SportType.FOOTBALL);
      log.info({ count: activeOdds.length }, '1xBet: fetched active odds after login');
    } catch (err) {
      log.warn({ err }, '1xBet: getActiveOdds after login failed — non-critical, continuing');
    }
  }

  async _isLoggedInUIVisible(page) {
    for (const selector of LOGGED_IN_SELECTORS) {
      const visible = await page.locator(selector).first().isVisible().catch(() => false);
      if (visible) {
        log.info({ selector }, '1xBet: logged-in selector matched');
        return true;
      }
    }
    return false;
  }

  async _findVisibleSelector(page, selectors, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const selector of selectors) {
        const visible = await page.locator(selector).first().isVisible().catch(() => false);
        if (visible) {
          return selector;
        }
      }
      await page.waitForTimeout(250);
    }
    return null;
  }

  async _waitForAnySelector(page, selectors, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = await this._findVisibleSelector(page, selectors, 500);
      if (found) {
        return found;
      }
    }
    throw new Error('1xBet: timed out waiting for any success selector');
  }

  async _waitForLoginOutcome(page, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const isLoggedIn = await this._isLoggedInUIVisible(page);
      if (isLoggedIn) {
        return { status: 'success' };
      }

      const currentUrl = page.url();
      if (/\/user\/(accountverify|cabinet|profile|security|finance|settings)/i.test(currentUrl)) {
        return { status: 'success' };
      }

      const errorText = await page
        .locator('.auth-form-fields__error, .auth-form-fields__message, .modal-content, .notification__content')
        .first()
        .innerText()
        .catch(() => '');
      const normalizedErrorText = (errorText || '').toLowerCase();
      if (LOGIN_ERROR_HINTS.some((hint) => normalizedErrorText.includes(hint))) {
        return { status: 'error', message: errorText.trim() };
      }

      await page.waitForTimeout(300);
    }

    return { status: 'timeout' };
  }

  /**
   * Navigate to the live football OU betting page and ensure it's interactive.
   * @param {import('playwright').Page} page
   */
  async warmUp(page) {
    log.info('1xBet: warming up — navigating to live betting page');
    const baseUrl = this.config.baseUrl || 'https://1xfun888bet.com/vi';
    // Append /live to base URL, handling if it already ends with /vi or has a trailing slash
    const liveUrl = baseUrl.endsWith('/vi') ? baseUrl + '/live' :
      (baseUrl.endsWith('/') ? baseUrl + 'live' : baseUrl + '/live');

    await page.goto(liveUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    log.info('1xBet: waiting for odds list to load');
    await page.waitForSelector('div.dashboard-game-block, button.ui-market__toggle', {
      state: 'visible',
      timeout: 15000,
    }).catch(() => {
      log.warn('1xBet: warmUp selector not found — page may have different structure');
    });
    log.info('1xBet: warm-up complete');
  }

  /**
   * Place a bet for the given leg on the 1xBet UI.
   * @param {import('playwright').Page} page
   * @param {import('../models/index.js').BetLeg} leg
   * @returns {Promise<{ order_ref: string, placed_odds: number, placed_stake: number }>}
   */
  async placeBet(page, leg) {
    log.info({ leg: { type: leg.type, odds: leg.odds, stake: leg.stake } }, '1xBet: placing bet');

    // --- PLACEHOLDER IMPLEMENTATION ---
    // Must be replaced with actual 1xBet UI interaction logic.
    throw new Error(
      'X1Adapter.placeBet() requires real UI interaction — implement with actual 1xBet selectors'
    );

    // Expected return shape:
    // return { order_ref: '1XBET-ORD-xxx', placed_odds: leg.odds, placed_stake: leg.stake };
  }

  /**
   * Place a compensating hedge bet.
   * @param {import('playwright').Page} page
   * @param {import('../models/index.js').BetLeg} leg
   */
  async hedgeLeg(page, leg) {
    log.warn({ leg: { type: leg.type, book: leg.book } }, '1xBet: hedgeLeg called — placeholder');
    throw new Error('X1Adapter.hedgeLeg() not yet implemented');
  }

  /**
   * Void/cancel an existing order.
   * @param {import('playwright').Page} page
   * @param {string} orderRef
   */
  async voidLeg(page, orderRef) {
    log.warn({ orderRef }, '1xBet: voidLeg called — placeholder');
    throw new Error('X1Adapter.voidLeg() not yet implemented');
  }

  /**
   * Gọi API Get1x2_VZip để lấy danh sách các trận live.
   * Trả về mảng raw Value[] từ API, mỗi item chứa I (gameId), L (league), O1, O2, SC (score).
   *
   * @param {import('playwright').Page} page - Playwright page (dùng để lấy cookies/session)
   * @param {number} sportId - Sport ID (1=Football, v.v.)
   * @param {string} apiHost - Host của API (vd: '1xlite-044647.top')
   * @returns {Promise<Array>}
   */
  async _fetchEventListViaApi(page, sportId, apiHost) {
    // Dùng tham số lọc theo cách 1xBet frontend thực tế gọi (gr + antisports).
    // Tránh dùng sports= vì server trả 406 với cách filter đó.
    const filterParams = SPORT_FILTER_PARAMS[sportId];
    let queryString;
    if (filterParams) {
      const p = new URLSearchParams({
        count: '200',
        lng: 'vi',
        gr: filterParams.gr,
        antisports: filterParams.antisports,
        mode: '4',
        country: '43',
        virtualSports: filterParams.virtualSports ?? 'true',
        noFilterBlockEvent: 'true',
      });
      queryString = p.toString();
    } else {
      // Fallback cho các sport chưa có filterParams
      const p = new URLSearchParams({
        sports: String(sportId),
        count: '200',
        lng: 'vi',
        mode: '4',
        country: '43',
        noFilterBlockEvent: 'true',
      });
      queryString = p.toString();
    }

    const url = `https://${apiHost}/service-api/LiveFeed/Get1x2_VZip?${queryString}`;
    log.info({ url }, '1xBet API: fetching event list via Get1x2_VZip');

    const response = await page.request.get(url, {
      headers: {
        ...API_HEADERS,
        'referer': `https://${apiHost}/vi`,
      },
      timeout: 15000,
    });

    if (!response.ok()) {
      log.warn({ status: response.status(), url }, '1xBet API: Get1x2_VZip returned non-OK status');
      return [];
    }

    const json = await response.json();
    if (!json.Success || !Array.isArray(json.Value)) {
      log.warn({ errorCode: json.ErrorCode, error: json.Error }, '1xBet API: Get1x2_VZip unsuccessful response');
      return [];
    }

    log.info({ count: json.Value.length }, '1xBet API: Get1x2_VZip returned events');
    return json.Value;
  }

  /**
   * Gọi API GetGameZip để lấy chi tiết tất cả các kèo của 1 trận đấu.
   * Trả về object Value từ API, trong đó Value.GE chứa danh sách các nhóm kèo.
   *
   * @param {import('playwright').Page} page
   * @param {number} gameId - Game ID (trường I từ Get1x2_VZip)
   * @param {string} apiHost
   * @returns {Promise<object|null>}
   */
  async _fetchEventOddsViaApi(page, gameId, apiHost) {
    const params = new URLSearchParams({
      id: String(gameId),
      lng: 'vi',
      isSubGames: 'true',
      GroupEvents: 'true',
      countevents: '250',
      grMode: '4',
      topGroups: '',
      country: '43',
      marketType: '1',
      isNewBuilder: 'true',
    });
    const url = `https://${apiHost}/service-api/LiveFeed/GetGameZip?${params.toString()}`;
    log.info({ url, gameId }, '1xBet API: fetching event odds via GetGameZip');

    const response = await page.request.get(url, {
      headers: {
        ...API_HEADERS,
        'referer': `https://${apiHost}/vi/live`,
      },
      timeout: 15000,
    });

    if (!response.ok()) {
      log.warn({ status: response.status(), gameId }, '1xBet API: GetGameZip returned non-OK status');
      return null;
    }

    const json = await response.json();
    if (!json.Success || !json.Value) {
      log.warn({ errorCode: json.ErrorCode, error: json.Error, gameId }, '1xBet API: GetGameZip unsuccessful response');
      return null;
    }

    return json.Value;
  }

  /**
   * Parse danh sách kèo từ Value.GE (kết quả GetGameZip) sang cấu trúc chuẩn.
   * Lọc theo danh sách groupIds cho trước. Nếu không truyền groupIds thì lấy tất cả.
   *
   * @param {Array} ge - Mảng Value.GE từ GetGameZip
   * @param {number[]} [groupIds] - Chỉ lấy kèo thuộc các nhóm G này
   * @returns {Array<{ group: number, groupSub: number, selections: Array }>}
   */
  _parseGroupEvents(ge, groupIds = null) {
    if (!Array.isArray(ge)) return [];

    const markets = [];
    for (const group of ge) {
      const g = group.G;
      if (groupIds && !groupIds.includes(g)) continue;

      const gs = group.GS ?? null;
      const lines = [];

      for (const eventLine of (group.E || [])) {
        // Mỗi eventLine là 1 mảng các lựa chọn (selections) cho 1 dòng kèo
        const selections = eventLine.map(sel => ({
          type: sel.T,          // Selection Type ID — dùng để placeBet
          odds: sel.C,          // Hệ số ăn (coefficient)
          oddsDisplay: sel.CV ?? String(sel.C), // Chuỗi hiển thị canvas
          line: sel.P ?? null,  // Mốc kèo (handicap / over-under line)
        }));
        lines.push(selections);
      }

      markets.push({ group: g, groupSub: gs, lines });
    }
    return markets;
  }

  /**
   * Fetch full odds details for only the specified event via GetGameZip API.
   * Đồng thời điều hướng page đến màn chi tiết để chuẩn bị cho placeBet.
   *
   * @param {import('playwright').Page} page
   * @param {string} compositeEventId - Dạng "leagueId-gameId" hoặc "gameId-leagueId"
   *   (vd: "2740174-714342170" hoặc "714342170-2740174").
   *   GameId là số LỚN HƠN (eventId 1xBet luôn có 9 chữ số, leagueId có 7 chữ số).
   * @param {string} [sportType]
   * @returns {Promise<object|null>}
   */
  async getEventOdds(page, compositeEventId, sportType = SportType.FOOTBALL) {
    // Parse theo cách order-agnostic: gameId = số lớn nhất trong composite ID
    const parts = String(compositeEventId).split('-').map(Number).filter(n => !isNaN(n) && n > 0);
    const gameId = String(Math.max(...parts));
    const leagueId = parts.length >= 2 ? String(Math.min(...parts)) : null;

    log.info({ compositeEventId, gameId, leagueId }, '1xBet: getEventOdds — parsed composite eventId');

    const apiHost = this._getApiHost();

    // Tra cache để lấy đúng sport path (football/basketball/...)
    // Cache được populate từ getActiveOdds — tránh hardcode 'football'
    const cached = this._eventCache.get(compositeEventId);
    const sportPath = cached?.sportPath
      || SPORT_ID_TO_PATH[SPORT_URL_MAP[sportType]?.sportId]
      || SPORT_URL_MAP[sportType]?.path
      || 'football';

    // Xây dựng URL chi tiết trận đấu với đúng sport path
    const detailUrl = leagueId
      ? `https://${apiHost}/vi/live/${sportPath}/${leagueId}/${gameId}`
      : null;

    // Chạy đồng thời: gọi API GetGameZip + điều hướng page đến màn chi tiết
    const [rawValue] = await Promise.all([
      this._fetchEventOddsViaApi(page, gameId, apiHost),
      detailUrl
        ? page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 20000 })
            .then(() => log.info({ detailUrl }, '1xBet: getEventOdds — navigated to detail page'))
            .catch(err => log.warn({ detailUrl, err: err.message }, '1xBet: getEventOdds — page navigation failed (non-fatal)'))
        : Promise.resolve(),
    ]);

    if (!rawValue) {
      log.warn({ gameId }, '1xBet: getEventOdds — no data returned from GetGameZip');
      return null;
    }

    // Lấy tất cả nhóm kèo quan trọng (1X2, Handicap, O/U)
    const markets = this._parseGroupEvents(rawValue.GE, [
      MARKET_GROUP.G_1X2_FULLTIME,
      MARKET_GROUP.G_HANDICAP,
      MARKET_GROUP.G_TOTAL_OU,
      MARKET_GROUP.G_1ST_HALF_OU,
      MARKET_GROUP.G_BTTS,
    ]);

    const resolvedLeagueId = leagueId ?? String(rawValue.LI ?? '');
    const resolvedGameId = String(rawValue.I ?? gameId);

    return {
      eventId: resolvedLeagueId ? `${resolvedLeagueId}-${resolvedGameId}` : resolvedGameId,
      leagueId: resolvedLeagueId,
      sport: sportType,
      home: rawValue.O1 ?? 'Unknown',
      away: rawValue.O2 ?? 'Unknown',
      league: rawValue.L ?? '',
      score: rawValue.SC ?? null,
      detailUrl: resolvedLeagueId
        ? `https://${apiHost}/vi/live/${sportPath}/${resolvedLeagueId}/${resolvedGameId}`
        : null,
      markets,
      scope: 'live',
    };
  }

  /**
   * Lấy odds chi tiết theo URL sự kiện.
   * Hỗ trợ cả 2 dạng URL:
   *   - /vi/live/football/2740174-afc-league/714342170-vissel-kobe-... (có slug)
   *   - /vi/live/football/2740174/714342170 (chỉ ID)
   */
  async getEventOddsDetailByUrl(page, eventUrlPath) {
    const segments = eventUrlPath.replace(/\/$/, '').split('/').filter(Boolean);
    // Segment cuối là eventId (hoặc eventId-slug), kế tiếp là leagueId (hoặc leagueId-slug)
    const lastSeg = segments[segments.length - 1] || '';
    const prevSeg = segments[segments.length - 2] || '';

    const gameId = parseInt(lastSeg.split('-')[0], 10);
    const leagueId = parseInt(prevSeg.split('-')[0], 10);

    if (!gameId || isNaN(gameId)) {
      log.warn({ eventUrlPath }, '1xBet: getEventOddsDetailByUrl — cannot extract gameId from URL');
      return null;
    }

    // Tạo composite ID rồi delegate sang getEventOdds
    const compositeId = (!isNaN(leagueId) && leagueId) ? `${leagueId}-${gameId}` : String(gameId);
    return this.getEventOdds(page, compositeId);
  }

  /**
   * Trả về API host từ config hoặc dùng mặc định.
   * Hỗ trợ cấu hình linh hoạt qua bookkieConfig.apiHost.
   */
  _getApiHost() {
    // baseUrl dạng https://1xfun888bet.com/vi → extract hostname
    const baseUrl = this.config.baseUrl || 'https://1xfun888bet.com/vi';
    try {
      return this.config.apiHost || new URL(baseUrl).hostname;
    } catch {
      return '1xlite-044647.top';
    }
  }

  /**
   * Fetch active odds from 1xBet for the given sport via Get1x2_VZip API.
   * Không cần scrape DOM/canvas — gọi thẳng JSON API mà 1xBet frontend sử dụng.
   *
   * @param {import('playwright').Page} page
   * @param {string} [sportType=SportType.FOOTBALL]  - One of SportType values
   * @returns {Promise<import('./baseAdapter.js').ActiveOdd[]>}
   */
  async getActiveOdds(page, sportType = SportType.FOOTBALL) {
    const sport = SPORT_URL_MAP[sportType] || SPORT_URL_MAP[SportType.FOOTBALL];
    const apiHost = this._getApiHost();

    log.info({ sportType, sportId: sport.sportId, apiHost }, '1xBet: getActiveOdds — fetching via Get1x2_VZip API');

    const rawEvents = await this._fetchEventListViaApi(page, sport.sportId ?? 1, apiHost);

    const results = rawEvents.map((ev) => {
      const gameId = String(ev.I);
      const leagueId = String(ev.LI || '');
      // EventId dạng composite "leagueId-gameId" để caller dùng trực tiếp
      // khi gọi getEventOdds mà không cần truyền leagueId riêng
      const eventId = leagueId ? `${leagueId}-${gameId}` : gameId;
      // Tỷ số hiện tại nếu có
      const score = ev.SC?.FS ? { home: ev.SC.FS.S1 ?? 0, away: ev.SC.FS.S2 ?? 0 } : null;

      // Trích 3 odds 1X2 từ trường E[] (mảng { T, C })
      const selectionMap = { 1: '1', 2: 'X', 3: '2' };
      const selections = (ev.E || []).map(s => ({
        label: selectionMap[s.T] ?? `T${s.T}`,
        odds: s.C,
        type: s.T,
      })).filter(s => s.odds > 1);

      return {
        eventId,
        leagueId,
        sport: sportType,
        home: ev.O1 ?? 'Unknown',
        away: ev.O2 ?? 'Unknown',
        league: ev.L ?? '',
        marketType: '1X2',
        score,
        selections,
        scope: 'live',
        // Không có link cụ thể từ API list — dùng eventId để gọi getEventOdds sau
        eventLink: null,
      };
    }).filter(e => e.home !== 'Unknown' || e.away !== 'Unknown');

    // Lưu vào cache để getEventOdds có thể tra sport path và leagueId
    this._populateEventCache(results, sportType);

    log.info({ sportType, count: results.length }, '1xBet: getActiveOdds complete');
    return results;
  }
}
