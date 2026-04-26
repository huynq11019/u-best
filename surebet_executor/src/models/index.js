// T006 - Domain Entities and State Enums

/** Lifecycle states of an execution attempt */
export const ExecutionStatus = Object.freeze({
  PENDING: 'PENDING',
  VALIDATING: 'VALIDATING',
  EXECUTING: 'EXECUTING',
  COMPLETED: 'COMPLETED',
  PARTIAL_ERROR: 'PARTIAL_ERROR',
  FAILED: 'FAILED',
  MANUAL_INTERVENTION_REQUIRED: 'MANUAL_INTERVENTION_REQUIRED',
});

/** Per-leg placement outcomes */
export const LegStatus = Object.freeze({
  PENDING: 'PENDING',
  PLACED: 'PLACED',
  FAILED: 'FAILED',
  HEDGED: 'HEDGED',
  VOIDED: 'VOIDED',
});

/** Compensation actions after partial failure */
export const CompensationAction = Object.freeze({
  HEDGE: 'HEDGE',
  VOID: 'VOID',
});

export const CompensationStatus = Object.freeze({
  NOT_RUN: 'NOT_RUN',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
});

/**
 * @typedef {Object} BetLeg
 * @property {string} book  - Bookmaker key e.g. "saba" | "x1"
 * @property {string} type  - "Over" | "Under"
 * @property {number} odds
 * @property {number} stake
 * @property {string} label
 * @property {string|null} [team]
 * @property {number} [gameId]        - x1: Game ID (1xBet trận đấu ID)
 * @property {number} [selectionType] - x1: Selection Type T number (9=Over, 10=Under, 7=Home, 8=Away)
 * @property {number} [line]          - Mốc kèo O/U hoặc handicap (e.g. 6.5)
 * @property {number} [kind]          - 1=Over/Home/Yes, 2=Under/Away/No
 * @property {string} [leagueId]      - x1: League ID để build Referer URL
 */

/**
 * @typedef {Object} SurebetOpportunity
 * @property {string} [opportunity_id]
 * @property {string} sport
 * @property {string} market
 * @property {string} scope
 * @property {string} home
 * @property {string} away
 * @property {string} from_books
 * @property {number} line
 * @property {number} [profit_pct]
 * @property {string} updated_at  - ISO datetime
 * @property {{ total_stake: number, profit_pct_calc: number, payout_equal: number, legs: BetLeg[] }} bet
 */

/**
 * @typedef {Object} LegExecutionResult
 * @property {number} leg_index
 * @property {string} book
 * @property {string} status  - LegStatus value
 * @property {number|null} [placed_odds]
 * @property {number|null} [placed_stake]
 * @property {string|null} [order_ref]
 * @property {string|null} [error_code]
 */

/**
 * Creates a new ExecutionAttempt object
 * @param {string} executionId
 * @param {SurebetOpportunity} opportunity
 * @returns {Object}
 */
export function createExecutionAttempt(executionId, opportunity) {
  return {
    execution_id: executionId,
    opportunity_id: opportunity.opportunity_id || null,
    opportunity,
    status: ExecutionStatus.PENDING,
    status_reason: null,
    started_at: new Date().toISOString(),
    finished_at: null,
    total_latency_ms: null,
    legs: opportunity.bet.legs.map((leg, idx) => ({
      leg_index: idx,
      book: leg.book,
      status: LegStatus.PENDING,
      placed_odds: null,
      placed_stake: null,
      order_ref: null,
      error_code: null,
    })),
    compensation: {
      action: null,
      status: CompensationStatus.NOT_RUN,
    },
    alert_emitted: false,
  };
}
