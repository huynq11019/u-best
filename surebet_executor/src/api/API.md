# Surebet Executor API Documentation

## Overview

This API provides endpoints for fetching odds, events, and placing bets through various bookmaker adapters. All endpoints require authentication via browser pool management and use a consistent response structure.

## Base URL

```
/api
```

## Authentication

All endpoints use browser pool management internally. Pages are automatically acquired from and released to the pool for each request.

---

## Endpoints

### 1. Get Active Odds

Fetch active odds from a specific bookmaker.

**Endpoint:** `GET /api/odds/:bookmakerKey`

**Description:** Lấy danh sách kèo đang có (active odds) từ một nhà cái (bookmaker).

#### Path Parameters

| Parameter | Type   | Required | Description                      |
|-----------|--------|----------|----------------------------------|
| bookmakerKey | string | Yes      | The key identifier for the bookmaker adapter (e.g., `x1`) |

#### Query Parameters

| Parameter | Type   | Required | Default | Description                              |
|-----------|--------|----------|---------|------------------------------------------|
| sport     | string | No       | `football` | The sport type to filter odds (e.g., `football`, `basketball`) |
| marketType | string | No       | -       | Filter by market type (e.g., `OU`, `AH`, `1X2`) |

#### Response (200 OK)

```json
{
  "status": "success",
  "bookmakerKey": "x1",
  "sport": "football",
  "count": 15,
  "data": [
    {
      "eventId": "714350696",
      "homeTeam": "Team A",
      "awayTeam": "Team B",
      "marketType": "OU",
      "selection": "Over 2.5",
      "odds": 1.85,
      "line": 2.5,
      "kind": 1,
      "lastUpdated": "2026-04-26T10:00:00Z"
    }
  ]
}
```

#### Error Responses

| Status | Error | Description |
|--------|-------|-------------|
| 404 | Not Found | Bookmaker adapter is not registered |
| 500 | Internal Server Error | Failed to fetch odds from adapter |

---

### 2. Get Events

Fetch all events (matches) with their odds from a specific bookmaker.

**Endpoint:** `GET /api/:bookmakerKey/events`

**Description:** Lấy danh sách trận đấu đang có từ một nhà cái, mỗi trận bao gồm đầy đủ các kèo.

#### Path Parameters

| Parameter | Type   | Required | Description                      |
|-----------|--------|----------|----------------------------------|
| bookmakerKey | string | Yes      | The key identifier for the bookmaker adapter |

#### Query Parameters

| Parameter | Type   | Required | Default | Description                              |
|-----------|--------|----------|---------|------------------------------------------|
| sport     | string | No       | `football` | The sport type to filter events |
| marketType | string | No       | -       | Filter events by market type (only returns events with matching markets) |

#### Response (200 OK)

```json
{
  "status": "success",
  "bookmakerKey": "x1",
  "sport": "football",
  "count": 5,
  "events": [
    {
      "eventId": "714350696",
      "homeTeam": "Team A",
      "awayTeam": "Team B",
      "startTime": "2026-04-26T15:00:00Z",
      "league": "Premier League",
      "markets": [
        {
          "marketType": "OU",
          "selection": "Over 2.5",
          "odds": 1.85,
          "line": 2.5,
          "kind": 1
        },
        {
          "marketType": "AH",
          "selection": "Handicap -1.0",
          "odds": 1.90,
          "line": -1.0,
          "kind": 1
        }
      ]
    }
  ]
}
```

#### Error Responses

| Status | Error | Description |
|--------|-------|-------------|
| 404 | Not Found | Bookmaker adapter is not registered |
| 500 | Internal Server Error | Failed to fetch events from adapter |

---

### 3. Place Bet

Place a bet on a specific event through a bookmaker adapter.

**Endpoint:** `POST /api/:bookmakerKey/bets`

**Description:** Đặt cược trực tiếp qua adapter của nhà cái tương ứng.

#### Path Parameters

| Parameter | Type   | Required | Description                      |
|-----------|--------|----------|----------------------------------|
| bookmakerKey | string | Yes      | The key identifier for the bookmaker adapter |

#### Request Body (JSON)

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| gameId | number | Yes | - | Event ID (trận đấu) - x1: ID sau dấu `-` trong eventId |
| type | number | Yes | - | Selection Type T from GetGameZip (có thể là string "Over"/"Under" khi gửi từ webhook) |
| selectionType | number | No | - | Override type T (9=Over, 10=Under, 7=Home, 8=Away) |
| odds | number | Yes | - | Odds at placement time (must be > 1) |
| stake | number | Yes | - | Bet amount (must be > 0) |
| line | number | No | 0 | Handicap / Over/Under line (e.g. 6.5) |
| kind | number | No | 1 | Selection kind: 1=Over/Home/Yes, 2=Under/Away/No |
| leagueId | string | No | - | League ID for building Referer URL (x1: phần trước dấu `-`) |
| home | string | No | - | Home team name |
| away | string | No | - | Away team name |
| sportPath | string | No | `football` | Sport path in URL |

#### Request Example

**Ví dụ 1: Đặt Xỉu (Under) 5.5 @1.09**
```json
{
  "gameId": 714350696,
  "type": 10,
  "odds": 1.09,
  "stake": 20000,
  "line": 5.5,
  "kind": 2,
  "leagueId": "2740174",
  "home": "Team A",
  "away": "Team B",
  "sportPath": "football"
}
```

**Ví dụ 2: Đặt Tài (Over) 6.5 @14.7 (dùng selectionType)**
```json
{
  "gameId": 716119524,
  "type": 9,
  "selectionType": 9,
  "odds": 14.7,
  "stake": 10000,
  "line": 6.5,
  "kind": 1,
  "leagueId": "118663",
  "home": "Estrela da Amadora",
  "away": "Porto"
}
```

#### Type T Mapping (x1)

| Selection | type/selectionType | kind |
|-----------|------------------|------|
| Over | 9 | 1 |
| Under | 10 | 2 |
| Home | 1 hoặc 7 | 1 |
| Away | 3 hoặc 8 | 2 |
| Draw | 2 | - |

**Lưu ý:** `type` có thể là string `"Over"|"Under"` khi gửi từ webhook - adapter sẽ tự động map sang số T.

#### Response (200 OK)

```json
{
  "status": "success",
  "bookmakerKey": "x1",
  "order_ref": "80833384253",
  "placed_odds": 1.09,
  "placed_stake": 20000,
  "balance_after": 30000,
  "placed_at": "2026-04-24T10:01:13.753Z",
  "odds_changed": false,
  "line_changed": false
}
```

#### Error Responses

| Status | Error | Description |
|--------|-------|-------------|
| 400 | Bad Request | Invalid request parameters (validation error) |
| 404 | Not Found | Bookmaker adapter is not registered |
| 401 | Unauthorized | Adapter does not support bet placement (501) |
| 500 | Internal Server Error | Failed to place bet via adapter |

---

### 3b. Place Bet by Selection ID (Simplified)

Place a bet using cached selection IDs from `GET /api/:bookmakerKey/events/:eventId`. This is the recommended approach - no need to pass complex market data.

**Endpoint:** `POST /api/:bookmakerKey/bets/by-selection`

**Description:** Đặt cược bằng selection ID đã cache - chỉ cần `eventId`, `selectionId`, và `stake`. Thông tin kèo (odds, line, type) tự động lookup từ cache.

**Prerequisites:**
1. Gọi `GET /api/:bookmakerKey/events/:eventId` trước để populate cache với IDs
2. Response sẽ chứa `selection.id` cho mỗi option/line

#### Request Body (JSON)

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| eventId | string | Yes | - | Event ID (cùng format với getEventOdds) |
| selectionId | string | Yes | - | Selection ID từ cached odds (vd: `2740174-714342170_OU_line_0`) |
| stake | number | Yes | - | Bet amount (must be > 0) |
| expectedOdds | number | No | - | Validate odds chưa drift quá nhiều |
| oddsDriftThreshold | number | No | 0.05 | Ngưỡng chấp nhận odds drift (5% = 0.05) |

#### Request Example

**Đặt Tài (Over) 2.5 @1.85 - chỉ dùng selectionId**
```json
{
  "eventId": "2740174-714342170",
  "selectionId": "2740174-714342170_OU_line_0",
  "stake": 100000,
  "expectedOdds": 1.85,
  "oddsDriftThreshold": 0.03
}
```

#### Response (200 OK)

Giống như placeBet thông thường:

```json
{
  "status": "success",
  "bookmakerKey": "x1",
  "order_ref": "123456789",
  "placed_odds": 1.85,
  "placed_stake": 100000,
  "balance_after": 500000,
  "placed_at": "2026-04-27T10:30:00Z",
  "odds_changed": false,
  "line_changed": false
}
```

#### Error Responses

| Status | Error | Description |
|--------|-------|-------------|
| 400 | Cache Miss | Chưa gọi getEventOdds để cache - cần query trước |
| 400 | Selection Not Found | selectionId không tồn tại trong cached data |
| 409 | Odds Drifted | Odds thay đổi vượt quá oddsDriftThreshold |
| 422 | Validation Error | stake <= 0 hoặc missing required fields |

---

### 4. Get Event Details

Fetch detailed odds for a specific event from a bookmaker.

**Endpoint:** `GET /api/:bookmakerKey/events/:eventId`

**Description:** Lấy chi tiết các kèo của một trận đấu dựa vào eventId từ một nhà cái.

#### Path Parameters

| Parameter | Type   | Required | Description                      |
|-----------|--------|----------|----------------------------------|
| bookmakerKey | string | Yes      | The key identifier for the bookmaker adapter |
| eventId | string | Yes      | The event ID to fetch details for |

#### Query Parameters

| Parameter | Type   | Required | Default | Description                              |
|-----------|--------|----------|---------|------------------------------------------|
| sport     | string | No       | `football` | The sport type |
| marketType | string | No       | -       | Filter markets by type |

#### Response (200 OK)

```json
{
  "status": "success",
  "bookmakerKey": "x1",
  "sport": "football",
  "event": {
    "eventId": "2740174-714350696",
    "home": "Team A",
    "away": "Team B",
    "leagueId": "2740174",
    "league": "Premier League",
    "startTime": "15:00",
    "scope": "live",
    "markets": [
      {
        "marketType": "OU",
        "marketName": "Tài xỉu",
        "hasLines": true,
        "lines": [
          {
            "id": "2740174-714350696_OU_line_0",
            "line": 2.5,
            "selectionA": "Over",
            "oddsA": 1.85,
            "selectionB": "Under",
            "oddsB": 1.95
          },
          {
            "id": "2740174-714350696_OU_line_1",
            "line": 3.0,
            "selectionA": "Over",
            "oddsA": 2.10,
            "selectionB": "Under",
            "oddsB": 1.75
          }
        ]
      },
      {
        "marketType": "1X2",
        "marketName": "Chung cuộc",
        "hasLines": false,
        "options": [
          {
            "id": "2740174-714350696_1X2_opt_0",
            "selection": "Home",
            "odds": 1.90,
            "line": null
          },
          {
            "id": "2740174-714350696_1X2_opt_1",
            "selection": "Draw",
            "odds": 3.40,
            "line": null
          },
          {
            "id": "2740174-714350696_1X2_opt_2",
            "selection": "Away",
            "odds": 4.20,
            "line": null
          }
        ]
      }
    ]
  }
}
```

**Lưu ý:** Mỗi `line` và `option` giờ có `id` duy nhất. Dùng `id` này làm `selectionId` khi đặt cược qua `POST /api/:bookmakerKey/bets/by-selection`.

#### Error Responses

| Status | Error | Description |
|--------|-------|-------------|
| 404 | Not Found | Bookmaker adapter is not registered or event not found |
| 500 | Internal Server Error | Failed to fetch event details |

---

## Common Response Fields

### Success Response Structure

All successful responses follow this structure:

```json
{
  "status": "success",
  "bookmakerKey": "x1",
  "sport": "football"
}
```

### Bet Placement Response Fields

| Field | Type | Description |
|-------|------|-------------|
| status | string | Always "success" |
| bookmakerKey | string | The bookmaker adapter key |
| order_ref | string | Order reference number from bookmaker |
| placed_odds | number | Odds at time of placement |
| placed_stake | number | Amount placed |
| balance_after | number \| null | Account balance after bet |
| placed_at | string \| null | ISO 8601 timestamp of placement |
| odds_changed | boolean | Whether odds changed after placement |
| line_changed | boolean | Whether line changed after placement |

---

## Error Handling

### 404 Not Found

Returned when the bookmaker adapter is not registered:

```json
{
  "error": "Not Found",
  "message": "Bookmaker adapter \"unknown\" is not registered."
}
```

### 400 Bad Request

Returned for invalid request parameters:

```json
{
  "error": "Bad Request",
  "message": "Validation error message"
}
```

### 500 Internal Server Error

Returned when adapter fails to fetch or place data:

```json
{
  "error": "Internal Server Error",
  "message": "Error message from adapter"
}
```

### 501 Not Implemented

Returned when adapter doesn't support bet placement:

```json
{
  "error": "Not Implemented",
  "message": "Adapter \"x1\" does not support bet placement."
}
```

---

## 5. Surebet Webhook

Receive surebet opportunity and automatically execute bets via adapters.

**Endpoint:** `POST /webhooks/surebet`

**Description:** Nhận tín hiệu surebet từ odds_aggregator và tự động đặt cược qua các adapter.

#### Request Body (JSON)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| sport | string | Yes | Sport type: `football` |
| market | string | Yes | Market type: `OU` |
| scope | string | Yes | Match scope: `FT` (Full Time) |
| home | string | Yes | Home team name |
| away | string | Yes | Away team name |
| from_books | string | Yes | Bookmakers pair: `x1+saba` |
| line | number | Yes | The OU line (e.g. 6.5) |
| updated_at | string | Yes | ISO 8601 timestamp |
| bet | object | Yes | Bet configuration |
| bet.total_stake | number | Yes | Total stake amount |
| bet.profit_pct_calc | number | Yes | Calculated profit % |
| bet.payout_equal | number | Yes | Expected payout |
| bet.legs | array | Yes | Array of 2 BetLeg objects |

#### BetLeg Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| book | string | Yes | Bookmaker key: `x1` hoặc `saba` |
| type | string | Yes | Selection: `Over` hoặc `Under` |
| odds | number | Yes | Odds for this leg |
| stake | number | Yes | Stake amount for this leg |
| label | string | Yes | Display label |
| **gameId** | number | No* | x1: Game ID (eventId sau dấu `-`) |
| **selectionType** | number | No* | x1: T number (9=Over, 10=Under) |
| **line** | number | No* | OU line (e.g. 6.5) |
| **kind** | number | No* | 1=Over/Home, 2=Under/Away |
| **leagueId** | string | No* | x1: League ID (trước dấu `-` trong eventId) |

> *Required cho x1 adapter để place bet thành công

#### Request Example

```json
{
  "sport": "football",
  "market": "OU",
  "scope": "FT",
  "home": "Estrela da Amadora",
  "away": "Porto",
  "from_books": "x1+saba",
  "line": 6.5,
  "updated_at": "2026-04-27T00:00:00.000Z",
  "bet": {
    "total_stake": 20000,
    "profit_pct_calc": 2.5,
    "payout_equal": 20500,
    "legs": [
      {
        "book": "x1",
        "type": "Over",
        "odds": 14.7,
        "stake": 10000,
        "label": "x1 Over 6.5",
        "gameId": 716119524,
        "selectionType": 9,
        "line": 6.5,
        "kind": 1,
        "leagueId": "118663"
      },
      {
        "book": "saba",
        "type": "Under",
        "odds": 1.02,
        "stake": 10000,
        "label": "saba Under 6.5",
        "line": 6.5
      }
    ]
  }
}
```

#### Response (202 Accepted)

```json
{
  "execution_id": "uuid-v4",
  "status": "ACCEPTED",
  "dedup": {
    "is_duplicate": false,
    "key": "surebet-key-hash"
  },
  "deadline_seconds": 20
}
```

#### Error Responses

| Status | Error | Description |
|--------|-------|-------------|
| 409 | DUPLICATE_OPPORTUNITY | Opportunity already being processed |
| 422 | VALIDATION_ERROR | Risk validation failed |

---

## Rate Limiting & Browser Pool

All endpoints use the browser pool system:

1. **acquirePage**: Acquires a browser page from the pool (may wait if pool is exhausted)
2. **releasePage**: Returns the page to the pool after request completion

Pages are automatically managed regardless of success or failure.

---

## Adapter Requirements

Each bookmaker adapter must implement:

| Method | Description |
|--------|-------------|
| `getActiveOdds(page, sportType)` | Fetch active odds for a sport |
| `getEvents(page, sportType)` | Fetch all events with markets |
| `getEventOdds(page, eventId, sportType)` | Fetch details for a specific event |
| `placeBet(page, leg)` | Place a bet (optional - not all adapters need this) |
| `_buildEventPayload(leg)` | Build MakeBetWeb/UpdateCoupon payload (x1 adapter) |

---

## Notes

- Default sport is `football` if not specified
- Market types are case-insensitive (converted to uppercase internally)
- All timestamps are in ISO 8601 format
- Bet placement requires adapter support (501 if not implemented)

### x1 Adapter Specifics

**EventId parsing:** `118663-716119524` → `leagueId=118663`, `gameId=716119524`

**String type mapping:** Adapter tự động map các string sau sang T number:
- `"Over"` → `9` (kind=1)
- `"Under"` → `10` (kind=2)  
- `"Home"` → `1` hoặc `7` (kind=1)
- `"Away"` → `3` hoặc `8` (kind=2)
- `"Yes"` → `180`, `"No"` → `181`

**SelectionType override:** Nếu muốn gửi T number trực tiếp, dùng `selectionType` field.
