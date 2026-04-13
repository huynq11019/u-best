# Tasks: Auto Surebet Order Execution

**Input**: Design documents from `/specs/001-surebet-auto-order/`  
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/, quickstart.md

**Tests**: No explicit TDD/test-first requirement was requested in the feature spec, so test tasks are not expanded in this list.

**Organization**: Tasks are grouped by user story so each story can be implemented and validated independently.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the module skeleton, baseline configuration, and headless browser foundations needed by all stories.

- [x] T001 Initialize Node.js project and install core dependencies (`fastify`, `pino`, `undici`, `ioredis`) in `surebet_executor/package.json`
- [x] T002 Install Playwright and pooling dependencies (`playwright`, `generic-pool`) in `surebet_executor/package.json`
- [x] T003 Implement base configuration loader (Redis URL, Port, Bookie Credentials) in `surebet_executor/src/config/index.js`
- [x] T004 Implement structured logger using Pino in `surebet_executor/src/config/logger.js`
- [x] T005 Initialize Redis client singleton for shared locking/dedupe in `surebet_executor/src/config/redis.js`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build core primitives, adapter interfaces, and the browser pool manager.

**CRITICAL**: User story implementation starts only after this phase is complete.

- [x] T006 Implement Domain Entities (`SurebetOpportunity`, `ExecutionAttempt`, `LegExecutionResult`) and State enums in `surebet_executor/src/models/index.js`
- [x] T007 Implement Playwright Context Pool manager (`generic-pool` factory for launching and warming browser contexts) in `surebet_executor/src/services/browserPool.js`
- [x] T008 Implement base Bookmaker Adapter interface (methods for `login`, `warmUp`, `placeBet`, `hedgeLeg`) in `surebet_executor/src/adapters/baseAdapter.js`
- [x] T009 Implement Adapter Registry to dynamically load and route requests to `src/adapters/` in `surebet_executor/src/services/adapterRegistry.js`
- [x] T010 Implement execution state persistence helper (logging state transitions) in `surebet_executor/src/services/executionLogService.js`
- [x] T011 Create application entrypoint starting Fastify server and initializing Browser Pools in `surebet_executor/src/index.js`

**Checkpoint**: Foundation ready; user stories can now proceed.

---

## Phase 3: User Story 1 - Execute Qualified Surebet Quickly (Priority: P1) 🎯 MVP

**Goal**: Accept valid webhook opportunities and complete two-leg placement concurrently under 20 seconds using pre-warmed browsers.

**Independent Test**: Send a valid surebet OU webhook payload and verify terminal success with two placed legs within SLA.

### Implementation for User Story 1

- [x] T012 [P] [US1] Implement webhook payload schema validator in `surebet_executor/src/webhooks/schemas.js`
- [x] T013 [P] [US1] Expose `POST /api/v1/surebets/webhook` Fastify route returning 202/400/422 in `surebet_executor/src/webhooks/routes.js`
- [x] T014 [P] [US1] Implement Saba UI Adapter (`login()`, `warmUp()`, `placeBet()`) in `surebet_executor/src/adapters/sabaAdapter.js`
- [x] T015 [P] [US1] Implement 1xBet UI Adapter (`login()`, `warmUp()`, `placeBet()`) in `surebet_executor/src/adapters/x1Adapter.js`
- [x] T016 [US1] Implement deduplication helper (Redlock/SETNX logic) for opportunity ID in `surebet_executor/src/services/dedupeService.js`
- [x] T017 [US1] Implement parallel Executor mapping legs to `adapterRegistry.get(leg.bookmaker).placeBet(leg)` wrapped in `Promise.allSettled` in `surebet_executor/src/services/executorService.js`
- [x] T018 [US1] Wire dedupe check -> executor pipeline in `surebet_executor/src/webhooks/handlers.js`

**Checkpoint**: US1 is independently functional and delivers MVP value.

---

## Phase 4: User Story 2 - Protect Capital With Trading Rules (Priority: P2)

**Goal**: Apply risk governance before execution and reject unsafe opportunities with clear reasons.

**Independent Test**: Submit opportunities violating stake, balance, pair allowlist, stale window, or min-profit rules and verify deterministic rejection.

### Implementation for User Story 2

- [x] T019 [P] [US2] Implement risk policy definitions (min profit, allowed pairs, staleness) in `surebet_executor/src/config/riskPolicy.js`
- [x] T020 [P] [US2] Implement Risk Evaluation service (`validateOpportunity`) in `surebet_executor/src/services/riskService.js`
- [x] T021 [US2] Integrate `riskService.validateOpportunity` into webhook handler before pushing to executor in `surebet_executor/src/webhooks/handlers.js`
- [x] T022 [US2] Implement base Alert dispatcher placeholder in `surebet_executor/src/services/alertService.js`
- [x] T023 [US2] Implement alert emission on validation rejection (e.g., failed min profit) in `surebet_executor/src/services/alertService.js`

**Checkpoint**: US2 is independently functional with policy enforcement.

---

## Phase 5: User Story 3 - Track And Recover Failed Executions (Priority: P3)

**Goal**: Provide full execution traceability and automated compensation for one-leg failures.

**Independent Test**: Trigger partial failure scenarios and verify compensation sequence hedge -> void -> manual required with full status visibility.

### Implementation for User Story 3

- [x] T024 [P] [US3] Implement `hedgeLeg(leg)` method for Saba and x1 in `surebet_executor/src/adapters/sabaAdapter.js` and `surebet_executor/src/adapters/x1Adapter.js`
- [x] T025 [P] [US3] Implement `voidLeg(leg)` method for Saba and x1 in `surebet_executor/src/adapters/sabaAdapter.js` and `surebet_executor/src/adapters/x1Adapter.js`
- [x] T026 [US3] Implement Orchestrator Saga logic: detect partial failure in `Promise.allSettled` results, trigger hedge, fallback to void in `surebet_executor/src/services/executorService.js`
- [x] T027 [US3] Log state transition to `MANUAL_INTERVENTION_REQUIRED` if compensation fails in `surebet_executor/src/services/executorService.js`
- [x] T028 [US3] Emit partial failure and manual intervention alerts using `alertService` in `surebet_executor/src/services/executorService.js`

**Checkpoint**: US3 is independently functional with transparent operations and recovery paths.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final alignment, docs consistency, and cross-story hardening.

- [x] T029 Update `surebet_executor/README.md` with final run instructions matching `quickstart.md`
- [x] T030 Ensure context pool handles page crashes and auto-reconnects gracefully in `surebet_executor/src/services/browserPool.js`
- [x] T031 Double-check all Error logs use Pino correctly in `surebet_executor/src/services/*.js`

---

## Dependencies & Execution Order

### Phase Dependencies

- Setup (Phase 1): no dependencies.
- Foundational (Phase 2): depends on Setup completion and blocks all user stories.
- User Stories (Phases 3-5): each depends on Foundational completion.
- Polish (Phase 6): depends on all selected user stories completion.

### Recommended Delivery Order

- MVP first: Phase 1 -> Phase 2 -> Phase 3 (US1).
- Incremental: add Phase 4 (US2), then Phase 5 (US3), then Phase 6.

---

## Parallel Opportunities

- Foundational: T006, T007, T008, T009 can run in parallel.
- US1: T012, T013, T014, T015 can run in parallel.
- US2: T019, T020 can run in parallel.
- US3: T024, T025 can run in parallel.

---

## Implementation Strategy

### MVP First (US1 only)

1. Complete Phase 1 and Phase 2.
2. Complete Phase 3 (US1).
3. Validate SLA and terminal states for webhook-driven concurrently placed legs using cURL or Postman.
4. Demo/deploy MVP before expanding scope.
