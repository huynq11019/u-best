// T015 - 1xBet UI Adapter: login, warmUp, placeBet, hedgeLeg, voidLeg, getActiveOdds
import { BaseAdapter, SportType } from './baseAdapter.js';
import { childLogger } from '../config/logger.js';

const log = childLogger({ component: 'x1Adapter' });

const LOGGED_IN_SELECTORS = [
  '.double-row-header-user-office-dropdown__trigger',
  '.double-row-header-user-office-dropdown',
  '[class*="user-office-dropdown"]',
  '[class*="header-user"]',
  '[class*="balance"]',
  '.user-control-dashboard-payment',
  '.user-control-dashboard-ticket',
  '.user-bonus-dropdown__btn',
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
  [SportType.FOOTBALL]:   { path: 'football',   sportId: 1  },
  [SportType.BASKETBALL]: { path: 'basketball',  sportId: 3  },
  [SportType.TENNIS]:     { path: 'tennis',      sportId: 5  },
  [SportType.BASEBALL]:   { path: 'baseball',    sportId: 11 },
  [SportType.HOCKEY]:     { path: 'hockey',      sportId: 12 },
  [SportType.VOLLEYBALL]: { path: 'volleyball',  sportId: 21 },
  [SportType.ALL]:        { path: '',            sportId: null },
};

/**
 * 1xBet bookmaker adapter.
 * Uses Playwright to interact with the 1xBet UI for bet placement.
 *
 * NOTE: Selectors and URLs are placeholders — update with real 1xBet UI locators.
 */
export default class X1Adapter extends BaseAdapter {
  constructor(bookmakerKey, bookkieConfig) {
    super(bookmakerKey, bookkieConfig);
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
    await usernameInput.dispatchEvent('input').catch(() => {});
    await usernameInput.dispatchEvent('change').catch(() => {});
    
    await passwordInput.click({ delay: 50 });
    await passwordInput.fill('');
    await page.waitForTimeout(200);
    await passwordInput.pressSequentially(this.config.password || '', { delay: 100 });
    await passwordInput.dispatchEvent('input').catch(() => {});
    await passwordInput.dispatchEvent('change').catch(() => {});

    await page.waitForTimeout(250);
    
    // Verify inputs before submitting
    log.info(`1xBet: taking screenshot before submit to verify inputs`);
    await page.screenshot({ path: './error_screenshots/before_submit_' + Date.now() + '.png', fullPage: false });

    log.info('1xBet: submitting login');
    await page.click('.auth-form-fields__submit');

    log.info('1xBet: waiting for result (success indicator, redirect, or error message)');

    const outcome = await this._waitForLoginOutcome(page, 30000);
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
   * Fetch active odds from 1xBet for the given sport.
   * Navigates to the live sport page and scrapes all visible event cards.
   *
   * @param {import('playwright').Page} page
   * @param {string} [sportType=SportType.FOOTBALL]  - One of SportType values
   * @returns {Promise<import('./baseAdapter.js').ActiveOdd[]>}
   */
  async getActiveOdds(page, sportType = SportType.FOOTBALL) {
    const sport = SPORT_URL_MAP[sportType] || SPORT_URL_MAP[SportType.FOOTBALL];
    const baseUrl = this.config.baseUrl || 'https://1xfun888bet.com/vi';
    const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
    const liveUrl = sport.path
      ? `${normalizedBaseUrl}/live/${sport.path}`
      : `${normalizedBaseUrl}/live`;

    log.info({ sportType, liveUrl }, '1xBet: getActiveOdds — navigating to live sport page');

    await page.goto(liveUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for live game cards to appear.
    await page.waitForSelector(
      'div.dashboard-game, div.dashboard-game-block, div.dashboard-champ__game',
      { state: 'visible', timeout: 15000 }
    ).catch(() => {
      log.warn('1xBet: getActiveOdds — event container not found, page may be empty or have different structure');
    });

    // Small settle delay so dynamic content finishes rendering
    await page.waitForTimeout(1500);

    // Scrape live rows using the current dashboard-game + dashboard-markets DOM.
    const odds = await page.evaluate((scopeLabel) => {
      const results = [];

      const gameBlocks = document.querySelectorAll('div.dashboard-game-block, .dashboard-game-block');

      gameBlocks.forEach((block, gameIndex) => {
        try {
          const game = block.closest('.dashboard-game, .dashboard-champ__game') || block.parentElement || block;

          // Teams are rendered as two dashboard-game-team-info__name nodes.
          const teamNameNodes = Array.from(
            block.querySelectorAll('.dashboard-game-team-info__name, .ui-team-score-name, .dashboard-game-block__team')
          );
          const teamNames = [];
          teamNameNodes.forEach((node) => {
            const text = (node.textContent || '').trim().replace(/\s+/g, ' ');
            if (!text) {
              return;
            }
            if (!teamNames.includes(text)) {
              teamNames.push(text);
            }
          });

          const home = teamNames[0] || 'Unknown';
          const away = teamNames[1] || 'Unknown';

          const league = (
            game.closest('.dashboard-champ')
              ?.querySelector('.dashboard-champ__label, .dashboard-champ__title, .dashboard-champ__name')
              ?.textContent || ''
          ).trim();

          const linkEl = block.querySelector('a.dashboard-game-block__link, a[href*="/live/"]');
          const href = linkEl ? (linkEl.getAttribute('href') || '') : '';
          const eventId =
            game.getAttribute('data-game-id')
            || block.getAttribute('data-game-id')
            || block.getAttribute('data-event-id')
            || (href ? href.split('/').filter(Boolean).pop() : '')
            || `game-${gameIndex + 1}`;

          const startTime = (
            block.querySelector('.dashboard-game-info__time, [class*="game-info__time"]')?.textContent || ''
          ).trim();

          const marketNodes = game.querySelectorAll('.dashboard-markets__market, .ui-market');
          const selections = [];
          const defaultLabels = ['1', 'X', '2'];
          marketNodes.forEach((node, idx) => {
            const valueText = (
              node.querySelector('.ui-market__value, [class*="market__value"], [class*="coef"], [class*="odd"]')
                ?.textContent || node.textContent || ''
            )
              .trim()
              .replace(/,/g, '.');

            const rawOdds = parseFloat(valueText);
            if (rawOdds > 1) {
              const explicitLabel =
                (node.querySelector('.ui-market__label, [class*="label"], [class*="title"]')?.textContent || '').trim();
              selections.push({ label: explicitLabel || defaultLabels[idx] || `sel_${idx + 1}`, odds: rawOdds });
            }
          });

          if ((home !== 'Unknown' || away !== 'Unknown') && selections.length > 0) {
            results.push({
              eventId,
              sport: scopeLabel,
              home,
              away,
              league: league || '',
              marketType: '1X2',
              startTime,
              selections,
              scope: 'live',
            });
          }
        } catch (_) {
          // Skip malformed cards silently.
        }
      });

      return results;
    }, sportType);

    log.info({ sportType, count: odds.length }, '1xBet: getActiveOdds complete');
    return odds;
  }
}
