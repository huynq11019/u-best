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
| `GET` | `/api/odds/:bookmakerKey` | Lấy danh sách flat tất cả các kèo đang active (Legacy) |
| `GET` | `/api/:bookmakerKey/events` | Lấy danh sách trận đấu đang có, mỗi trận chứa đầy đủ các kèo ([Detailed Guide](docs/api_events_guide.md)) |
| `GET` | `/api/:bookmakerKey/events/:eventId` | Lấy chi tiết các kèo của một trận đấu theo `eventId` |
| `POST` | `/webhooks/surebet/ou` | Ingest a surebet opportunity ([Detailed Guide](docs/webhook_guide.md)) |
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

## Adapter Enhancements

### Lu88 Adapter: OU Odds Extraction (April 2026)

The Lu88 adapter now extracts **all market types** (1X2, Asian Handicap, Over/Under) with standardized output format compatible with other adapters.

#### Features
- **Full market coverage**: Extracts 1X2, AH (Handicap), and OU (Over/Under) odds from a single frame evaluation
- **OU line detection**: Properly identifies Over/Under buttons by text label ("o"/"u"), extracts line values from `.c-text-goal` DOM elements
- **Standardized format**: Returns odds in consistent `ActiveOdd` structure with `marketType` and `selections[]` array:

```javascript
{
  eventId: "124545450",
  sport: "football",
  home: "Team A",
  away: "Team B",
  league: "League Name",
  marketType: "OU",  // "1X2" | "AH" | "OU"
  startTime: "03:00PM",
  selections: [
    { label: "Over",  odds: 0.82, line: 2.5 },
    { label: "Under", odds: 0.92, line: 2.5 }
  ],
  scope: "live"  // "live" | "prematch"
}
```

- **Adapter alignment**: Consistent with SABA and X1 adapters for downstream normalization and aggregation

#### Implementation Details
- **File**: `src/adapters/lu88Adapter.js` / `getActiveOdds()` method
- **DOM selectors**:
  - Match containers: `.c-match` elements (card-style layouts)
  - Odds buttons: `[data-odds-status]` within each match
  - Line values: `.c-text-goal` span (e.g., "2.5", "3.00")
  - Labels: `.c-text` span containing "o" (Over), "u" (Under), "H" (Home), "A" (Away), "1"/"2"/"x" (1X2)

#### Testing
```bash
# Test Lu88 adapter locally
node src/test_lu88.js

# Expected output format
# ✓ homeTeam vs awayTeam (League)
#   Over (line: 2.5): 0.82
#   Under (line: 2.5): 0.92
```

### X1 Adapter: 1X2 Odds Extraction

The X1 (1xBet) adapter extracts **1X2 (three-way)** odds from live sports pages with cheerio-based HTML parsing for reliability.

#### Features
- **1X2 market focus**: Extracts Home (1), Draw (X), Away (2) selections with odds values
- **Cheerio-based parsing**: Uses server-side HTML parsing (cheerio) instead of page evaluation for faster, more reliable DOM traversal
- **Live sport navigation**: Dynamically routes to sport-specific live pages (e.g., `/live/football`, `/live/basketball`)
- **Flexible DOM selectors**: Searches multiple selector alternatives to handle UI variations

#### Output Format
```javascript
{
  eventId: "game-12345",
  sport: "football",
  home: "Manchester United",
  away: "Liverpool",
  league: "Premier League",
  marketType: "1X2",
  startTime: "15:30",
  selections: [
    { label: "1", odds: 1.85 },
    { label: "X", odds: 3.20 },
    { label: "2", odds: 4.10 }
  ],
  scope: "live"
}
```

#### Implementation Details
- **File**: `src/adapters/x1Adapter.js` / `getActiveOdds()` method (lines 314–428)
- **Sport routing**: Maps `SportType` values to URL paths via `SPORT_URL_MAP` constant
- **DOM selectors** (with fallback chain):
  - Game blocks: `.dashboard-game`, `.dashboard-game-block`, `.dashboard-champ__game`
  - Team names: `.dashboard-game-team-info__name`, `.ui-team-score-name`, `.dashboard-game-block__team`
  - Markets: `.dashboard-markets__market`, `.ui-market`
  - Odds values: `.ui-market__value`, `[class*="coef"]`, `[class*="odd"]`
- **HTML dump**: Saves page HTML to `x1_live_dump.html` for debugging

#### Parsing Strategy
- Uses `cheerio.load(html)` for DOM traversal (faster than Playwright evaluation)
- Filters out invalid odds (< 1.0)
- Falls back to sequential labeling ("1", "X", "2") if explicit labels not found
- Gracefully skips malformed cards

#### Testing
```bash
# Test X1 adapter locally
node src/test_x1.js

# Expected output format
# ✓ Manchester United vs Liverpool (Premier League)
#   1: 1.85
#   X: 3.20
#   2: 4.10
```

#### Known Issues & Notes
- Live URL must use `/live` (not `/live/live`) to avoid redirect loops
- Logged-in session may hide `.auth-dropdown-trigger`; checks multiple auth indicators
- Some 1xBet pages redirect to `/user/accountverify` on login success (no visible error text)
- Profile lock on shared `CHROME_USER_DATA_DIR` can cause false failures; use dedicated automation profile

## Status

- [x] Phase 1: Setup (config, logger, Redis)
- [x] Phase 2: Foundation (models, browser pool, adapter registry, executor log)
- [x] Phase 3: US1 — Webhook ingestion + parallel placement (adapters need real selectors)
- [x] Phase 4: US2 — Risk policy enforcement
- [x] Phase 5: US3 — Saga compensation (hedge → void → manual)
- [x] Lu88 Adapter: OU odds extraction with standardized output format
- [x] X1 Adapter: 1X2 odds extraction with cheerio parsing
- [ ] Adapter UI selectors: Saba and 1xBet `placeBet()` need real implementation
