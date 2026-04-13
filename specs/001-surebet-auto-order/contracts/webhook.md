# Contracts: Webhook Interface

## POST /api/v1/surebets/webhook

Ingests a surebet opportunity from the upstream system.

### Request Body (JSON)

```json
{
  "opportunity_id": "opp_12345abc",
  "match_id": "match_8899",
  "market": "OU",
  "line": "2.5",
  "updated_at": "2026-04-12T15:00:00Z",
  "profit_pct_expected": 3.42,
  "legs": [
    {
      "bookmaker": "saba",
      "selection": "Over",
      "odds": 2.10,
      "stake_proposed": 100.0
    },
    {
      "bookmaker": "x1",
      "selection": "Under",
      "odds": 1.95,
      "stake_proposed": 107.69
    }
  ]
}
```

### Responses

- **202 Accepted**: Webhook received successfully, execution started asynchronously.
- **400 Bad Request**: Invalid body schema.
- **422 Unprocessable Entity**: Valid schema, but rejected due to stale timestamp or empty opportunity ID.

---
*(Note: Execution results are stored internally and logged/alerted. This webhook acts as a fire-and-forget trigger for the upstream)*
