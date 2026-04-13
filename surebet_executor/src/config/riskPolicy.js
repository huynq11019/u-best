// T019 - Risk Policy definitions
import { config } from '../config/index.js';

/**
 * Default risk policy loaded from environment/config.
 * These can be overridden per-call or hot-reloaded for production use.
 */
export function getRiskPolicy() {
  return {
    minProfitPct: config.minProfitPct,
    maxStakePerLeg: config.maxStakePerLeg,
    allowedBookmakers: config.allowedBookmakers,
    staleWindowMs: config.staleWindowMs,
  };
}
