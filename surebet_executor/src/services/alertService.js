// T022 + T023 - Alert dispatcher service
import { childLogger } from '../config/logger.js';

const log = childLogger({ component: 'alertService' });

// For MVP: log-based alerting. Replace with Telegram/Slack/webhook dispatch for production.

/**
 * Emit an alert when execution completes in a failed state.
 * @param {string} executionId
 * @param {string} status - ExecutionStatus value
 * @param {string} reason
 */
async function emitExecutionAlert(executionId, status, reason) {
  log.error(
    { execution_id: executionId, alert_type: 'EXECUTION_FAILED', status, reason },
    'ALERT: Execution failed'
  );
  // TODO: dispatch to Telegram or webhook channel
}

/**
 * Emit an alert when one leg succeeds and one fails (partial failure).
 * @param {string} executionId
 * @param {Object[]} legs - LegExecutionResult array
 */
async function emitPartialFailureAlert(executionId, legs) {
  const failed = legs.filter((l) => l.status === 'FAILED').map((l) => l.book);
  const placed = legs.filter((l) => l.status === 'PLACED').map((l) => l.book);
  log.warn(
    { execution_id: executionId, alert_type: 'PARTIAL_FAILURE', placed, failed },
    'ALERT: Partial placement failure — compensation starting'
  );
  // TODO: dispatch to alert channel
}

/**
 * Emit an alert when compensation (hedge + void) both fail.
 * Signals that manual intervention is required.
 * @param {string} executionId
 * @param {Object[]} legs
 */
async function emitManualInterventionAlert(executionId, legs) {
  const placed = legs.filter((l) => l.status === 'PLACED').map((l) => ({
    book: l.book,
    order_ref: l.order_ref,
    stake: l.placed_stake,
  }));
  log.error(
    {
      execution_id: executionId,
      alert_type: 'MANUAL_INTERVENTION_REQUIRED',
      placed_legs: placed,
    },
    'ALERT: 🚨 MANUAL INTERVENTION REQUIRED — compensation failed'
  );
  // TODO: page on-call, send Telegram message with placed_legs details
}

/**
 * Emit an alert when risk validation rejects an opportunity.
 * @param {string} executionId
 * @param {string} reason
 * @param {string} errorCode
 */
async function emitRejectionAlert(executionId, reason, errorCode) {
  log.info(
    { execution_id: executionId, alert_type: 'RISK_REJECTION', errorCode, reason },
    'ALERT: Opportunity rejected by risk policy'
  );
  // Risk rejections are informational, not critical
}

export const alertService = {
  emitExecutionAlert,
  emitPartialFailureAlert,
  emitManualInterventionAlert,
  emitRejectionAlert,
};
