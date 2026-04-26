// T008 - Base Bookmaker Adapter interface
import { groupOddsByEvent } from '../api/eventHelpers.js';

/**
 * Simple TTL cache for event odds data with enriched selection IDs.
 * Used by adapters to cache scraped odds and reference them by ID during placeBet.
 */
export class OddsCache {
  constructor(ttlMs = 120000) {
    this.cache = new Map();
    this.ttl = ttlMs;
  }

  /**
   * Store event data with auto-generated selection IDs.
   * @param {string} eventId
   * @param {object} eventData
   * @returns {object} enriched data with IDs
   */
  set(eventId, eventData) {
    const enriched = this._enrichWithIds(eventData);
    this.cache.set(eventId, { data: enriched, timestamp: Date.now() });
    return enriched;
  }

  /**
   * Get cached event data if not expired.
   * @param {string} eventId
   * @returns {object|null}
   */
  get(eventId) {
    const entry = this.cache.get(eventId);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(eventId);
      return null;
    }
    return entry.data;
  }

  /**
   * Clear cache for specific event or all events.
   * @param {string} [eventId]
   */
  clear(eventId) {
    if (eventId) {
      this.cache.delete(eventId);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Find a selection by its ID within cached event data.
   * @param {object} eventData
   * @param {string} selectionId
   * @returns {object|null} selection with market context
   */
  findSelection(eventData, selectionId) {
    if (!eventData.markets) return null;

    for (const market of eventData.markets) {
      // Check options (for 1X2)
      if (market.options) {
        const option = market.options.find(o => o.id === selectionId);
        if (option) {
          return { ...option, marketType: market.marketType, marketName: market.marketName, hasLines: false };
        }
      }
      // Check lines (for OU/AH)
      if (market.lines) {
        const line = market.lines.find(l => l.id === selectionId);
        if (line) {
          return { ...line, marketType: market.marketType, marketName: market.marketName, hasLines: true };
        }
      }
    }
    return null;
  }

  _enrichWithIds(eventData) {
    if (!eventData.markets) return eventData;

    const markets = eventData.markets.map((market, mIdx) => {
      const baseId = `${eventData.eventId}_${market.marketType}`;

      if (market.options) {
        return {
          ...market,
          options: market.options.map((opt, i) => ({
            ...opt,
            id: `${baseId}_opt_${i}`,
          })),
        };
      }

      if (market.lines) {
        return {
          ...market,
          lines: market.lines.map((line, i) => ({
            ...line,
            id: `${baseId}_line_${i}`,
          })),
        };
      }

      return market;
    });

    return { ...eventData, markets };
  }
}

/**
 * Supported sport types for odds fetching.
 * Adapters should use these keys in getActiveOdds().
 */
export const SportType = Object.freeze({
  FOOTBALL: 'football',
  BASKETBALL: 'basketball',
  TENNIS: 'tennis',
  BASEBALL: 'baseball',
  HOCKEY: 'hockey',
  VOLLEYBALL: 'volleyball',
  ALL: 'all',
});

/**
 * @typedef {Object} ActiveOdd
 * @property {string} eventId        - Unique event identifier on the bookmaker
 * @property {string} sport           - SportType value
 * @property {string} home            - Home team / player name
 * @property {string} away            - Away team / player name
 * @property {string} league          - League / competition name
 * @property {string} marketType      - e.g. "1X2", "OU", "AH"
 * @property {string} startTime       - ISO datetime of the event
 * @property {Array<{label: string, odds: number, line?: number}>} selections - Available selections
 * @property {string} scope           - "live" | "prematch"
 */

/**
 * Abstract base class for all bookmaker adapters.
 * Each bookmaker must implement: login, warmUp, placeBet, hedgeLeg, voidLeg, getActiveOdds.
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
    this._oddsCache = new OddsCache();
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

  /**
   * Fetch the list of active odds/markets from the bookmaker.
   * Should be called after a successful login().
   *
   * @param {import('playwright').Page} page
   * @param {string} [sportType]  - One of SportType values. Defaults to SportType.FOOTBALL.
   * @returns {Promise<ActiveOdd[]>}  - Array of active odds matching the sport filter.
   */
  async getActiveOdds(page, sportType) {
    throw new Error(`${this.constructor.name}.getActiveOdds() not implemented`);
  }

  /**
   * Fetch a list of events without full market data to optimize scraping speed.
   * Can be overridden by the specific adapter for better performance.
   *
   * @param {import('playwright').Page} page
   * @param {string} [sportType]
   * @returns {Promise<any[]>}
   */
  async getEvents(page, sportType) {
    // Default fallback: load all odds and group them, returning only the metadata.
    // Adapters should override this to only parse DOM for events directly.
    const odds = await this.getActiveOdds(page, sportType);
    const events = groupOddsByEvent(odds);
    return events.map(e => ({
      eventId: e.eventId,
      leagueId: e.leagueId,
      sport: e.sport,
      league: e.league,
      home: e.home,
      away: e.away,
      startTime: e.startTime,
      // fallback adds empty markets or omitted entirely if your schema prefers
      markets: []
    }));
  }

  /**
   * Fetch the details (odds/markets) for a specific event.
   * Can be overridden by the specific adapter to only scrape one event.
   *
   * @param {import('playwright').Page} page
   * @param {string} eventId
   * @param {string} [sportType]
   * @returns {Promise<any|null>}
   */
  async getEventOdds(page, eventId, sportType) {
    // Default fallback: load all odds, group them, and return the specific event.
    // Adapters should override this to parse only the matching event node.
    const odds = await this.getActiveOdds(page, sportType);
    const events = groupOddsByEvent(odds);
    return events.find(e => e.eventId === eventId) || null;
  }
}
