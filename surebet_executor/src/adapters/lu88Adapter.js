// Lu88 bookmaker adapter
// Login flow: POST /gw/api/v2/auth/login → JWT cookie → GET /gw/api/v2/game/url → SportV odds URL
import { BaseAdapter, SportType } from './baseAdapter.js';
import { childLogger } from '../config/logger.js';

const log = childLogger({ component: 'lu88Adapter' });

const BASE_URL = 'https://lu88.moe';

/**
 * API endpoints
 */
const API = {
  login: `${BASE_URL}/gw/api/v2/auth/login`,
  gameUrl: `${BASE_URL}/gw/api/v2/game/url`,
  userInfo: `${BASE_URL}/gw/api/v2/user/info`,
};

/**
 * CSS selectors for UI detection.
 *
 * Đăng nhập modal structure:
 *   - Login trigger button: button.bg-pri-main (yellow button in header)
 *   - Username input: #username-login-input
 *   - Password input: #password-login-input
 *   - Submit button: button.bg-pri-main inside modal (text "Đăng nhập")
 *   - Success indicator: header shows logged-in username
 */
const SELECTORS = {
  // Login trigger in the top-right header area (yellow "Đăng nhập" button)
  loginTrigger: [
    "//button[text()='Đăng nhập']"
  ],

  // Login form fields (inside the modal)
  usernameInput: '#username-login-input',
  passwordInput: '#password-login-input',

  // Submit button inside the modal
  submitButton: [
    '.modal button[type="submit"]',
    '[class*="modal"] button.bg-pri-main',
    '[class*="modal"] button:has-text("Đăng nhập")',
    'form button[type="submit"]',
  ],

  // Indicators that user is already logged in
  loggedInIndicators: [
    // Header shows username after login (e.g. "mikamika")
    '[class*="header"] [class*="username"]',
    '[class*="header"] [class*="user-name"]',
    '[class*="header-account"]',
    '[class*="balance"]',
    // Deposit/withdrawal buttons visible for logged-in users
    'button:has-text("Nạp tiền")',
    'a:has-text("Nạp tiền")',
    // Avatar or profile area
    '[class*="avatar"]',
    '[class*="user-avatar"]',
  ],

  // Error messages in the login modal
  errorMessages: [
    '[class*="error"]:visible',
    '[class*="alert"]:visible',
    '.text-red:visible',
    '[class*="text-danger"]:visible',
  ],
};

/**
 * Error hint strings that indicate login failure.
 */
const LOGIN_ERROR_HINTS = [
  'sai tên người dùng',
  'sai mật khẩu',
  'tài khoản không tồn tại',
  'incorrect',
  'invalid',
  'wrong',
  'không đúng',
  'lỗi',
];

/**
 * SportV game URL query params for getting the odds page.
 * partner_provider=sportv gives access to the live sports odds listing.
 */
const SPORTV_GAME_URL_PARAMS = {
  partner_provider: 'sportv',
  partner_game_type: '',
  home: 'https://lu88.moe?ref_domain=false',
  device: 'pc',
};

/**
 * Lu88 bookmaker adapter.
 *
 * ## Login flow
 * 1. Navigate to https://lu88.moe
 * 2. Check if already logged in via cookie/session
 * 3. If not logged in → click the yellow "Đăng nhập" header button
 * 4. Fill in #username-login-input and #password-login-input
 * 5. Click submit → POST /gw/api/v2/auth/login
 * 6. Verify login succeeded (header updates to show username)
 *
 * ## Odds flow (warmUp)
 * 1. Call GET /gw/api/v2/game/url?partner_provider=sportv&... 
 * 2. Response: { status: "OK", data: "https://c0z0ob.bps6mxnb.com/..." }
 * 3. Navigate to that URL in the page to access the SportV odds listing
 */
export default class Lu88Adapter extends BaseAdapter {
  constructor(bookmakerKey, bookkieConfig) {
    super(bookmakerKey, bookkieConfig);
    this._sportvGameUrl = null; // cached SportV iframe URL after warmUp
  }

  // ────────────────────────────────────────────────────────────────────────────
  // login
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Log in to Lu88 and establish an authenticated session.
   * @param {import('playwright').Page} page
   */
  async login(page) {
    log.info('Lu88: navigating to home page');
    const baseUrl = this.config.baseUrl || BASE_URL;

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Let React/SPA finish rendering (2s is typical for this site)
    await page.waitForTimeout(2000);

    // ── Check if already authenticated ──
    if (await this._checkIsLoggedIn(page)) {
      log.info('Lu88: already logged in — skipping authentication');
      this._isLoggedIn = true;
      return;
    }

    // ── Open login modal ──
    log.info('Lu88: opening login modal');
    const triggerSelector = await this._findVisibleSelector(page, SELECTORS.loginTrigger, 8000);

    if (!triggerSelector) {
      await this._saveErrorScreenshot(page, 'login_trigger_missing');
      throw new Error('Lu88: login trigger button not found in header.');
    }

    await page.click(triggerSelector);
    log.info('Lu88: login modal opened');

    // Wait for the login form to appear
    await page.waitForSelector(SELECTORS.usernameInput, { state: 'visible', timeout: 8000 }).catch(() => null);

    // ── Fill credentials ──
    log.info('Lu88: filling in credentials');
    const usernameVisible = await page.locator(SELECTORS.usernameInput).isVisible().catch(() => false);

    if (!usernameVisible) {
      await this._saveErrorScreenshot(page, 'login_inputs_missing');
      throw new Error('Lu88: login form inputs not visible after opening modal.');
    }

    const usernameInput = page.locator(SELECTORS.usernameInput).first();
    const passwordInput = page.locator(SELECTORS.passwordInput).first();

    await usernameInput.click({ delay: 50 });
    await usernameInput.fill('');
    await usernameInput.pressSequentially(this.config.username || '', { delay: 80 });

    await passwordInput.click({ delay: 50 });
    await passwordInput.fill('');
    await passwordInput.pressSequentially(this.config.password || '', { delay: 80 });

    await page.waitForTimeout(300);
    await this._saveErrorScreenshot(page, 'before_submit');
    log.info('Lu88: submitting login form');

    // ── Submit ──
    const submitSelector = await this._findVisibleSelector(page, SELECTORS.submitButton, 5000);
    if (submitSelector) {
      await page.click(submitSelector);
    } else {
      // Fallback: press Enter
      await passwordInput.press('Enter');
    }

    // ── Wait for outcome ──
    log.info('Lu88: waiting for login outcome');
    const outcome = await this._waitForLoginOutcome(page, 30000);

    if (outcome.status === 'error') {
      log.error({ message: outcome.message }, 'Lu88: login failed');
      throw new Error(`Lu88: login failed — ${outcome.message || 'Unknown error'}`);
    }

    if (outcome.status === 'timeout') {
      await this._saveErrorScreenshot(page, 'login_timeout');
      throw new Error('Lu88: login timed out waiting for success indicator');
    }

    log.info('Lu88: login successful');
    this._isLoggedIn = true;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // warmUp
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * After login, call the game URL API to obtain the SportV odds page URL
   * and navigate to it so the page is primed for odds scraping.
   * @param {import('playwright').Page} page
   */
  async warmUp(page) {
    log.info('Lu88: warming up — fetching SportV game URL');

    // If we are on the SportV domain already, navigate back to Lu88 first
    // so the fetch to /gw/api/v2/game/url won't fail due to CORS.
    const currentUrl = page.url();
    const isOnSportV = currentUrl.includes('bpjp45ee.com') || currentUrl.includes('bps6mxnb.com');
    if (isOnSportV) {
      log.info('Lu88: on SportV domain — navigating back to Lu88 to fetch game URL');
      const baseUrl = this.config.baseUrl || BASE_URL;
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(1500);
    }

    const qs = new URLSearchParams(SPORTV_GAME_URL_PARAMS).toString();
    const apiUrl = `${API.gameUrl}?${qs}`;

    // Use page.evaluate so the request carries the session cookies automatically
    let result;
    try {
      result = await page.evaluate(async (url) => {
        const resp = await fetch(url, {
          credentials: 'include',
          headers: { 'Accept': 'application/json' },
        });
        return { status: resp.status, body: await resp.text() };
      }, apiUrl);
    } catch (err) {
      log.warn({ err: err.message }, 'Lu88: warmUp fetch failed — trying direct navigation');
      result = { status: 0, body: '' };
    }

    log.info({ status: result.status }, 'Lu88: game URL API response');

    let sportvUrl = null;
    if (result.status === 200) {
      try {
        const parsed = JSON.parse(result.body);
        if (parsed.status === 'OK' && parsed.data) {
          sportvUrl = parsed.data;
          this._sportvGameUrl = sportvUrl;
          log.info({ sportvUrl }, 'Lu88: SportV game URL obtained');
        } else {
          log.warn({ parsed }, 'Lu88: unexpected game URL API response format');
        }
      } catch (err) {
        log.warn({ err: err.message, body: result.body }, 'Lu88: failed to parse game URL response');
      }
    } else {
      log.warn({ result }, 'Lu88: game URL API returned non-200');
    }

    if (sportvUrl) {
      log.info('Lu88: navigating to SportV odds page');
      await page.goto(sportvUrl, { waitUntil: 'commit', timeout: 60000 });
      await page.waitForTimeout(5000); // let SportV SPA fully load odds
      log.info('Lu88: warm-up complete — on SportV odds page');
    } else if (this._sportvGameUrl) {
      // Use cached URL from a previous warmUp if API call failed
      log.info({ url: this._sportvGameUrl }, 'Lu88: using cached SportV URL');
      await page.goto(this._sportvGameUrl, { waitUntil: 'commit', timeout: 60000 });
      await page.waitForTimeout(5000);
      log.info('Lu88: warm-up complete (from cache) — on SportV odds page');
    } else {
      log.warn('Lu88: could not obtain SportV URL — warm-up incomplete');
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // getActiveOdds  (stub — extend for actual odds scraping from SportV iframe)
  // ────────────────────────────────────────────────────────────────────────────

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

    // Check if we are currently on the SportV domain
    const currentUrl = page.url();
    const isOnSportV = currentUrl.includes('bpjp45ee.com')
      || currentUrl.includes('bps6mxnb.com')
      || (this._sportvGameUrl && currentUrl.startsWith(new URL(this._sportvGameUrl).origin));

    if (!isOnSportV) {
      log.info('Lu88: not on SportV page, navigating via warmUp');
      await this.warmUp(page);
    }

    // TODO: Implement actual odds scraping from SportV page.
    // The SportV page at https://c0z0ob.bps6mxnb.com/Newindex?... lists live sports odds.
    // Scraping will likely require:
    //   1. Waiting for the odds table to render
    //   2. Selecting football events
    //   3. Parsing home/away/league and OU or 1X2 markets
    log.warn('Lu88: getActiveOdds scraping not yet implemented — returning empty array');
    return [];
  }

  // ────────────────────────────────────────────────────────────────────────────
  // placeBet / hedgeLeg / voidLeg  (stubs)
  // ────────────────────────────────────────────────────────────────────────────

  async placeBet(page, leg) {
    throw new Error('Lu88Adapter.placeBet() not yet implemented');
  }

  async hedgeLeg(page, leg) {
    throw new Error('Lu88Adapter.hedgeLeg() not yet implemented');
  }

  async voidLeg(page, orderRef) {
    throw new Error('Lu88Adapter.voidLeg() not yet implemented');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Detect whether the current page shows a logged-in state.
   * Lu88 shows the username in the header and a "Nạp tiền" (deposit) button.
   * @param {import('playwright').Page} page
   * @returns {Promise<boolean>}
   */
  async _checkIsLoggedIn(page) {
    for (const selector of SELECTORS.loggedInIndicators) {
      try {
        const visible = await page.locator(selector).first().isVisible({ timeout: 1500 });
        if (visible) {
          log.debug({ selector }, 'Lu88: logged-in selector matched');
          return true;
        }
      } catch (_) { }
    }

    // Secondary check: the login trigger button should NOT be visible when logged in
    const loginBtnVisible = await page.locator('button:has-text("Đăng nhập")').first().isVisible({ timeout: 1000 }).catch(() => false);
    if (!loginBtnVisible) {
      // If we can't see the login button and we're past homepage load, likely logged in
      const url = page.url();
      if (url.includes('lu88.moe')) {
        // Check if there's any account-related text in header
        const headerText = await page.locator('header').innerText().catch(() => '');
        if (/nạp|rút|tài khoản|balance|mikamika/i.test(headerText)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Wait for login to produce either a success or error state.
   * @param {import('playwright').Page} page
   * @param {number} timeoutMs
   * @returns {Promise<{status: 'success'|'error'|'timeout', message?: string}>}
   */
  async _waitForLoginOutcome(page, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      // Check for success: logged-in UI elements appear
      if (await this._checkIsLoggedIn(page)) {
        return { status: 'success' };
      }

      // Check toast/success message
      const successToast = await page.locator('[class*="toast"]:has-text("thành công"), [class*="success"]').first().isVisible({ timeout: 500 }).catch(() => false);
      if (successToast) {
        return { status: 'success' };
      }

      // Check for error messages
      for (const errorSel of SELECTORS.errorMessages) {
        try {
          const el = page.locator(errorSel).first();
          const visible = await el.isVisible({ timeout: 500 });
          if (visible) {
            const errorText = (await el.innerText().catch(() => '')).trim().toLowerCase();
            if (LOGIN_ERROR_HINTS.some((hint) => errorText.includes(hint))) {
              return { status: 'error', message: errorText };
            }
          }
        } catch (_) { }
      }

      await page.waitForTimeout(400);
    }

    return { status: 'timeout' };
  }

  /**
   * Find the first visible selector from a list within a timeout.
   * @param {import('playwright').Page} page
   * @param {string[]} selectors
   * @param {number} timeoutMs
   * @returns {Promise<string|null>}
   */
  async _findVisibleSelector(page, selectors, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const sel of selectors) {
        try {
          const visible = await page.locator(sel).first().isVisible({ timeout: 300 });
          if (visible) return sel;
        } catch (_) { }
      }
      await page.waitForTimeout(250);
    }
    return null;
  }

  /**
   * Save a debug screenshot on error.
   * @param {import('playwright').Page} page
   * @param {string} label
   */
  async _saveErrorScreenshot(page, label) {
    try {
      await page.screenshot({
        path: `./error_screenshots/lu88_${label}_${Date.now()}.png`,
        fullPage: false,
      });
    } catch (_) { }
  }
}
