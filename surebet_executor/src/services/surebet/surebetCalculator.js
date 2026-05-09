// T016 - Surebet calculation for Over/Under markets
import { childLogger } from '../../config/logger.js';

const log = childLogger({ component: 'surebetCalculator' });

/**
 * Calculate implied probability and profit for a surebet
 * @param {number} oddsA - Odds for selection A
 * @param {number} oddsB - Odds for selection B
 * @returns {Object} - Calculation result
 */
function calculateSurebet(oddsA, oddsB) {
  const implied = 1/oddsA + 1/oddsB;
  const profitPct = (1/implied - 1) * 100;
  
  return {
    implied,
    profit_pct: profitPct,
    stake_ratio_a: (1/oddsA) / implied,
    stake_ratio_b: (1/oddsB) / implied,
  };
}

/**
 * Find OU (Over/Under) surebets between two events
 * @param {Object} eventA - Event from bookmaker A
 * @param {Object} eventB - Event from bookmaker B
 * @param {Object} matchInfo - Match information (score, type)
 * @param {Object} options - Calculation options
 * @returns {Array} - Array of surebet opportunities
 */
export function findOuSurebets(eventA, eventB, matchInfo, options = {}) {
  const { minProfitPct = 0.5 } = options;
  const surebets = [];

  // Find OU markets in both events
  const marketA = eventA.markets?.find(m => m.marketType === 'OU');
  const marketB = eventB.markets?.find(m => m.marketType === 'OU');

  if (!marketA || !marketB) {
    log.debug({ 
      eventIdA: eventA.eventId, 
      eventIdB: eventB.eventId,
      hasMarketA: !!marketA,
      hasMarketB: !!marketB 
    }, 'One or both events missing OU market');
    return surebets;
  }

  // Create line maps for both markets
  const linesA = marketA.lines || [];
  const linesB = marketB.lines || [];

  const lineMapA = new Map();
  const lineMapB = new Map();

  // Group selections by line for event A
  for (const line of linesA) {
    if (!line.selections || line.selections.length !== 2) continue;
    const over = line.selections.find(s => s.selection === 'Over');
    const under = line.selections.find(s => s.selection === 'Under');
    if (over && under) {
      lineMapA.set(line.line, { over, under });
    }
  }

  // Group selections by line for event B
  for (const line of linesB) {
    if (!line.selections || line.selections.length !== 2) continue;
    const over = line.selections.find(s => s.selection === 'Over');
    const under = line.selections.find(s => s.selection === 'Under');
    if (over && under) {
      lineMapB.set(line.line, { over, under });
    }
  }

  // Find matching lines and calculate surebets
  for (const [line, selectionsA] of lineMapA) {
    const selectionsB = lineMapB.get(line);
    if (!selectionsB) continue;

    // Calculate both combinations:
    // 1. Over from A + Under from B
    const calc1 = calculateSurebet(selectionsA.over.odds, selectionsB.under.odds);
    if (calc1.profit_pct >= minProfitPct) {
      surebets.push(createSurebetObject(
        eventA, eventB, matchInfo, line,
        selectionsA.over, selectionsB.under,
        calc1, 'Over_A_Under_B'
      ));
    }

    // 2. Over from B + Under from A
    const calc2 = calculateSurebet(selectionsB.over.odds, selectionsA.under.odds);
    if (calc2.profit_pct >= minProfitPct) {
      surebets.push(createSurebetObject(
        eventA, eventB, matchInfo, line,
        selectionsB.over, selectionsA.under,
        calc2, 'Over_B_Under_A'
      ));
    }
  }

  log.debug({ 
    eventIdA: eventA.eventId, 
    eventIdB: eventB.eventId,
    linesChecked: lineMapA.size,
    surebetsFound: surebets.length 
  }, 'OU surebet calculation completed');

  return surebets;
}

/**
 * Create a surebet object with all required fields
 */
function createSurebetObject(eventA, eventB, matchInfo, line, selectionOver, selectionUnder, calc, combination) {
  const now = new Date().toISOString();
  
  // Determine which event each selection belongs to
  const isOverFromA = selectionOver.eventId === eventA.eventId || 
                     (selectionOver.id && selectionOver.id.includes(eventA.eventId));
  const isUnderFromA = selectionUnder.eventId === eventA.eventId || 
                      (selectionUnder.id && selectionUnder.id.includes(eventA.eventId));
  
  return {
    matchKey: `${eventA.eventId}__${eventB.eventId}`,
    sport: eventA.sport,
    league: eventA.league || eventB.league,
    home: eventA.home,
    away: eventA.away,
    scope: eventA.scope,
    line,
    matchType: matchInfo.matchType,
    matchScore: matchInfo.score,
    combination,
    legs: [
      {
        book: isOverFromA ? 'lu88' : 'x1',
        side: 'Over',
        odds: selectionOver.odds,
        selectionId: selectionOver.selectionId || selectionOver.id,
        eventId: isOverFromA ? eventA.eventId : eventB.eventId,
        stake_ratio: calc.stake_ratio_a,
      },
      {
        book: isUnderFromA ? 'lu88' : 'x1', 
        side: 'Under',
        odds: selectionUnder.odds,
        selectionId: selectionUnder.selectionId || selectionUnder.id,
        eventId: isUnderFromA ? eventA.eventId : eventB.eventId,
        stake_ratio: calc.stake_ratio_b,
      }
    ],
    implied: calc.implied,
    profit_pct: calc.profit_pct,
    fetched_at: now,
  };
}

/**
 * Calculate stake amounts for a given total stake
 * @param {Object} surebet - Surebet object
 * @param {number} totalStake - Total amount to bet
 * @returns {Object} - Stake amounts for each leg
 */
export function calculateStakes(surebet, totalStake) {
  const legs = surebet.legs.map(leg => ({
    ...leg,
    stake: totalStake * leg.stake_ratio,
  }));

  return {
    total_stake: totalStake,
    legs,
    expected_payout: totalStake * (1 + surebet.profit_pct / 100),
  };
}
