// T016 - Team name normalization for cross-bookmaker matching
import { readFileSync } from 'fs';
import { join } from 'path';
import { childLogger } from '../../config/logger.js';

const log = childLogger({ component: 'teamNameNormalizer' });

/**
 * Load team name aliases from config file if exists
 */
let aliases = {};
try {
  const aliasesPath = join(process.cwd(), 'config', 'team_aliases.json');
  aliases = JSON.parse(readFileSync(aliasesPath, 'utf8'));
  log.info({ aliasesCount: Object.keys(aliases).length }, 'Loaded team aliases');
} catch (err) {
  log.debug({ err: err.message }, 'No team aliases file found, using empty aliases');
}

/**
 * Remove diacritics from Vietnamese text
 */
function removeDiacritics(str) {
  return str.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

/**
 * Common suffixes/prefixes to strip from team names
 */
const STRIP_PATTERNS = [
  /\b(fc|cf|sc|club|city|athletic|ath|sports|sport|af|as|fk|ts|sd|cd|cs)\b/gi,
  /\b(ac|rc|ss|sf|sp|fc|cf|sc)\b/gi,
  /\b(fc|cf|sc|club|city|athletic|ath|sports|sport|af|as|fk|ts|sd|cd|cs)\s*$/gi,
  /^\s*(fc|cf|sc|club|city|athletic|ath|sports|sport|af|as|fk|ts|sd|cd|cs)\s+/gi,
  // Only strip "united" and "utd" when they are standalone suffixes/prefixes
  /\bunited\s*$/gi,
  /^\s*united\s+/gi,
  /\butd\s*$/gi,
  /^\s*utd\s+/gi,
];

/**
 * Characters to normalize
 */
const CLEAN_PATTERNS = [
  /[.,\-_]/g, // Replace dots, dashes, underscores with space
  /\s+/g,    // Multiple spaces to single space
  /^\s+|\s+$/g, // Trim
];

/**
 * Normalize a team name for matching
 * @param {string} name - Original team name
 * @returns {string} - Normalized name
 */
export function normalizeTeamName(name) {
  if (!name || typeof name !== 'string') return '';

  let normalized = name.toLowerCase().trim();

  // Apply aliases first
  if (aliases[normalized]) {
    normalized = aliases[normalized];
  }

  // Remove diacritics (Vietnamese)
  normalized = removeDiacritics(normalized);

  // Replace dots, dashes, underscores with space
  normalized = normalized.replace(/[.,\-_]/g, ' ');

  // Strip common suffixes (only at end) - but keep "United" as it's important
  normalized = normalized.replace(/\s+(fc|cf|sc|club|city|athletic|ath|sports|sport|af|as|fk|ts|sd|cd|cs)$/gi, '');

  // Strip common prefixes (only at start)
  normalized = normalized.replace(/^(fc|cf|sc|club|city|athletic|ath|sports|sport|af|as|fk|ts|sd|cd|cs)\s+/gi, '');

  // Clean up multiple spaces and trim
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}

/**
 * Check if two team names match (allowing home/away swap)
 * @param {string} homeA - Home team from source A
 * @param {string} awayA - Away team from source A  
 * @param {string} homeB - Home team from source B
 * @param {string} awayB - Away team from source B
 * @returns {boolean} - True if teams match (exact or swapped)
 */
export function teamsMatch(homeA, awayA, homeB, awayB) {
  const normHomeA = normalizeTeamName(homeA);
  const normAwayA = normalizeTeamName(awayA);
  const normHomeB = normalizeTeamName(homeB);
  const normAwayB = normalizeTeamName(awayB);

  // Direct match
  if (normHomeA === normHomeB && normAwayA === normAwayB) {
    return true;
  }

  // Swapped match
  if (normHomeA === normAwayB && normAwayA === normHomeB) {
    return true;
  }

  return false;
}

/**
 * Calculate similarity between two normalized team names
 * Uses Levenshtein distance ratio
 * @param {string} nameA 
 * @param {string} nameB 
 * @returns {number} - Similarity ratio between 0 and 1
 */
export function calculateTeamSimilarity(nameA, nameB) {
  const normA = normalizeTeamName(nameA);
  const normB = normalizeTeamName(nameB);

  if (normA === normB) {
    // If both are empty strings, return 0.0 instead of 1.0
    return normA === '' ? 0.0 : 1.0;
  }
  if (!normA || !normB) return 0.0;

  // Simple Levenshtein implementation
  const matrix = Array(normA.length + 1).fill(null).map(() => 
    Array(normB.length + 1).fill(null));

  for (let i = 0; i <= normA.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= normB.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= normA.length; i++) {
    for (let j = 1; j <= normB.length; j++) {
      const cost = normA[i - 1] === normB[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,     // deletion
        matrix[i][j - 1] + 1,     // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  const distance = matrix[normA.length][normB.length];
  const maxLength = Math.max(normA.length, normB.length);
  return maxLength === 0 ? 1.0 : (maxLength - distance) / maxLength;
}
