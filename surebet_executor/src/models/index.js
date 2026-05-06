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
 * @property {string} [selectionId]   - lu88: composite ID dạng "lu88_{oddsId}_{betteam}", dùng để lookup metadata từ _lu88SelectionCache
 * @property {string} [oddsId]        - lu88: ID tỷ lệ cược, lấy từ id attribute của .c-odds-button (e.g. "987563457")
 * @property {number} [bettype]       - lu88: data-bt number (1=AH, 3=OU, 5=1X2, 7=AH_HT, 8=OU_HT, 15=1X2_HT)
 * @property {string} [betteam]       - lu88: "h"|"a" cho AH/1X2, "o"|"u" cho OU (từ id suffix của .c-odds-button)
 * @property {boolean} [isInPlay]     - lu88: true nếu kèo đang live (scope === 'live')
 * @property {number} [homeScore]     - lu88: tỷ số đội nhà tại thời điểm đặt
 * @property {number} [awayScore]     - lu88: tỷ số đội khách tại thời điểm đặt
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
