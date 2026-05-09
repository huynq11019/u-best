// T016 - Surebet discovery orchestrator
import { matchEvents } from './eventMatcher.js';
import { findOuSurebets } from './surebetCalculator.js';
import { acquirePage, releasePage } from '../browserPool.js';
import { getAdapter } from '../adapterRegistry.js';
import { childLogger } from '../../config/logger.js';
import { config } from '../../config/index.js';

const log = childLogger({ component: 'surebetFinder' });

/**
 * Scan for surebets between two bookmakers
 * @param {Object} options - Scan options
 * @param {string} [options.sport='football'] - Sport to scan
 * @param {string} [options.scope] - Filter by scope (live/prematch)
 * @param {number} [options.minProfitPct=0.5] - Minimum profit percentage
 * @param {Array<string>} [options.books=['lu88','x1']] - Bookmaker pairs to scan
 * @param {number} [options.fuzzyThreshold=0.85] - Fuzzy matching threshold
 * @param {boolean} [options.mock=false] - Use mock data for testing
 * @returns {Promise<Object>} - Scan results
 */
export async function scanSurebets(options = {}) {
  const {
    sport = 'football',
    scope,
    minProfitPct = parseFloat(process.env.SUREBET_MIN_PROFIT_PCT || '0.5'),
    books = (process.env.SUREBET_PAIRS || 'lu88,x1').split(',').map(b => b.trim()),
    fuzzyThreshold = parseFloat(process.env.SUREBET_FUZZY_THRESHOLD || '0.85'),
    mock = process.env.SUREBET_MOCK_MODE === 'true' || options.mock === true,
  } = options;

  // Use mock mode if enabled
  if (mock) {
    return generateMockScanResults(options);
  }

  if (books.length !== 2) {
    throw new Error('Surebet scanning currently supports exactly 2 bookmakers');
  }

  const [bookA, bookB] = books;
  log.info({ sport, scope, minProfitPct, books, fuzzyThreshold }, 'Starting surebet scan');

  const startTime = Date.now();
  let pageA, pageB;

  try {
    // Acquire pages from browser pool
    [pageA, pageB] = await Promise.all([
      acquirePage(bookA),
      acquirePage(bookB)
    ]);

    // Get events with odds from both bookmakers
    const [eventsA, eventsB] = await Promise.all([
      getEventsWithOdds(bookA, pageA, sport),
      getEventsWithOdds(bookB, pageB, sport)
    ]);

    log.info({ 
      bookA, bookB, 
      countA: eventsA.length, 
      countB: eventsB.length,
      fetchTime: Date.now() - startTime 
    }, 'Fetched events from both bookmakers');

    // Match events between bookmakers
    const matchOptions = {
      fuzzyThreshold,
      requireSameSport: true,
      requireSameScope: !!scope,
    };
    
    let matches = matchEvents(eventsA, eventsB, matchOptions);

    // Filter by scope if specified
    if (scope) {
      matches = matches.filter(match => 
        match.eventA.scope === scope && match.eventB.scope === scope
      );
    }

    log.info({ 
      totalMatches: matches.length,
      exactMatches: matches.filter(m => m.matchType === 'exact').length,
      fuzzyMatches: matches.filter(m => m.matchType === 'fuzzy').length 
    }, 'Event matching completed');

    // Find surebets for each matched pair
    const allSurebets = [];
    for (const match of matches) {
      const surebets = findOuSurebets(
        match.eventA, 
        match.eventB, 
        { matchType: match.matchType, score: match.score },
        { minProfitPct }
      );
      allSurebets.push(...surebets);
    }

    // Sort by profit percentage (highest first)
    allSurebets.sort((a, b) => b.profit_pct - a.profit_pct);

    const scanTime = Date.now() - startTime;
    const result = {
      fetched_at: new Date().toISOString(),
      scan_time_ms: scanTime,
      sport,
      scope,
      min_profit_pct: minProfitPct,
      books: { bookA, bookB },
      scanned: {
        [bookA]: eventsA.length,
        [bookB]: eventsB.length
      },
      matched: matches.length,
      surebets: allSurebets,
      summary: {
        total_surebets: allSurebets.length,
        exact_matches: matches.filter(m => m.matchType === 'exact').length,
        fuzzy_matches: matches.filter(m => m.matchType === 'fuzzy').length,
        avg_profit_pct: allSurebets.length > 0 
          ? allSurebets.reduce((sum, s) => sum + s.profit_pct, 0) / allSurebets.length 
          : 0
      }
    };

    log.info({ 
      totalSurebets: allSurebets.length,
      scanTime,
      avgProfit: result.summary.avg_profit_pct 
    }, 'Surebet scan completed');

    return result;

  } catch (error) {
    log.error({ error: error.message, stack: error.stack }, 'Surebet scan failed');
    throw error;
  } finally {
    // Release pages back to pool
    if (pageA) {
      await releasePage(bookA, pageA).catch(err => 
        log.warn({ book: bookA, error: err.message }, 'Failed to release page')
      );
    }
    if (pageB) {
      await releasePage(bookB, pageB).catch(err => 
        log.warn({ book: bookB, error: err.message }, 'Failed to release page')
      );
    }
  }
}

/**
 * Generate mock scan results for testing
 */
function generateMockScanResults(options) {
  const { sport = 'football', scope, minProfitPct = 0.5, books = ['lu88', 'x1'] } = options;
  const [bookA, bookB] = books;
  
  const mockSurebets = [
    {
      matchKey: 'mock_match_1__mock_match_1_b',
      sport: 'football',
      league: 'Premier League',
      home: 'Manchester United',
      away: 'Liverpool',
      scope: scope || 'live',
      line: 2.5,
      matchType: 'exact',
      matchScore: 1.0,
      combination: 'Over_A_Under_B',
      legs: [
        {
          book: bookA,
          side: 'Over',
          odds: 2.10,
          selectionId: 'mock_over_2.5',
          eventId: 'mock_match_1',
          stake_ratio: 0.476
        },
        {
          book: bookB,
          side: 'Under',
          odds: 2.00,
          selectionId: 'mock_under_2.5',
          eventId: 'mock_match_1_b',
          stake_ratio: 0.524
        }
      ],
      implied: 0.976,
      profit_pct: 2.46,
      fetched_at: new Date().toISOString()
    },
    {
      matchKey: 'mock_match_2__mock_match_2_b',
      sport: 'football',
      league: 'La Liga',
      home: 'Real Madrid',
      away: 'Barcelona',
      scope: scope || 'live',
      line: 3.0,
      matchType: 'exact',
      matchScore: 1.0,
      combination: 'Over_B_Under_A',
      legs: [
        {
          book: bookB,
          side: 'Over',
          odds: 1.95,
          selectionId: 'mock_over_3.0_b',
          eventId: 'mock_match_2_b',
          stake_ratio: 0.513
        },
        {
          book: bookA,
          side: 'Under',
          odds: 1.90,
          selectionId: 'mock_under_3.0',
          eventId: 'mock_match_2',
          stake_ratio: 0.487
        }
      ],
      implied: 0.987,
      profit_pct: 1.31,
      fetched_at: new Date().toISOString()
    }
  ].filter(s => s.profit_pct >= minProfitPct);

  return {
    fetched_at: new Date().toISOString(),
    scan_time_ms: 100,
    sport,
    scope,
    min_profit_pct: minProfitPct,
    books: { bookA, bookB },
    scanned: { [bookA]: 25, [bookB]: 22 },
    matched: 8,
    surebets: mockSurebets,
    summary: {
      total_surebets: mockSurebets.length,
      exact_matches: 6,
      fuzzy_matches: 2,
      avg_profit_pct: mockSurebets.length > 0 
        ? mockSurebets.reduce((sum, s) => sum + s.profit_pct, 0) / mockSurebets.length 
        : 0
    },
    mock_mode: true
  };
}

/**
 * Get events with odds from a bookmaker adapter
 * Uses getEventsWithOdds if available, falls back to getActiveOdds + grouping
 */
async function getEventsWithOdds(bookmakerKey, page, sport) {
  const adapter = getAdapter(bookmakerKey);
  
  try {
    // Try getEventsWithOdds first (available for lu88)
    if (typeof adapter.getEventsWithOdds === 'function') {
      return await adapter.getEventsWithOdds(page, sport);
    }
    
    // Fall back to getActiveOdds and group by event
    const activeOdds = await adapter.getActiveOdds(page, sport);
    
    // Group flat odds by event
    const eventMap = new Map();
    for (const odd of activeOdds) {
      const key = odd.eventId;
      if (!eventMap.has(key)) {
        eventMap.set(key, {
          eventId: odd.eventId,
          leagueId: odd.leagueId,
          sport: odd.sport,
          home: odd.home,
          away: odd.away,
          league: odd.league,
          startTime: odd.startTime,
          scope: odd.scope,
          markets: []
        });
      }
      
      // Convert flat odds to market format
      if (odd.marketType && odd.selections) {
        const event = eventMap.get(key);
        let market = event.markets.find(m => m.marketType === odd.marketType);
        
        if (!market) {
          market = {
            marketType: odd.marketType,
            lines: []
          };
          event.markets.push(market);
        }
        
        // For OU markets, group by line
        if (odd.marketType === 'OU' && odd.line !== undefined) {
          let line = market.lines.find(l => l.line === odd.line);
          if (!line) {
            line = { line: odd.line, selections: [] };
            market.lines.push(line);
          }
          line.selections.push(...odd.selections);
        }
      }
    }
    
    return Array.from(eventMap.values());
    
  } catch (error) {
    log.error({ bookmakerKey, error: error.message }, 'Failed to get events with odds');
    return [];
  }
}

/**
 * Validate scan parameters
 */
export function validateScanParams(params) {
  const errors = [];
  
  if (params.minProfitPct !== undefined) {
    const profit = parseFloat(params.minProfitPct);
    if (isNaN(profit) || profit < 0 || profit > 100) {
      errors.push('minProfitPct must be a number between 0 and 100');
    }
  }
  
  if (params.fuzzyThreshold !== undefined) {
    const threshold = parseFloat(params.fuzzyThreshold);
    if (isNaN(threshold) || threshold < 0 || threshold > 1) {
      errors.push('fuzzyThreshold must be a number between 0 and 1');
    }
  }
  
  if (params.scope !== undefined && !['live', 'prematch'].includes(params.scope)) {
    errors.push('scope must be either "live" or "prematch"');
  }
  
  return errors;
}
