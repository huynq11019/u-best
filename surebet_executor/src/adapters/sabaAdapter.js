// T014 - Saba UI Adapter: login, warmUp, placeBet, hedgeLeg, voidLeg
import { BaseAdapter } from './baseAdapter.js';
import { childLogger } from '../config/logger.js';

const log = childLogger({ component: 'sabaAdapter' });

/**
 * Saba bookmaker adapter.
 * Uses Playwright to interact with the Saba UI for bet placement.
 *
 * NOTE: Selectors and URLs are placeholders — update with real Saba UI locators.
 */
export default class SabaAdapter extends BaseAdapter {
  constructor(bookmakerKey, bookkieConfig) {
    super(bookmakerKey, bookkieConfig);
  }

  /**
   * Log in to Saba and wait for the home page to load.
   * @param {import('playwright').Page} page
   */
  async login(page) {
    log.info('Saba: navigating to login page');
    await page.goto(this.config.baseUrl || 'https://saba.sport/login', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Fill credentials (update selectors to match real Saba page structure)
    await page.fill('[name="username"], #username, input[placeholder*="user"]', this.config.username || '');
    await page.fill('[name="password"], #password, input[type="password"]', this.config.password || '');
    await page.click('[type="submit"], button:has-text("Login"), button:has-text("Sign In")');

    await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 });
    log.info('Saba: login complete');
    this._isLoggedIn = true;
  }

  /**
   * Navigate to the bet placement / live-betting page and wait for it to be interactive.
   * @param {import('playwright').Page} page
   */
  async warmUp(page) {
    log.info('Saba: warming up — navigating to bet page');
    // Navigate to the live betting/OU page (update URL to actual Saba page)
    await page.goto(`${this.config.baseUrl || 'https://saba.sport'}/live/football`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    // Wait for key UI element to signal the page is ready
    await page.waitForSelector('[class*="odds-table"], [data-testid="bet-panel"]', {
      timeout: 15000,
    }).catch(() => {
      log.warn('Saba: warmUp selector not found — page may have different structure');
    });
    log.info('Saba: warm-up complete');
  }

  /**
   * Place a bet for the given leg on the Saba UI.
   * @param {import('playwright').Page} page
   * @param {import('../models/index.js').BetLeg} leg
   * @returns {Promise<{ order_ref: string, placed_odds: number, placed_stake: number }>}
   */
  async placeBet(page, leg) {
    log.info({ leg: { type: leg.type, odds: leg.odds, stake: leg.stake } }, 'Saba: placing bet');

    // --- PLACEHOLDER IMPLEMENTATION ---
    // This must be replaced with real Saba UI interaction logic.
    // Steps: search match → click selection (Over/Under) → enter stake → confirm
    throw new Error(
      'SabaAdapter.placeBet() requires real UI interaction — implement with actual Saba selectors'
    );

    // Expected return shape:
    // return { order_ref: 'SABA-ORD-xxx', placed_odds: leg.odds, placed_stake: leg.stake };
  }

  /**
   * Place a compensating hedge bet.
   * @param {import('playwright').Page} page
   * @param {import('../models/index.js').BetLeg} leg
   */
  async hedgeLeg(page, leg) {
    log.warn({ leg: { type: leg.type, book: leg.book } }, 'Saba: hedgeLeg called — placeholder');
    throw new Error('SabaAdapter.hedgeLeg() not yet implemented');
  }

  /**
   * Void/cancel an existing order.
   * @param {import('playwright').Page} page
   * @param {string} orderRef
   */
  async voidLeg(page, orderRef) {
    log.warn({ orderRef }, 'Saba: voidLeg called — placeholder');
    throw new Error('SabaAdapter.voidLeg() not yet implemented');
  }
}
