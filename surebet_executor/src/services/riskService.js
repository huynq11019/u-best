// T020 - Risk Evaluation Service
import { getRiskPolicy } from '../config/riskPolicy.js';
import { childLogger } from '../config/logger.js';

const log = childLogger({ component: 'riskService' });

/**
 * Validate a surebet opportunity against all configured risk policies.
 *
 * @param {import('../models/index.js').SurebetOpportunity} opportunity
 * @returns {{ valid: boolean, reason?: string, errorCode?: string }}
 */
export function validateOpportunity(opportunity) {
  const policy = getRiskPolicy();

  // 1. Freshness / staleness check
  const ageMs = Date.now() - new Date(opportunity.updated_at).getTime();
  if (ageMs > policy.staleWindowMs) {
    log.warn({ ageMs, staleWindowMs: policy.staleWindowMs }, 'Opportunity is stale');
    return {
      valid: false,
      reason: `Opportunity is stale (age ${ageMs}ms > threshold ${policy.staleWindowMs}ms)`,
      errorCode: 'STALE_OPPORTUNITY',
    };
  }

  // 2. Minimum profit check
  const profitPct = opportunity.bet?.profit_pct_calc ?? opportunity.profit_pct ?? 0;
  if (profitPct < policy.minProfitPct) {
    log.warn({ profitPct, minProfitPct: policy.minProfitPct }, 'Profit below minimum threshold');
    return {
      valid: false,
      reason: `Profit ${profitPct}% is below minimum ${policy.minProfitPct}%`,
      errorCode: 'PROFIT_BELOW_MINIMUM',
    };
  }

  // 3. Allowed bookmakers check
  for (const leg of opportunity.bet.legs) {
    if (!policy.allowedBookmakers.includes(leg.book)) {
      log.warn({ book: leg.book, allowedBookmakers: policy.allowedBookmakers }, 'Bookmaker not in allowlist');
      return {
        valid: false,
        reason: `Bookmaker "${leg.book}" is not in the allowed list: ${policy.allowedBookmakers.join(', ')}`,
        errorCode: 'BOOKMAKER_NOT_ALLOWED',
      };
    }
  }

  // 4. Max stake check per leg
  for (const leg of opportunity.bet.legs) {
    if (leg.stake > policy.maxStakePerLeg) {
      log.warn({ stake: leg.stake, maxStakePerLeg: policy.maxStakePerLeg, book: leg.book }, 'Stake exceeds limit');
      return {
        valid: false,
        reason: `Stake ${leg.stake} for ${leg.book} exceeds max ${policy.maxStakePerLeg}`,
        errorCode: 'STAKE_EXCEEDS_LIMIT',
      };
    }
  }

  log.info({ profitPct, staleAgeMs: ageMs }, 'Opportunity passed risk validation');
  return { valid: true };
}
