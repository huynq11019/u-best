# Research: Node.js Auto-Order Executor

## Technical Decisions

### Decision 1: Framework Choice
- **Decision**: Use Fastify for the webhook server.
- **Rationale**: The specification requires receiving webhooks and acting within < 20s total. Fastify provides the lowest overhead and highest throughput for JSON payloads in Node.js, ensuring the delay introduced by the ingestion framework is negligible compared to the network roundtrips to bookmakers.
- **Alternatives considered**: Express (widely used but slower overhead), native `http` module (too much boilerplate for routing/validation).

### Decision 2: Duplicate Prevention
- **Decision**: Use Redis with TTL and distributed locks.
- **Rationale**: Prevent duplicate order placements for the same `opportunity_id` or synthetic hash (match + market + line + from_books + odds) using atomic `SETNX` or Redlock.
- **Alternatives considered**: In-memory caching (would fail if deploying multiple worker instances), Database unique constraints (unnecessary disk I/O overhead).

### Decision 3: API Request Dispatching
- **Decision**: Use `undici` or `axios` with `Promise.allSettled`.
- **Rationale**: To execute two legs simultaneously, we need parallel asynchronous requests to bookmaker APIs. `Promise.allSettled` safely captures the success or failure of both independent legs before calculating the next state (hedge vs. void).
- **Alternatives considered**: Sequential execution (too slow, risks odds changing).

### Decision 4: Logging and Tracing
- **Decision**: Use `Pino` for structured logging.
- **Rationale**: Satisfies FR-009 and FR-011 for audit trails. JSON structured logging is fast and can be easily forwarded and queried to monitor partial errors and state transitions.

### Decision 5: Partial Failure Handling (Hedge & Void)
- **Decision**: Implement the Saga-like orchestration pattern internally.
- **Rationale**: If Leg 1 completes and Leg 2 fails, attempt a compensating transaction (hedge/void). This logic will be encapsulated defensively in the Executor Service block.

### Decision 6: Warm-up Strategy and Headless Browsing
- **Decision**: Use `Playwright` with a pre-warmed context pool (generic-pool).
- **Rationale**: To satisfy FR-014, the system cannot wait to open a browser and login when a surebet arrives. We will use a pool manager (like `generic-pool`) to maintain N active Playwright contexts/pages per bookmaker. These pages will handle login during idle time and remain on the standby landing page. When a webhook hits, the executor immediately borrows a warmed page from the pool, injects the bet, and places it.

### Decision 7: Extensible Adapter Pattern
- **Decision**: Define a base `BookmakerAdapter` and dynamically load adapters.
- **Rationale**: To satisfy FR-016, bookmaker specific logic (locators, API endpoints) will be isolated in `src/adapters/<bookie_name>.js`. The Executor Service will accept a registry of adapters. Running them concurrently (FR-015) is achieved by mapping over the requested legs and calling `adapter.execute(leg)` inside `Promise.allSettled`.
