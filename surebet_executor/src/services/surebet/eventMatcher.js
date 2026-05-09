// T016 - Event matching between two bookmakers for surebet detection
import { normalizeTeamName, teamsMatch, calculateTeamSimilarity } from './teamNameNormalizer.js';
import { childLogger } from '../../config/logger.js';

const log = childLogger({ component: 'eventMatcher' });

/**
 * @typedef {Object} MatchedPair
 * @property {Object} eventA - Event from bookmaker A
 * @property {Object} eventB - Event from bookmaker B  
 * @property {number} score - Match score (1.0 for exact, <1.0 for fuzzy)
 * @property {string} matchType - 'exact' | 'fuzzy'
 */

/**
 * Match events between two bookmakers
 * @param {Array} eventsA - Events from bookmaker A
 * @param {Array} eventsB - Events from bookmaker B
 * @param {Object} options - Matching options
 * @returns {Array<MatchedPair>} - Array of matched pairs
 */
export function matchEvents(eventsA, eventsB, options = {}) {
  const {
    fuzzyThreshold = 0.85,
    requireSameSport = true,
    requireSameScope = true,
  } = options;

  const matches = [];
  const usedEventsB = new Set();

  log.info({ 
    eventsA: eventsA.length, 
    eventsB: eventsB.length, 
    fuzzyThreshold 
  }, 'Starting event matching');

  for (const eventA of eventsA) {
    let bestMatch = null;
    let bestScore = 0;

    for (const eventB of eventsB) {
      // Skip if already matched
      if (usedEventsB.has(eventB.eventId)) continue;

      // Skip if sport doesn't match (if required)
      if (requireSameSport && eventA.sport !== eventB.sport) continue;

      // Skip if scope doesn't match (live vs prematch)
      if (requireSameScope && eventA.scope !== eventB.scope) continue;

      // Try exact match first
      if (teamsMatch(eventA.home, eventA.away, eventB.home, eventB.away)) {
        bestMatch = eventB;
        bestScore = 1.0;
        break; // Exact match is always best
      }

      // Try fuzzy match
      const homeSimilarity = calculateTeamSimilarity(eventA.home, eventB.home);
      const awaySimilarity = calculateTeamSimilarity(eventA.away, eventB.away);
      
      // Also check swapped teams
      const homeSimilaritySwapped = calculateTeamSimilarity(eventA.home, eventB.away);
      const awaySimilaritySwapped = calculateTeamSimilarity(eventA.away, eventB.home);

      const score1 = (homeSimilarity + awaySimilarity) / 2;
      const score2 = (homeSimilaritySwapped + awaySimilaritySwapped) / 2;
      const fuzzyScore = Math.max(score1, score2);

      if (fuzzyScore > bestScore && fuzzyScore >= fuzzyThreshold) {
        bestMatch = eventB;
        bestScore = fuzzyScore;
      }
    }

    if (bestMatch) {
      matches.push({
        eventA,
        eventB: bestMatch,
        score: bestScore,
        matchType: bestScore === 1.0 ? 'exact' : 'fuzzy'
      });

      usedEventsB.add(bestMatch.eventId);
    }
  }

  const exactMatches = matches.filter(m => m.matchType === 'exact').length;
  const fuzzyMatches = matches.filter(m => m.matchType === 'fuzzy').length;

  log.info({ 
    total: matches.length, 
    exact: exactMatches, 
    fuzzy: fuzzyMatches 
  }, 'Event matching completed');

  return matches;
}

/**
 * Create a unique key for a matched pair
 * @param {MatchedPair} pair 
 * @returns {string} - Unique key
 */
export function createMatchKey(pair) {
  return `${pair.eventA.eventId}__${pair.eventB.eventId}`;
}

/**
 * Filter matches by sport type
 * @param {Array<MatchedPair>} matches 
 * @param {string} sport 
 * @returns {Array<MatchedPair>}
 */
export function filterBySport(matches, sport) {
  return matches.filter(pair => 
    pair.eventA.sport === sport && pair.eventB.sport === sport
  );
}

/**
 * Filter matches by scope (live/prematch)
 * @param {Array<MatchedPair>} matches 
 * @param {string} scope 
 * @returns {Array<MatchedPair>}
 */
export function filterByScope(matches, scope) {
  return matches.filter(pair => 
    pair.eventA.scope === scope && pair.eventB.scope === scope
  );
}
