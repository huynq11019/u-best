// T017 + T026–T028 - Executor Service: parallel placement + Saga orchestration
import { randomUUID } from 'crypto';
import { getAdapter } from './adapterRegistry.js';
import { acquirePage, releasePage, destroyPage } from './browserPool.js';
import { logTransition, saveExecution } from './executionLogService.js';
import { alertService } from './alertService.js';
import { createExecutionAttempt, ExecutionStatus, LegStatus, CompensationAction, CompensationStatus } from '../models/index.js';
import { config } from '../config/index.js';
import { childLogger } from '../config/logger.js';

const log = childLogger({ component: 'executorService' });

/**
 * Execute one leg: acquire a pool page, place the bet, release/destroy the page.
 * @param {Object} leg - BetLeg from the opportunity
 * @param {number} legIndex
 * @param {Object} attempt - ExecutionAttempt (for logging)
 * @returns {Promise<{ success: boolean, result?: Object, error?: string }>}
 */
async function executeLeg(leg, legIndex, attempt) {
  const bookmakerKey = leg.book;
  let page = null;
  let pageDestroyed = false;

  try {
    const adapter = getAdapter(bookmakerKey);
    page = await acquirePage(bookmakerKey);

    log.info(
      { execution_id: attempt.execution_id, bookmakerKey, leg_index: legIndex },
      'Placing bet leg'
    );

    const result = await adapter.placeBet(page, leg);

    await releasePage(bookmakerKey, page);

    log.info(
      { execution_id: attempt.execution_id, bookmakerKey, order_ref: result.order_ref },
      'Leg placed successfully'
    );

    return {
      success: true,
      result: {
        leg_index: legIndex,
        book: bookmakerKey,
        status: LegStatus.PLACED,
        placed_odds: result.placed_odds,
        placed_stake: result.placed_stake,
        order_ref: result.order_ref,
        error_code: null,
      },
    };
  } catch (err) {
    log.error(
      { execution_id: attempt.execution_id, bookmakerKey, leg_index: legIndex, err: err.message },
      'Leg placement failed'
    );

    if (page && !pageDestroyed) {
      if (page._crashed) {
        await destroyPage(bookmakerKey, page).catch(() => {});
      } else {
        await releasePage(bookmakerKey, page).catch(() => {});
      }
    }

    return {
      success: false,
      result: {
        leg_index: legIndex,
        book: bookmakerKey,
        status: LegStatus.FAILED,
        placed_odds: null,
        placed_stake: null,
        order_ref: null,
        error_code: err.message,
      },
    };
  }
}

/**
 * Attempt compensation (hedge or void) for a successfully placed leg
 * when the other leg failed.
 *
 * @param {Object} placedLegResult - The successful LegExecutionResult
 * @param {Object} originalLeg - The original BetLeg definition
 * @param {Object} attempt - ExecutionAttempt
 * @returns {Promise<CompensationStatus>}
 */
async function compensate(placedLegResult, originalLeg, attempt) {
  const bookmakerKey = placedLegResult.book;
  let page = null;

  const tryHedge = async () => {
    page = await acquirePage(bookmakerKey);
    const adapter = getAdapter(bookmakerKey);
    await adapter.hedgeLeg(page, originalLeg);
    await releasePage(bookmakerKey, page);
    log.info({ execution_id: attempt.execution_id, bookmakerKey }, 'Hedge successful');
    return CompensationStatus.SUCCESS;
  };

  const tryVoid = async () => {
    page = await acquirePage(bookmakerKey);
    const adapter = getAdapter(bookmakerKey);
    await adapter.voidLeg(page, placedLegResult.order_ref);
    await releasePage(bookmakerKey, page);
    log.info({ execution_id: attempt.execution_id, bookmakerKey }, 'Void successful');
    return CompensationStatus.SUCCESS;
  };

  // Step 1: Try hedge
  try {
    logTransition(attempt.execution_id, ExecutionStatus.PARTIAL_ERROR, 'One leg failed — attempting hedge', {
      compensation: { action: CompensationAction.HEDGE, status: CompensationStatus.NOT_RUN },
    });
    return await tryHedge();
  } catch (hedgeErr) {
    log.error({ execution_id: attempt.execution_id, err: hedgeErr.message }, 'Hedge failed — trying void');
    if (page) await releasePage(bookmakerKey, page).catch(() => {});
    page = null;
  }

  // Step 2: Fallback to void
  try {
    logTransition(attempt.execution_id, ExecutionStatus.PARTIAL_ERROR, 'Hedge failed — attempting void', {
      compensation: { action: CompensationAction.VOID, status: CompensationStatus.NOT_RUN },
    });
    return await tryVoid();
  } catch (voidErr) {
    log.error({ execution_id: attempt.execution_id, err: voidErr.message }, 'Void also failed — manual intervention required');
    if (page) await releasePage(bookmakerKey, page).catch(() => {});
    return CompensationStatus.FAILED;
  }
}

/**
 * Main execution pipeline: validate deadline, dispatch legs in parallel,
 * handle partial failures via Saga compensation.
 *
 * @param {import('../models/index.js').SurebetOpportunity} opportunity
 * @param {string} [existingExecutionId]  - Pass if already created by handler
 * @returns {Promise<Object>} - Final ExecutionAttempt state
 */
export async function executeOpportunity(opportunity, existingExecutionId) {
  const executionId = existingExecutionId || randomUUID();
  const attempt = createExecutionAttempt(executionId, opportunity);
  saveExecution(attempt);

  const deadline = Date.now() + config.executionDeadlineMs;

  // Transition to EXECUTING
  logTransition(executionId, ExecutionStatus.EXECUTING, 'Dispatching legs concurrently');

  // Dispatch both legs in parallel
  const legs = opportunity.bet.legs;
  const [result0, result1] = await Promise.allSettled([
    executeLeg(legs[0], 0, attempt),
    executeLeg(legs[1], 1, attempt),
  ]);

  const legResults = [
    result0.status === 'fulfilled' ? result0.value : { success: false, result: { leg_index: 0, book: legs[0].book, status: LegStatus.FAILED, error_code: result0.reason?.message } },
    result1.status === 'fulfilled' ? result1.value : { success: false, result: { leg_index: 1, book: legs[1].book, status: LegStatus.FAILED, error_code: result1.reason?.message } },
  ];

  const leg0OK = legResults[0].success;
  const leg1OK = legResults[1].success;

  const legResultObjects = legResults.map((r) => r.result);

  // Check deadline
  if (Date.now() > deadline) {
    log.warn({ execution_id: executionId }, 'Execution deadline exceeded');
  }

  // ── Outcome determination ────────────────────────────────────────────────
  if (leg0OK && leg1OK) {
    // Both legs placed — COMPLETED
    logTransition(executionId, ExecutionStatus.COMPLETED, 'Both legs placed successfully', {
      legs: legResultObjects,
    });
    return { ...attempt, status: ExecutionStatus.COMPLETED, legs: legResultObjects };
  }

  if (!leg0OK && !leg1OK) {
    // Both failed — FAILED (no compensation needed)
    log.error({ execution_id: executionId }, 'Both legs failed');
    logTransition(executionId, ExecutionStatus.FAILED, 'Both legs failed', {
      legs: legResultObjects,
    });
    await alertService.emitExecutionAlert(executionId, ExecutionStatus.FAILED, 'Both legs failed');
    return { ...attempt, status: ExecutionStatus.FAILED, legs: legResultObjects };
  }

  // One leg succeeded, one failed — PARTIAL_ERROR → try compensation
  const successfulLegResult = leg0OK ? legResults[0].result : legResults[1].result;
  const successfulOriginalLeg = leg0OK ? legs[0] : legs[1];

  logTransition(executionId, ExecutionStatus.PARTIAL_ERROR, 'Partial failure — compensation starting', {
    legs: legResultObjects,
  });

  await alertService.emitPartialFailureAlert(executionId, legResultObjects);

  const compensationStatus = await compensate(successfulLegResult, successfulOriginalLeg, attempt);

  if (compensationStatus === CompensationStatus.FAILED) {
    // T027 - Manual intervention required
    logTransition(executionId, ExecutionStatus.MANUAL_INTERVENTION_REQUIRED, 'Compensation failed', {
      legs: legResultObjects,
      compensation: { action: CompensationAction.VOID, status: CompensationStatus.FAILED },
    });
    // T028 - emit alert for manual intervention
    await alertService.emitManualInterventionAlert(executionId, legResultObjects);
  } else {
    logTransition(executionId, ExecutionStatus.PARTIAL_ERROR, 'Compensation succeeded', {
      legs: legResultObjects,
      compensation: { action: CompensationAction.HEDGE, status: CompensationStatus.SUCCESS },
    });
  }

  return { ...attempt, status: attempt.status, legs: legResultObjects };
}
