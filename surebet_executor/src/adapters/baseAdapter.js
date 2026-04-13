// T008 - Base Bookmaker Adapter interface

/**
 * Abstract base class for all bookmaker adapters.
 * Each bookmaker must implement: login, warmUp, placeBet, hedgeLeg, voidLeg.
 */
export class BaseAdapter {
  constructor(bookmakerKey, bookkieConfig) {
    if (new.target === BaseAdapter) {
      throw new Error('BaseAdapter is abstract and cannot be instantiated directly.');
    }
    this.bookmakerKey = bookmakerKey;
    this.config = bookkieConfig;
    this._page = null;
    this._isLoggedIn = false;
  }

  /**
   * Perform authentication and navigate to the bookie landing page.
   * Called once during pool warm-up and on session expiry.
   * @param {import('playwright').Page} page
   * @returns {Promise<void>}
   */
  async login(page) {
    throw new Error(`${this.constructor.name}.login() not implemented`);
  }

  /**
   * Navigate to the bet placement page so the page is ready for placeBet().
   * Called after login to pre-warm the browser context.
   * @param {import('playwright').Page} page
   * @returns {Promise<void>}
   */
  async warmUp(page) {
    throw new Error(`${this.constructor.name}.warmUp() not implemented`);
  }

  /**
   * Submit a bet placement for the given leg.
   * @param {import('playwright').Page} page
   * @param {import('../models/index.js').BetLeg} leg
   * @returns {Promise<{ order_ref: string, placed_odds: number, placed_stake: number }>}
   */
  async placeBet(page, leg) {
    throw new Error(`${this.constructor.name}.placeBet() not implemented`);
  }

  /**
   * Place a hedge bet to neutralize an open position from a placed leg.
   * @param {import('playwright').Page} page
   * @param {import('../models/index.js').BetLeg} leg
   * @returns {Promise<{ order_ref: string }>}
   */
  async hedgeLeg(page, leg) {
    throw new Error(`${this.constructor.name}.hedgeLeg() not implemented`);
  }

  /**
   * Void / cancel an existing placed order.
   * @param {import('playwright').Page} page
   * @param {string} orderRef  - The order_ref returned by placeBet
   * @returns {Promise<{ voided: boolean }>}
   */
  async voidLeg(page, orderRef) {
    throw new Error(`${this.constructor.name}.voidLeg() not implemented`);
  }
}
