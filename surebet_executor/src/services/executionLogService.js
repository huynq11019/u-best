// T010 - Execution state persistence / audit log helper
import { childLogger } from '../config/logger.js';

const log = childLogger({ component: 'executionLogService' });

// In-memory store for MVP (replace with PostgreSQL for production)
const executions = new Map();

/**
 * Persist initial execution record
 * @param {Object} attempt - ExecutionAttempt object
 */
export function saveExecution(attempt) {
  executions.set(attempt.execution_id, { ...attempt });
  log.info(
    { execution_id: attempt.execution_id, status: attempt.status },
    'Execution record created'
  );
}

/**
 * Log a state transition and update the in-memory record
 * @param {string} executionId
 * @param {string} newStatus - ExecutionStatus value
 * @param {string} [reason]
 * @param {Object} [extra]  - Additional fields to merge into the record
 */
export function logTransition(executionId, newStatus, reason = null, extra = {}) {
  const existing = executions.get(executionId);
  if (!existing) {
    log.warn({ execution_id: executionId }, 'logTransition called for unknown execution');
    return;
  }

  const prevStatus = existing.status;
  const updated = {
    ...existing,
    ...extra,
    status: newStatus,
    status_reason: reason ?? existing.status_reason,
  };

  if (newStatus === 'COMPLETED' || newStatus === 'FAILED' || newStatus === 'MANUAL_INTERVENTION_REQUIRED') {
    updated.finished_at = new Date().toISOString();
    if (updated.started_at) {
      updated.total_latency_ms = Date.now() - new Date(updated.started_at).getTime();
    }
  }

  executions.set(executionId, updated);

  log.info(
    {
      execution_id: executionId,
      prev_status: prevStatus,
      new_status: newStatus,
      reason,
      total_latency_ms: updated.total_latency_ms,
    },
    'State transition'
  );
}

/**
 * Retrieve an execution record by ID
 * @param {string} executionId
 * @returns {Object|undefined}
 */
export function getExecution(executionId) {
  return executions.get(executionId);
}

/**
 * Return all stored executions (for admin/debug endpoints)
 * @returns {Object[]}
 */
export function listExecutions() {
  return Array.from(executions.values());
}
