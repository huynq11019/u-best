// T016 - Deduplication helper using Redis SETNX with TTL
import { getRedisClient } from '../config/redis.js';
import { config } from '../config/index.js';
import { childLogger } from '../config/logger.js';

const log = childLogger({ component: 'dedupeService' });

/**
 * Build a deterministic dedup key from the opportunity payload.
 * Uses opportunity_id if stable; otherwise builds a composite hash.
 * @param {import('../models/index.js').SurebetOpportunity} opportunity
 * @returns {string}
 */
export function buildDedupKey(opportunity) {
  if (opportunity.opportunity_id) {
    return `dedup:opp:${opportunity.opportunity_id}`;
  }
  // Synthetic composite key for opportunities without stable IDs
  const legs = opportunity.bet.legs
    .map((l) => `${l.book}:${l.type}:${l.odds}`)
    .sort()
    .join('|');
  const composite = [
    opportunity.market,
    opportunity.scope,
    opportunity.home,
    opportunity.away,
    opportunity.line,
    opportunity.from_books,
    legs,
  ].join('::');
  return `dedup:composite:${Buffer.from(composite).toString('base64url')}`;
}

/**
 * Try to claim a dedup lock for the opportunity.
 * Returns { isDuplicate: false, key } on first-seen, or { isDuplicate: true, key } if already seen.
 *
 * @param {import('../models/index.js').SurebetOpportunity} opportunity
 * @param {string} executionId  - The new execution attempt's ID
 * @returns {Promise<{ isDuplicate: boolean, key: string }>}
 */
export async function checkAndClaimDedup(opportunity, executionId) {
  const key = buildDedupKey(opportunity);

  try {
    const redis = getRedisClient();
    // NX = set only if NOT exists; EX = expiry in seconds
    const result = await redis.set(key, executionId, 'EX', config.dedupTtlSeconds, 'NX');

    if (result === null) {
      // Key already existed → duplicate
      const existingId = await redis.get(key);
      log.warn({ key, existing_execution_id: existingId }, 'Duplicate opportunity detected');
      return { isDuplicate: true, key };
    }

    log.info({ key, execution_id: executionId }, 'Dedup lock claimed');
    return { isDuplicate: false, key };
  } catch (err) {
    // Redis unavailable → fail open (allow execution, no dedup guarantee)
    log.error({ err: err.message, key }, 'Dedup Redis failure — failing open');
    return { isDuplicate: false, key };
  }
}

/**
 * Release a dedup lock (e.g. on validation failure — don't block retries).
 * @param {string} key
 */
export async function releaseDedupLock(key) {
  try {
    const redis = getRedisClient();
    await redis.del(key);
    log.info({ key }, 'Dedup lock released');
  } catch (err) {
    log.warn({ err: err.message, key }, 'Failed to release dedup lock');
  }
}
