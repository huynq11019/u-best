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
 * Map nhóm kèo G → marketType chuẩn chung.
 * Dùng để chuyển đổi raw group ID của 1xBet sang tên loại kèo dễ đọc.
 */
const MARKET_GROUP_TO_TYPE = {
  [MARKET_GROUP.G_1X2_FULLTIME]: '1X2',
  [MARKET_GROUP.G_HANDICAP]:     'AH',
  [MARKET_GROUP.G_TOTAL_OU]:     'OU',
  [MARKET_GROUP.G_BTTS]:         'BTTS',
  [MARKET_GROUP.G_1ST_HALF_OU]:  'OU_H1',
};

/**
 * Map nhóm kèo G → marketName hiển thị theo UI (tiếng Việt).
 * Tên này match với giao diện 1xBet đang hiển thị.
 */
const MARKET_GROUP_TO_NAME = {
  [MARKET_GROUP.G_1X2_FULLTIME]: 'Chung cuộc',
  [MARKET_GROUP.G_HANDICAP]:     'Chấp Châu Á',
  [MARKET_GROUP.G_TOTAL_OU]:     'Tài xỉu',
  [MARKET_GROUP.G_BTTS]:         'Cả hai đội ghi bàn',
  [MARKET_GROUP.G_1ST_HALF_OU]:  'Tài xỉu hiệp 1',
};

/**
 * Map Selection Type T → label chuẩn chung.
 * Giá trị T này vẫn được giữ lại trong selections để dùng khi placeBet.
 */
const SELECTION_TYPE_TO_LABEL = {
  // 1X2
  1: 'Home', 2: 'Draw', 3: 'Away',
  // Handicap
  7: 'Home', 8: 'Away',
  // O/U
  9: 'Over', 10: 'Under',
  // BTTS
  180: 'Yes', 181: 'No',
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
 * Map string selection labels (from webhook BetLeg.type) → T number (1xBet API).
 * Webhook gửi type: "Over"|"Under", adapter cần T: 9|10.
 */
const STRING_TYPE_TO_T = {
  'Over': SELECTION_TYPE.OVER,        // 9
  'Under': SELECTION_TYPE.UNDER,      // 10
  'Home': SELECTION_TYPE.HOME,        // 1
  'Draw': SELECTION_TYPE.DRAW,        // 2
  'Away': SELECTION_TYPE.AWAY,        // 3
  'Yes': 180,                         // BTTS Yes
  'No': 181,                          // BTTS No
  '1': SELECTION_TYPE.HOME,           // 1X2 shorthand
  'X': SELECTION_TYPE.DRAW,
  '2': SELECTION_TYPE.AWAY,
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
   * Trích xuất x-hd (session signature) từ cookies hoặc localStorage của page.
   * x-hd là chuỗi Base64 được sinh bởi JS phía client — thường được lưu trong
   * cookie `hd` hoặc localStorage key `hd` / `x-hd`.
   *
   * @param {import('playwright').Page} page
   * @returns {Promise<string>}
   */
  async _extractXhd(page) {
    // Thử lấy từ cookie trước
    const cookies = await page.context().cookies();
    const hdCookie = cookies.find(c => c.name === 'hd' || c.name === 'x-hd');
    if (hdCookie?.value) {
      log.debug('1xBet: x-hd extracted from cookie');
      return hdCookie.value;
    }

    // Fallback: lấy từ localStorage
    const hdLocal = await page.evaluate(() => {
      return localStorage.getItem('hd') || localStorage.getItem('x-hd') || '';
    }).catch(() => '');
    if (hdLocal) {
      log.debug('1xBet: x-hd extracted from localStorage');
      return hdLocal;
    }

    // Fallback cuối: lấy từ sessionStorage
    const hdSession = await page.evaluate(() => {
      return sessionStorage.getItem('hd') || sessionStorage.getItem('x-hd') || '';
    }).catch(() => '');
    if (hdSession) {
      log.debug('1xBet: x-hd extracted from sessionStorage');
      return hdSession;
    }

    log.warn('1xBet: x-hd not found — request may be rejected with 403');
    return '';
  }

  /**
   * Trích xuất JWT access token (x-auth) từ cookie `user_token` hoặc `access_token`.
   * Token này có TTL ngắn (~15 phút) — cần refresh nếu hết hạn.
   *
   * @param {import('playwright').Page} page
   * @returns {Promise<string>} JWT string (không có prefix "Bearer ")
   */
  async _extractJwtToken(page) {
    const cookies = await page.context().cookies();

    // Thứ tự ưu tiên: user_token → access_token → token
    const tokenCookie = cookies.find(c =>
      c.name === 'user_token' ||
      c.name === 'access_token' ||
      c.name === 'token'
    );
    if (tokenCookie?.value) {
      log.debug({ cookieName: tokenCookie.name }, '1xBet: JWT extracted from cookie');
      return tokenCookie.value;
    }

    // Fallback: localStorage
    const jwtLocal = await page.evaluate(() => {
      return (
        localStorage.getItem('user_token') ||
        localStorage.getItem('access_token') ||
        localStorage.getItem('token') ||
        ''
      );
    }).catch(() => '');
    if (jwtLocal) {
      log.debug('1xBet: JWT extracted from localStorage');
      return jwtLocal;
    }

    log.warn('1xBet: JWT (x-auth) not found — MakeBetWeb will likely fail with 403');
    return '';
  }

  /**
   * Trích xuất auid cookie cho MakeBetWeb.
   * Cookie này cần thiết để xác thực request đặt cược.
   *
   * @param {import('playwright').Page} page
   * @returns {Promise<string>}
   */
  async _extractAuid(page) {
    const cookies = await page.context().cookies();
    const auidCookie = cookies.find(c => c.name === 'auid');
    if (auidCookie?.value) {
      log.debug('1xBet: auid extracted from cookie');
      return auidCookie.value;
    }
    log.warn('1xBet: auid cookie not found — MakeBetWeb may fail with 160');
    return '';
  }

  /**
   * Lấy UserId từ cookie hoặc localStorage sau khi đăng nhập.
   *
   * @param {import('playwright').Page} page
   * @param {string} [jwt] - Optional JWT token đã extract (để tránh gọi lại)
   * @returns {Promise<number>}
   */
  async _extractUserId(page, jwt) {
    // Ưu tiên 1: Extract từ JWT token payload (chuẩn xác nhất)
    const jwtToken = jwt || await this._extractJwtToken(page);
    if (jwtToken) {
      try {
        // JWT format: header.payload.signature
        const payload = JSON.parse(Buffer.from(jwtToken.split('.')[1], 'base64url').toString());
        // sub format: "50/1633454933" → lấy phần sau /
        const sub = payload.sub || '';
        const match = sub.match(/\/(\d+)$/);
        if (match) {
          const userIdFromJwt = Number(match[1]);
          log.info({ userId: userIdFromJwt, sub }, '1xBet: UserId extracted from JWT sub');
          return userIdFromJwt;
        }
      } catch (e) {
        log.debug('1xBet: failed to parse JWT payload for userId');
      }
    }

    // Ưu tiên 2: Từ config (nếu đã được set từ bên ngoài)
    if (this.config.userId && Number.isFinite(Number(this.config.userId))) {
      return Number(this.config.userId);
    }

    // Ưu tiên 3: Từ cookies
    const cookies = await page.context().cookies();
    const userIdCookie = cookies.find(c =>
      c.name === 'userId' ||
      c.name === 'user_id' ||
      c.name === 'uid'
    );
    if (userIdCookie?.value && !isNaN(Number(userIdCookie.value))) {
      return Number(userIdCookie.value);
    }

    // Fallback: localStorage / window object
    const userId = await page.evaluate(() => {
      const fromStorage =
        localStorage.getItem('userId') ||
        localStorage.getItem('user_id') ||
        localStorage.getItem('uid');
      if (fromStorage && !isNaN(Number(fromStorage))) return Number(fromStorage);

      const winUser = window.__USER__ || window.user || window.currentUser;
      if (winUser?.id) return Number(winUser.id);
      if (winUser?.userId) return Number(winUser.userId);

      return 0;
    }).catch(() => 0);

    if (!userId) {
      log.warn('1xBet: UserId not found — using 0 (bet may fail)');
    }
    return userId;
  }

  /**
   * Map BetLeg sang cấu trúc Events[] cho MakeBetWeb.
   * leg phải chứa các trường:
   *   - leg.gameId    {number}  — ID trận đấu (trường I từ GetGameZip)
   *   - leg.type      {number}  — Selection Type T (từ GetGameZip E[][].T)
   *   - leg.odds      {number}  — Hệ số ăn (C từ GetGameZip)
   *   - leg.line      {number}  — Mốc kèo (P từ GetGameZip, 0 nếu không có)
   *   - leg.kind      {number}  — Kind (1=Over/Home/Yes, 2=Under/Away/No), mặc định 1
   *
   * @param {import('../models/index.js').BetLeg} leg
   * @returns {object}
   */
  _buildEventPayload(leg) {
    // Resolve type: selectionType override → string label → raw number
    const rawType = leg.selectionType ?? leg.type;
    const resolvedType = typeof rawType === 'string'
      ? (STRING_TYPE_TO_T[rawType] ?? Number(rawType))
      : Number(rawType);

    if (!resolvedType || isNaN(resolvedType)) {
      throw new Error(`1xBet _buildEventPayload: cannot resolve type "${rawType}" to a valid T number`);
    }

    return {
      GameId: Number(leg.gameId),
      Type: resolvedType,
      Coef: Number(leg.odds),
      Param: leg.line != null ? Number(leg.line) : 0,
      PV: null,
      PlayerId: 0,
      Kind: leg.kind != null ? Number(leg.kind) : 1,
      InstrumentId: 0,
      Seconds: 0,
      Price: 0,
      Expired: 0,
      PlayersDuel: [],
    };
  }

  /**
   * Place a bet via MakeBetWeb API (API 4.7).
   * Đây là API đặt cược hoàn tất trong một bước — trừ tiền ngay lập tức.
   * Dùng cho chế độ One-Click Bet / Auto Bet.
   *
   * Yêu cầu leg phải có các trường:
   *   - leg.gameId    {number}  — ID trận đấu
   *   - leg.type      {number}  — Selection Type T (từ GetGameZip)
   *   - leg.odds      {number}  — Hệ số ăn tại thời điểm đặt
   *   - leg.stake     {number}  — Số tiền đặt (VND)
   *   - leg.line      {number}  [optional] — Mốc kèo (handicap/OU line)
   *   - leg.kind      {number}  [optional] — 1=Over/Home, 2=Under/Away (mặc định 1)
   *   - leg.leagueId  {string}  [optional] — League ID để build Referer URL
   *   - leg.home      {string}  [optional] — Tên đội nhà để build Referer URL
   *   - leg.away      {string}  [optional] — Tên đội khách để build Referer URL
   *   - leg.sportPath {string}  [optional] — Sport path (mặc định 'football')
   *
   * @param {import('playwright').Page} page
   * @param {import('../models/index.js').BetLeg} leg
   * @returns {Promise<{ order_ref: string, placed_odds: number, placed_stake: number, balance_after: number }>}
   */
  async placeBet(page, leg) {
    log.info(
      { gameId: leg.gameId, type: leg.type, odds: leg.odds, stake: leg.stake, line: leg.line },
      '1xBet: placeBet via MakeBetWeb API'
    );

    // --- Validate bắt buộc ---
    if (!leg.gameId) throw new Error('1xBet placeBet: leg.gameId is required');
    const effectiveType = leg.selectionType ?? leg.type;
    if (!effectiveType && effectiveType !== 0) throw new Error('1xBet placeBet: leg.type or leg.selectionType is required (number T or string like "Over"/"Under")');
    if (!leg.odds || leg.odds <= 1) throw new Error('1xBet placeBet: leg.odds must be > 1');
    if (!leg.stake || leg.stake <= 0) throw new Error('1xBet placeBet: leg.stake must be > 0');

    const apiHost = this._getApiHost();

    // --- Build Referer URL ---
    const sportPath = leg.sportPath || 'football';
    const leagueId = leg.leagueId || '';
    const gameId = String(leg.gameId);
    const home = (leg.home || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const away = (leg.away || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const referer = leagueId
      ? `https://${apiHost}/vi/live/${sportPath}/${leagueId}/${gameId}${home && away ? `-${home}-${away}` : ''}`
      : `https://${apiHost}/vi/live/${sportPath}`;

    // --- Navigate to detail page to generate x-hd ---
    log.info({ referer }, '1xBet: placeBet — navigating to event detail page for x-hd');
    await page.goto(referer, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000); // Wait for JS to generate x-hd

    // --- Lấy credentials từ page session ---
    const jwt = await this._extractJwtToken(page);
    if (!jwt) {
      throw new Error('1xBet placeBet: JWT token (x-auth) not found — cannot place bet');
    }

    const [xhd, userId, auid] = await Promise.all([
      this._extractXhd(page),
      this._extractUserId(page, jwt),  // Pass jwt để tránh extract lại
      this._extractAuid(page),
    ]);

    log.info({ userId, gameId, auid: auid || '(empty)', hasXhd: !!xhd }, '1xBet: placeBet credentials extracted');

    if (!auid) {
      log.warn('1xBet placeBet: auid cookie missing — MakeBetWeb may fail with error 160');
    }

    // --- Build request body theo spec 4.7 ---
    const requestBody = {
      UserId: userId,
      Events: [this._buildEventPayload(leg)],
      Vid: 0,
      partner: 1,
      Group: 819,                  // Bóng đá live
      live: true,
      CheckCf: 2,                  // Chấp nhận mọi thay đổi odds — tránh reject khi odds nhảy nhẹ
      Lng: 'vi',
      notWait: true,               // Fast bet — không chờ confirm
      promo: null,
      IsPowerBet: false,
      Summ: Number(leg.stake),     // Số tiền đặt (VND)
      isAutoBet: true,
      autoBetCf: 0,                // Không giới hạn odds tối thiểu
      TransformEventKind: true,    // Server tự chuyển Kind theo logic nội bộ
      autoBetCfView: 0,
      Source: 55,                  // One-Click Bet từ web
      OneClickBet: 2,              // Kích hoạt đặt cược 1 click
    };

    const url = `https://${apiHost}/service-api/LiveBet/Secure/MakeBetWeb`;

    // Build full request headers for logging
    const requestHeaders = {
      ...API_HEADERS,
      'origin': `https://${apiHost}`,
      'referer': referer,
      'x-hd': xhd,
      'x-auth': `Bearer ${jwt}`,
      'is-srv': 'false',
      'x-mobile-project-id': '0',
    };

    // --- Build cookies array ---
    const requestCookies = [];
    if (auid) {
      requestCookies.push({ name: 'auid', value: auid, domain: apiHost, path: '/' });
    }

    // --- Polling loop: 1xBet xử lý bet async, dùng betGUID để poll kết quả ---
    const MAX_POLLS = 10;
    let betGUID = null;
    let value = null;

    for (let attempt = 1; attempt <= MAX_POLLS; attempt++) {
      const body = betGUID ? { ...requestBody, betGUID } : requestBody;

      log.info({
        url, userId, gameId,
        type: leg.type, odds: leg.odds, stake: leg.stake,
        attempt, betGUID,
        body,
      }, '1xBet: calling MakeBetWeb');

      const response = await page.request.post(url, {
        headers: requestHeaders,
        data: body,
        timeout: 20000,
        cookies: requestCookies.length > 0 ? requestCookies : undefined,
      });

      // --- Xử lý HTTP error ---
      if (!response.ok()) {
        const statusCode = response.status();
        const respBody = await response.text().catch(() => '');
        log.error({ statusCode, body: respBody.slice(0, 500) }, '1xBet: MakeBetWeb HTTP error');
        throw new Error(`1xBet MakeBetWeb failed with HTTP ${statusCode}: ${respBody.slice(0, 200)}`);
      }

      const json = await response.json();
      log.info({ attempt, betGUID, json }, '1xBet: MakeBetWeb response');

      // --- Xử lý API error ---
      if (!json.Success || json.ErrorCode !== 0) {
        const errMsg = json.Error || `ErrorCode ${json.ErrorCode}`;
        log.error({ errorCode: json.ErrorCode, error: json.Error, fullResponse: json }, '1xBet: MakeBetWeb API error');
        throw new Error(`1xBet MakeBetWeb API error: ${errMsg}`);
      }

      value = json.Value;
      const waitTime = value?.waitTime ?? 0;

      // Bet confirmed — Id != 0 và waitTime == 0
      if (value?.Id && value.Id !== 0) {
        log.info({ betId: value.Id, attempt }, '1xBet: MakeBetWeb — bet confirmed');
        break;
      }

      // Còn đang xử lý — update betGUID và chờ
      if (waitTime > 0 && value?.betGUID) {
        betGUID = value.betGUID;
        log.info({ attempt, waitTime, nextBetGUID: betGUID }, '1xBet: MakeBetWeb — pending, polling...');
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }

      // waitTime == 0 nhưng Id == 0 → lỗi không rõ
      log.error({ value }, '1xBet: MakeBetWeb returned no bet ID after polling');
      throw new Error('1xBet MakeBetWeb: no bet ID in final response');
    }

    if (!value?.Id) {
      throw new Error(`1xBet MakeBetWeb: exceeded ${MAX_POLLS} polls without confirmation`);
    }

    // --- Log cảnh báo nếu odds/line bị trượt (chỉ sau khi bet confirmed) ---
    if (value.lvC) {
      log.warn(
        { betId: value.Id, requestedOdds: leg.odds, confirmedOdds: value.Coupon?.Coef },
        '1xBet: MakeBetWeb — odds changed (lvC=true), actual profit may differ'
      );
    }
    if (value.lnC) {
      log.warn({ betId: value.Id }, '1xBet: MakeBetWeb — line changed (lnC=true)');
    }

    // --- Parse timestamp Dt (Microsoft JSON Date format) ---
    let placedAt = null;
    if (value.Dt) {
      const ms = parseInt(value.Dt.replace('/Date(', '').replace(')/', ''), 10);
      if (!isNaN(ms)) placedAt = new Date(ms).toISOString();
    }

    const confirmedOdds = value.Coupon?.Coef ?? leg.odds;
    const confirmedStake = value.Coupon?.Summ ?? leg.stake;
    const balanceAfter = value.Balance ?? null;

    log.info(
      { betId: value.Id, confirmedOdds, confirmedStake, balanceAfter, placedAt },
      '1xBet: MakeBetWeb — bet placed successfully'
    );

    return {
      order_ref: String(value.Id),
      placed_odds: confirmedOdds,
      placed_stake: confirmedStake,
      balance_after: balanceAfter,
      placed_at: placedAt,
      odds_changed: value.lvC ?? false,
      line_changed: value.lnC ?? false,
    };
  }

  /**
   * Place bet by selection ID from cached odds data.
   * This is the new simplified API - just need eventId, selectionId, and stake.
   * All other data (odds, line, type) is looked up from cache populated by getEventOdds().
   *
   * @param {import('playwright').Page} page
   * @param {object} params
   * @param {string} params.eventId - Event ID (same as used with getEventOdds)
   * @param {string} params.selectionId - Selection ID from cached odds (e.g., "2740174-714342170_OU_line_0")
   * @param {number} params.stake - Bet amount
   * @param {number} [params.expectedOdds] - Optional: validate odds hasn't drifted beyond threshold
   * @param {number} [params.oddsDriftThreshold=0.05] - Acceptable odds change (5% default)
   * @returns {Promise<{ order_ref: string, placed_odds: number, placed_stake: number, balance_after: number, odds_changed: boolean }>}
   */
  async placeBetBySelection(page, { eventId, selectionId, stake, expectedOdds, oddsDriftThreshold = 0.05 }) {
    log.info({ eventId, selectionId, stake }, '1xBet: placeBetBySelection — looking up cached data');

    // 1. Lookup from cache
    const cachedEvent = this._oddsCache.get(eventId);
    if (!cachedEvent) {
      throw new Error(`1xBet placeBetBySelection: no cached odds for event ${eventId}. Call getEventOdds first.`);
    }

    // 2. Find selection by ID
    const selection = this._oddsCache.findSelection(cachedEvent, selectionId);
    if (!selection) {
      throw new Error(`1xBet placeBetBySelection: selection ${selectionId} not found in cached data for event ${eventId}`);
    }

    // 3. Build leg data from cached selection
    const { marketType, hasLines } = selection;

    // Extract gameId and leagueId from eventId
    const parts = String(eventId).split('-').map(Number).filter(n => !isNaN(n) && n > 0);
    const gameId = String(Math.max(...parts));
    const leagueId = parts.length >= 2 ? String(Math.min(...parts)) : cachedEvent.leagueId || '';

    // Determine selection type and line from cached data
    let selectionType, line, kind;

    if (hasLines) {
      // For OU/AH: lines have selectionA, oddsA, selectionB, oddsB, line
      line = selection.line;
      // Determine which side of the line
      const isSideA = selectionId.endsWith('_0') || selection.selection === selection.selectionA;
      kind = isSideA ? 1 : 2;
      // Map to x1 selection type
      if (marketType === 'OU') {
        selectionType = isSideA ? SELECTION_TYPE.OVER : SELECTION_TYPE.UNDER; // 9 or 10
      } else if (marketType === 'AH') {
        selectionType = isSideA ? SELECTION_TYPE.HANDICAP_TEAM1 : SELECTION_TYPE.HANDICAP_TEAM2; // 7 or 8
      }
    } else {
      // For 1X2: options have selection, odds
      line = selection.line || 0;
      const label = selection.selection;
      selectionType = STRING_TYPE_TO_T[label]; // 1, 2, or 3
      kind = 1; // Kind always 1 for 1X2
    }

    // Get current odds
    const currentOdds = hasLines
      ? (kind === 1 ? selection.oddsA : selection.oddsB)
      : selection.odds;

    // 4. Validate odds if expectedOdds provided
    if (expectedOdds !== undefined) {
      const drift = Math.abs(currentOdds - expectedOdds) / expectedOdds;
      if (drift > oddsDriftThreshold) {
        throw new Error(`1xBet placeBetBySelection: odds drifted too much. Expected ${expectedOdds}, got ${currentOdds} (drift ${(drift * 100).toFixed(1)}% > threshold ${(oddsDriftThreshold * 100).toFixed(1)}%)`);
      }
    }

    log.info({
      eventId, selectionId, gameId, leagueId,
      marketType, selectionType, line, kind,
      currentOdds, stake
    }, '1xBet: placeBetBySelection — resolved from cache, delegating to placeBet');

    // 5. Build leg and delegate to existing placeBet
    const leg = {
      gameId,
      leagueId,
      type: selectionType,
      selectionType,
      odds: currentOdds,
      stake,
      line,
      kind,
      home: cachedEvent.home,
      away: cachedEvent.away,
      sportPath: this._extractSportPath(cachedEvent.sport),
    };

    return this.placeBet(page, leg);
  }

  /**
   * Extract sport path for URL building from sport type.
   * @private
   */
  _extractSportPath(sportType) {
    return SPORT_URL_MAP[sportType]?.path || 'football';
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
   * Parse danh sách kèo từ Value.GE (kết quả GetGameZip) sang cấu trúc chuẩn chung.
   *
   * Cấu trúc thực tế của GetGameZip:
   *   - 1X2 (G:1):  E = [[{T:1}], [{T:2}], [{T:3}]]
   *                 → 3 eventLines riêng biệt
   *
   *   - OU  (G:17): E = [[{T:9,P:2.5},{T:9,P:3},...], [{T:10,P:2.5},{T:10,P:3},...]]
   *                 → 2 eventLines (Over / Under), mỗi cái nhiều line P
   *
   *   - AH  (G:2):  E = [[{T:7,P:1.5},...,{T:8,P:-1.5},...]]
   *                 → 1 eventLine, T:7=Home T:8=Away, P âm/dương đối nhau
   *
   *   - BTTS (G:19): E = [[{T:180}], [{T:181}]]
   *
   * Trả về grouped markets: mỗi market chứa marketType, marketName và options/lines phù hợp.
   * - Markets không có line (1X2, BTTS): options array với odds/kind
   * - Markets có nhiều lines (OU, AH): lines array với line, oddsA, oddsB, kindA, kindB
   *
   * @param {Array} ge - Mảng Value.GE từ GetGameZip
   * @param {number[]} [groupIds] - Chỉ lấy kèo thuộc các nhóm G này; null = lấy tất cả
   * @returns {Array<{
   *   marketType: string,
   *   marketName: string,
   *   hasLines: boolean,
   *   options?: Array<{ selection: string, odds: number, kind: number }>,
   *   lines?: Array<{ line: number, selectionA: string, oddsA: number, kindA: number, selectionB: string, oddsB: number, kindB: number }>
   * }>}
   */
  _parseGroupEvents(ge, groupIds = null) {
    if (!Array.isArray(ge)) return [];

    const markets = [];

    for (const group of ge) {
      const g = group.G;
      if (groupIds && !groupIds.includes(g)) continue;

      const marketType = MARKET_GROUP_TO_TYPE[g] ?? `GROUP_${g}`;
      const marketName = MARKET_GROUP_TO_NAME[g] ?? marketType;

      // Flatten tất cả selections
      const allSelections = (group.E || []).flat().map(sel => ({
        selection: SELECTION_TYPE_TO_LABEL[sel.T] ?? `T${sel.T}`,
        odds: sel.C,
        line: sel.P ?? null,
        kind: sel.T,
      })).filter(s => s.odds > 1);

      if (allSelections.length === 0) continue;

      // Kiểm tra có line không
      const hasLines = allSelections.some(s => s.line !== null);

      if (!hasLines) {
        // 1X2, BTTS: flat options array
        markets.push({
          marketType,
          marketName,
          hasLines: false,
          options: allSelections.map(s => ({
            selection: s.selection,
            odds: s.odds,
            kind: s.kind,
          })),
        });
      } else {
        // OU, AH: group theo |line| để ghép cặp Over/Under hoặc Home/Away
        const lineMap = new Map();
        for (const sel of allSelections) {
          const lineKey = Math.abs(sel.line ?? 0);
          if (!lineMap.has(lineKey)) lineMap.set(lineKey, []);
          lineMap.get(lineKey).push(sel);
        }

        const lines = [];
        for (const [, pairSelections] of lineMap) {
          if (pairSelections.length < 2) continue;
          // Sắp xếp: selection đầu là Over/Home, selection sau là Under/Away
          const sorted = pairSelections.sort((a, b) => a.kind - b.kind);
          lines.push({
            line: sorted[0]?.line ?? null,
            selectionA: sorted[0]?.selection ?? '',
            oddsA: sorted[0]?.odds ?? 0,
            kindA: sorted[0]?.kind ?? 0,
            selectionB: sorted[1]?.selection ?? '',
            oddsB: sorted[1]?.odds ?? 0,
            kindB: sorted[1]?.kind ?? 0,
          });
        }

        if (lines.length > 0) {
          markets.push({
            marketType,
            marketName,
            hasLines: true,
            lines: lines.sort((a, b) => a.line - b.line),
          });
        }
      }
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

    const eventData = {
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

    // Cache với enriched IDs để placeBet có thể reference by ID
    const enriched = this._oddsCache.set(eventData.eventId, eventData);
    log.info({ eventId: eventData.eventId, marketCount: markets.length }, '1xBet: getEventOdds — cached with enriched IDs');

    return enriched;
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
