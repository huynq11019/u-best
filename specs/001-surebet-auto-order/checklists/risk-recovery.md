# Risk-Recovery Checklist: Auto Surebet Order Execution

**Purpose**: Validate requirement quality for risk controls, failure handling, and recovery behavior before implementation
**Created**: 2026-04-12
**Feature**: [spec.md](../spec.md)

## Requirement Completeness

- [ ] CHK001 Are all pre-trade risk gates enumerated as distinct requirement outcomes with unique rejection reasons? [Completeness, Spec §FR-003, Spec §FR-004]
- [ ] CHK002 Does the spec define required behavior when profit_pct and profit_pct_calc disagree? [Gap]
- [ ] CHK003 Are manual-intervention entry criteria complete beyond void failure (for example adapter timeout, auth expiry, market lock)? [Completeness, Spec §FR-012, Edge Case]
- [ ] CHK004 Are alert channel and recipient requirements defined for each failure class? [Gap, Spec §FR-008]
- [ ] CHK005 Is retry-policy scope specified per stage and per leg with explicit limits? [Gap]

## Requirement Clarity

- [ ] CHK006 Is stale-window threshold quantified with exact unit and default value, not only descriptive wording? [Clarity, Spec §FR-002, Ambiguity]
- [ ] CHK007 Is "ngưỡng lỗ tối đa cấu hình" defined with explicit formula and denominator for loss percentage? [Clarity, Spec §FR-012, Ambiguity]
- [ ] CHK008 Is dedup-window anchor timestamp defined unambiguously (received_at vs updated_at)? [Clarity, Spec §FR-007, Ambiguity]
- [ ] CHK009 Are terms "lỗi một phần", "thất bại", and "chờ xử lý thủ công" mapped one-to-one to terminal states? [Clarity, Spec §FR-005]

## Requirement Consistency

- [ ] CHK010 Do FR-006 latency requirements and SC-001 measurement denominator use the same eligible-opportunity definition? [Consistency, Spec §FR-006, Spec §SC-001]
- [ ] CHK011 Do FR-013 allowlist defaults and examples in contracts/quickstart use identical bookmaker keys and pair format? [Consistency, Spec §FR-013]
- [ ] CHK012 Are compensation steps consistent across Clarifications, Edge Cases, and FR-012 without ordering conflict? [Consistency, Spec §FR-012]
- [ ] CHK013 Do rejection outcomes in FR-003/FR-004/FR-007 align with error response semantics in contract responses 409 and 422? [Consistency, Spec §FR-003, Spec §FR-004, Spec §FR-007]

## Acceptance Criteria Quality

- [ ] CHK014 Can each rejection path be objectively validated by required response fields and reason code taxonomy? [Acceptance Criteria, Spec §FR-003, Spec §FR-004]
- [ ] CHK015 Is SC-003 measurable by explicit timestamp pair definition (detected_at and emitted_at)? [Measurability, Spec §SC-003, Gap]
- [ ] CHK016 Is SC-004 measurable with explicit tolerance for false positives and false negatives in dedup decisions? [Measurability, Spec §SC-004, Gap]

## Scenario Coverage

- [ ] CHK017 Are requirements complete for primary execution flow accept -> validate -> place leg1 -> place leg2 -> completed? [Coverage, Spec §FR-005]
- [ ] CHK018 Are alternate-flow requirements defined when odds drift after intake but before leg placement? [Coverage, Gap]
- [ ] CHK019 Are exception-flow requirements defined for adapter authentication expiry during execution? [Coverage, Edge Case]
- [ ] CHK020 Are recovery-flow requirements complete for hedge success, hedge failure, void success, and void failure? [Coverage, Spec §FR-012]
- [ ] CHK021 Are non-qualification flows (wrong pair, stale, low profit) explicitly defined as terminal non-execution outcomes? [Coverage, Spec §FR-002, Spec §FR-003, Spec §FR-013]

## Edge Case Coverage

- [ ] CHK022 Is dedup behavior defined for missing opportunity_id plus odds-format normalization differences? [Edge Case, Spec §FR-007, Gap]
- [ ] CHK023 Is behavior specified when bookmaker accepts only partial stake on one leg? [Edge Case, Gap]
- [ ] CHK024 Is behavior specified for out-of-order webhook deliveries of the same opportunity lineage? [Edge Case, Gap]
- [ ] CHK025 Is behavior specified when execution deadline is reached during compensation stage? [Edge Case, Spec §FR-006, Spec §FR-012]

## Non-Functional Requirements

- [ ] CHK026 Are latency budgets allocated per stage (validation, placement, compensation, persistence, alerting) instead of only global 20s? [Non-Functional, Spec §FR-006, Gap]
- [ ] CHK027 Are availability and fallback requirements defined for Redis outages affecting dedup/state tracking? [Non-Functional, Gap]
- [ ] CHK028 Are audit observability requirements explicit for mandatory timeline fields and retention behavior? [Non-Functional, Spec §FR-009]
- [ ] CHK029 Are webhook authenticity and replay-protection requirements specified for inbound opportunity messages? [Non-Functional, Gap]

## Dependencies & Assumptions

- [ ] CHK030 Are assumptions about upstream payload stability and bookmaker sessions converted into explicit dependency requirements? [Assumption, Spec §Assumptions, Gap]
- [ ] CHK031 Is clock synchronization and drift tolerance defined for stale checks and SLA measurements? [Dependency, Spec §FR-002, Spec §FR-006, Gap]
- [ ] CHK032 Are external dependency failure modes (bookmaker UI downtime, captcha, session invalidation) mapped to required outcomes? [Dependency, Gap]

## Ambiguities & Conflicts

- [ ] CHK033 Does the spec resolve conflict risk between global min-profit 3% and runtime slippage at execution time? [Conflict, Spec §FR-003]
- [ ] CHK034 Is "thành công đủ cặp" unambiguously defined when accepted odds or stake differ from requested values? [Ambiguity, Spec §FR-005]
- [ ] CHK035 Is a requirement-to-contract traceability map defined for FR-001..FR-013 and SC-001..SC-005? [Traceability, Gap]

## Notes

- This checklist is optimized for release-gate review by QA/PM.
- Focus is limited to risk controls, recovery behavior, and requirement traceability quality.
