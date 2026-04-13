// T018 + T021 - Webhook handler: dedupe check → risk validation → executor pipeline
import { randomUUID } from 'crypto';
import { checkAndClaimDedup, releaseDedupLock } from '../services/dedupeService.js';
import { validateOpportunity } from '../services/riskService.js';
import { executeOpportunity } from '../services/executorService.js';
import { logTransition, saveExecution } from '../services/executionLogService.js';
import { alertService } from '../services/alertService.js';
import { createExecutionAttempt, ExecutionStatus } from '../models/index.js';
import { config } from '../config/index.js';
import { childLogger } from '../config/logger.js';

const log = childLogger({ component: 'webhookHandler' });

/**
 * Handle incoming surebet opportunity webhook.
 * Pipeline: dedupe check → risk validation → async execution
 *
 * Returns 202 Accepted immediately; execution runs in background.
 */
export async function handleSurebetWebhook(request, reply) {
  const opportunity = request.body;
  const executionId = randomUUID();

  log.info(
    {
      execution_id: executionId,
      opportunity_id: opportunity.opportunity_id,
      from_books: opportunity.from_books,
      profit_pct: opportunity.bet?.profit_pct_calc,
    },
    'Webhook received'
  );

  // ── Step 1: Deduplication ─────────────────────────────────────────────────
  const { isDuplicate, key: dedupKey } = await checkAndClaimDedup(opportunity, executionId);

  if (isDuplicate) {
    log.warn({ execution_id: executionId, dedupKey }, 'Duplicate opportunity — skipping');
    return reply.code(409).send({
      error_code: 'DUPLICATE_OPPORTUNITY',
      message: 'This opportunity is already being processed or was recently processed.',
    });
  }

  // ── Step 2: Risk validation ───────────────────────────────────────────────
  const validation = validateOpportunity(opportunity);

  if (!validation.valid) {
    // Release the dedup lock so future (corrected) signals can be processed
    await releaseDedupLock(dedupKey);

    log.warn(
      { execution_id: executionId, errorCode: validation.errorCode, reason: validation.reason },
      'Opportunity rejected by risk policy'
    );

    await alertService.emitRejectionAlert(executionId, validation.reason, validation.errorCode);

    return reply.code(422).send({
      error_code: validation.errorCode,
      message: validation.reason,
    });
  }

  // ── Step 3: Accept and dispatch ───────────────────────────────────────────
  // Create and persist initial execution record
  const attempt = createExecutionAttempt(executionId, opportunity);
  saveExecution(attempt);
  logTransition(executionId, ExecutionStatus.VALIDATING, 'Passed risk checks — dispatching');

  // Respond 202 immediately — execution is async (fire-and-forget)
  reply.code(202).send({
    execution_id: executionId,
    status: 'ACCEPTED',
    dedup: { is_duplicate: false, key: dedupKey },
    deadline_seconds: Math.floor(config.executionDeadlineMs / 1000),
  });

  // Async execution — intentionally not awaited in the request lifecycle
  executeOpportunity(opportunity, executionId).catch((err) => {
    log.error(
      { execution_id: executionId, err: err.message },
      'Unhandled error in executor — check executionLogService'
    );
  });
}
