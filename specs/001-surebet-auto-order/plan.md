# Implementation Plan: Auto Surebet Order Execution

**Branch**: `001-setup-speckit-branch` | **Date**: 2026-04-12 | **Spec**: `/specs/001-surebet-auto-order/spec.md`
**Input**: trong khi chờ nhận thông báo kèo... mở sẵn các trang đặt lệnh... thực hiện song song việc đặt lệnh... dễ dàng mở rộng

## Summary

The feature automatically executes qualified surebet opportunities across multiple bookmakers within 20 seconds of receiving a webhook. It evaluates risk policies (like minimum profit, max stake, sufficient balance), prevents duplicate orders, and handles partial failures by hedging or voiding. 

To achieve latency goals, the system will pre-warm browser sessions (logging in and keeping pages open) during idle times. When a webhook arrives, it dispatches placement commands concurrently to a pool of prepared worker instances. The architecture is designed for modularity, allowing new bookmaker adapters to be plugged in seamlessly.

## Technical Context

**Language/Version**: Node.js (v18+ or v20 LTS)
**Primary Dependencies**: Fastify (for high-speed webhook ingestion), Axios/Undici (for API requests), Playwright/Puppeteer (for headless session warming if UI placement is used), Redis client.
**Storage**: Redis (for duplicate check and caching), PostgreSQL or equivalent (for persistent execution logs and audit trails)  
**Testing**: Jest or Vitest  
**Target Platform**: Linux server (Dockerized)
**Project Type**: Microservice / Workers
**Performance Goals**: <20s end-to-end execution time for both legs  
**Constraints**: High concurrency, idempotency (duplicate prevention window), fault-tolerance (partial failure recovery), robust browser pool lifecycle management.
**Scale/Scope**: Handling real-time surebet streams for MVP bookmakers (saba, x1) with easy extensibility for others.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

* I. Library-First: Ensure the matching/auto-order module is independently testable and documented.
* III. Test-First: Follow TDD principles. Implement clear acceptance scenarios outlined in the spec.
* V. Observability: Structured logging is required to track execution metrics and debug partial failures.

## Project Structure

### Documentation (this feature)

```text
specs/001-surebet-auto-order/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # decisions on Node.js architecture
├── data-model.md        # Entities, state transitions
├── quickstart.md        # Getting started guide
├── contracts/           # Webhook interfaces
└── tasks.md             # Tasks definition
```

### Source Code (repository root)

```text
surebet_executor/
├── src/
│   ├── config/          # Risk policies, thresholds, allowlists
│   ├── models/          # Domain entities
│   ├── services/        # Auto-order execution, Worker pools
│   ├── adapters/        # Pluggable bookmaker adapters (saba, x1, etc.)
│   ├── webhooks/        # Ingress for surebet opportunities
│   └── index.js         # Entrypoint
└── tests/
    ├── integration/
    └── unit/
```

**Structure Decision**: A new standalone Node.js microservice (`surebet_executor`) isolating the fast execution logic. Introduces an `adapters/` directory for extending bookie integrations and manages stateful worker pools inside `services/`.
