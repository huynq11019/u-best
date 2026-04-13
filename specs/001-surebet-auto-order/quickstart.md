# Quickstart: Auto Surebet Order Execution Module

## Overview
This is a standalone Node.js microservice (`surebet_executor`) responsible for processing surebet opportunities via a webhook and automatically executing the bets on the respective bookmakers.

## Prerequisites
- Node.js >= 18 (or v20 LTS)
- Redis Server (for distributed locking/duplicate check)
- PostgreSQL (for execution logs)

## Setup

1. **Initialize the New Domain Service**
   Navigate to the repository root and create the initial project:
   ```bash
   mkdir surebet_executor && cd surebet_executor
   npm init -y
   npm install fastify pino undici ioredis
   npm install --save-dev jest typescript @types/node
   ```

2. **Environment Variables**
   Create a `.env` file in `surebet_executor/`:
   ```env
   REDIS_URL=redis://localhost:6379
   PORT=3000
   MVP_MIN_PROFIT_PCT=3.0
   ```

3. **Run Dev Server**
   ```bash
   npm run dev
   ```

4. **Testing Webhook Integration**
   ```bash
   curl -X POST http://localhost:3000/api/v1/surebets/webhook \
     -H 'Content-Type: application/json' \
     -d '{
       "opportunity_id": "test_001",
       "match_id": "m1",
       "market": "OU",
       "line": "2.5",
       "updated_at": "2026-04-12T15:00:00Z",
       "profit_pct_expected": 3.5,
       "legs": [...]
     }'
   ```
