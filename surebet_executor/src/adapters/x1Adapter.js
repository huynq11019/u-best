// T015 - 1xBet UI Adapter: login, warmUp, placeBet, hedgeLeg, voidLeg
import { BaseAdapter } from './baseAdapter.js';
import { childLogger } from '../config/logger.js';

const log = childLogger({ component: 'x1Adapter' });

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

    // Check if we are already logged in via existing session/cookies
    const isLoggedIn = await page.$('.double-row-header-user-office-dropdown__trigger').catch(() => null);
    if (isLoggedIn) {
      log.info('1xBet: already logged in - skipping authentication');
      this._isLoggedIn = true;
      return;
    }

    log.info('1xBet: opening login dropdown');
    await page.waitForSelector('.auth-dropdown-trigger', { state: 'visible' });
    await page.click('.auth-dropdown-trigger');

    log.info('1xBet: filling credentials');
    await page.waitForSelector('input#username', { state: 'visible' });
    // Use type instead of fill to trigger input events required by validation
    await page.type('input#username', this.config.username || '', { delay: 50 });
    await page.type('input#username-password', this.config.password || '', { delay: 50 });
    
    log.info('1xBet: submitting login');
    await page.click('.auth-form-fields__submit');

    log.info('1xBet: waiting for result (success indicator or error message)');
    
    // Race between success (profile trigger) and failure (error modal)
    const result = await Promise.race([
      page.waitForSelector('.double-row-header-user-office-dropdown__trigger', { state: 'visible', timeout: 30000 }).then(() => 'success'),
      page.waitForSelector('.auth-form-fields__error, .modal-content', { state: 'visible', timeout: 30000 }).then(() => 'error'),
      page.waitForSelector('text="Sai tên người dùng hoặc mật khẩu"', { state: 'visible', timeout: 30000 }).then(() => 'error')
    ]).catch(err => {
      log.error({ err }, '1xBet: login timed out or failed fundamentally');
      return 'timeout';
    });

    if (result === 'error') {
      const errorMsg = await page.innerText('.auth-form-fields__error, .modal-content').catch(() => 'Unknown error');
      log.error({ errorMsg }, '1xBet: login failed with error message');
      throw new Error(`Login failed: ${errorMsg}`);
    }

    if (result === 'timeout') {
      throw new Error('Login timed out waiting for success or failure indicator');
    }
    
    log.info('1xBet: login complete');
    this._isLoggedIn = true;
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
}
