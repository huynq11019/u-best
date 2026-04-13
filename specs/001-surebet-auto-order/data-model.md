# Data Model: Auto Surebet Order Execution

## Entities

### Surebet Opportunity
Represents a received surebet signal.

- `opportunity_id` (String): Unique identifier from upstream.
- `match_id` (String): Identifier for the football match.
- `market` (String): Betting market (e.g., OU - Over/Under).
- `line` (String): The handicap or line value.
- `updated_at` (DateTime): Signal timestamp.
- `profit_pct_expected` (Float): Expected profit percentage.
- `legs`: Array of 2 `BetLeg` definitions.

### Bet Leg Definition
- `bookmaker` (String): Bookmaker identifier (e.g., "saba", "x1").
- `selection` (String): "Over" or "Under".
- `odds` (Float): Required odds.
- `stake_proposed` (Float): The suggested stake.

### Execution Attempt
State tracking for the operation.

- `execution_id` (String, UUID): Unique ID for the attempt.
- `opportunity_id` (String): Foreign key to the opportunity.
- `status` (Enum): `PENDING`, `VALIDATING`, `EXECUTING`, `COMPLETED`, `PARTIAL_ERROR`, `FAILED`, `MANUAL_INTERVENTION_REQUIRED`.
- `start_time` (DateTime)
- `end_time` (DateTime, optional)
- `leg_executions`: Array of `LegExecutionResult`.

### Leg Execution Result
- `bookmaker` (String)
- `status` (Enum): `PENDING`, `SUCCESS`, `REJECTED`, `HEDGED`, `VOIDED`.
- `order_id` (String): Upstream order ID if successful.
- `actual_odds` (Float): The odds logged upon placement.
- `actual_stake` (Float)
- `error_message` (String, optional)

### Risk Policy
Configurations enforced during the validation phase.

- `min_profit_pct` (Float): Default 3.0%.
- `max_stake_per_leg` (Float).
- `allowed_bookmakers` (Array): Default `["saba", "x1"]`.
- `stale_opportunity_threshold_ms` (Integer): e.g., 5000ms.

## State Transitions
1. `PENDING` -> `VALIDATING` (Checks freshness, pairs allowed, rules).
2. `VALIDATING` -> `EXECUTING` (Locks acquired, requests dispatched).
3. `EXECUTING` -> `COMPLETED` (Both legs succeed).
4. `EXECUTING` -> `PARTIAL_ERROR` (One succeeds, one fails -> Try hedge/void).
   - If hedge/void succeeds -> remains `PARTIAL_ERROR` but marked resolved.
   - If hedge/void fails -> `MANUAL_INTERVENTION_REQUIRED` (FR-012).
5. `VALIDATING` -> `FAILED` (Failed risk checks).
