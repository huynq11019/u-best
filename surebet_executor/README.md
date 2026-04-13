# surebet_executor

Standalone Node.js microservice for automated surebet order execution.

## Overview

Receives surebet opportunities via webhook, validates them against risk policies, and concurrently places bets on two bookmakers using pre-warmed Playwright browser sessions — all within a 20-second SLA.

## Architecture

```
POST /webhooks/surebet/ou
        │
        ▼
  DedupeService (Redis SETNX)
        │
        ▼
   RiskService (staleness, profit, allowlist, stake)
        │
        ▼
  ExecutorService ────────── Promise.allSettled ──────────
        │                     │                           │
        │               leg[0] (saba)               leg[1] (x1)
        │          acquirePage(pool) →             acquirePage(pool) →
        │          adapter.placeBet()              adapter.placeBet()
        │                     │                           │
        └──────── Saga: hedge → void → MANUAL_REQUIRED ──┘
```

## Prerequisites

- Node.js >= 18 (v20 LTS recommended)
- Redis (for deduplication + locking)
- Playwright Chromium (`npx playwright install chromium`)

## Setup

```bash
cp .env.example .env
# Fill in SABA_USERNAME, SABA_PASSWORD, X1_USERNAME, X1_PASSWORD

npm install
npx playwright install chromium
```

## Running

```bash
# Development (with hot-reload)
npm run dev

# Production
npm start
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhooks/surebet/ou` | Ingest a surebet opportunity |
| `GET` | `/auto-order/executions/:id` | Check execution status |
| `GET` | `/health` | Health check |

## Testing Webhook

```bash
curl -X POST http://localhost:3000/webhooks/surebet/ou \
  -H 'Content-Type: application/json' \
  -d '{
    "opportunity_id": "test_001",
    "sport": "football",
    "market": "OU",
    "scope": "FT",
    "home": "Team A",
    "away": "Team B",
    "from_books": "saba+x1",
    "line": 2.5,
    "profit_pct": 3.5,
    "updated_at": "2026-04-12T15:00:00Z",
    "bet": {
      "total_stake": 200,
      "profit_pct_calc": 3.5,
      "payout_equal": 207,
      "legs": [
        { "type": "Over", "odds": 1.95, "book": "saba", "stake": 100, "label": "OU 2.5 Over @saba" },
        { "type": "Under", "odds": 2.10, "book": "x1", "stake": 100, "label": "OU 2.5 Under @x1" }
      ]
    }
  }'
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
| `MVP_MIN_PROFIT_PCT` | `3.0` | Minimum profit % to accept |
| `STALE_WINDOW_MS` | `5000` | Max age of opportunity in ms |
| `DEDUP_TTL_SECONDS` | `300` | Dedup window in seconds |
| `EXECUTION_DEADLINE_MS` | `20000` | Max end-to-end time in ms |
| `MAX_STAKE_PER_LEG` | `1000` | Max stake per bookmaker leg |
| `ALLOWED_BOOKMAKERS` | `saba,x1` | Comma-separated allowlist |
| `BROWSER_HEADLESS` | `true` | Run browsers headless |
| `BROWSER_POOL_MIN` | `1` | Min warmed pages per bookie |
| `BROWSER_POOL_MAX` | `2` | Max warmed pages per bookie |

## Extending Bookmakers

1. Create `src/adapters/<bookmakerKey>Adapter.js` extending `BaseAdapter`
2. Implement `login()`, `warmUp()`, `placeBet()`, `hedgeLeg()`, `voidLeg()`
3. Add the key to `ALLOWED_BOOKMAKERS` env var
4. Register the import in `adapterRegistry.js` `loadBuiltInAdapters()`

## Status

- [x] Phase 1: Setup (config, logger, Redis)
- [x] Phase 2: Foundation (models, browser pool, adapter registry, executor log)
- [x] Phase 3: US1 — Webhook ingestion + parallel placement (adapters need real selectors)
- [x] Phase 4: US2 — Risk policy enforcement
- [x] Phase 5: US3 — Saga compensation (hedge → void → manual)
- [ ] Adapter UI selectors: Saba and 1xBet `placeBet()` need real implementation
