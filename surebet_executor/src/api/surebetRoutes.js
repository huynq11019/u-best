// T016 - Surebet discovery API routes
import { randomUUID } from 'crypto';
import { scanSurebets, validateScanParams } from '../services/surebet/surebetFinder.js';
import { getLatestSurebets, getSurebetHealth, surebetEmitter } from '../services/surebet/surebetWorker.js';
import { executeOpportunity } from '../services/executorService.js';
import { childLogger } from '../config/logger.js';
import { config } from '../config/index.js';

const log = childLogger({ component: 'surebetRoutes' });

/**
 * Fastify plugin for surebet API routes
 */
export async function surebetRoutes(fastify) {
  /**
   * GET /api/surebet/scan
   * Scan for surebets between bookmakers in real-time
   * 
   * Query parameters:
   * - sport: Sport to scan (default: football)
   * - scope: Filter by scope (live/prematch, optional)
   * - minProfitPct: Minimum profit percentage (default: 0.5)
   * - books: Comma-separated bookmaker pairs (default: lu88,x1)
   * - fuzzyThreshold: Fuzzy matching threshold 0-1 (default: 0.85)
   */
  fastify.get('/scan', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          sport: { type: 'string', enum: ['football', 'basketball', 'tennis', 'baseball', 'hockey', 'volleyball'], default: 'football' },
          scope: { type: 'string', enum: ['live', 'prematch'] },
          minProfitPct: { type: 'number', minimum: 0, maximum: 100 },
          books: { type: 'string', pattern: '^[a-z]+(,[a-z]+)?$' },
          fuzzyThreshold: { type: 'number', minimum: 0, maximum: 1 }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const params = request.query;
      
      // Validate parameters
      const errors = validateScanParams(params);
      if (errors.length > 0) {
        reply.status(400).send({
          error: 'Bad Request',
          message: errors.join(', ')
        });
        return;
      }

      // Parse books parameter
      const books = params.books ? params.books.split(',').map(b => b.trim()) : undefined;
      
      // Build scan options
      const scanOptions = {
        sport: params.sport,
        scope: params.scope,
        minProfitPct: params.minProfitPct,
        books,
        fuzzyThreshold: params.fuzzyThreshold
      };

      // Perform scan
      const result = await scanSurebets(scanOptions);
      
      return {
        status: 'success',
        ...result
      };

    } catch (err) {
      fastify.log.error({ err: err.message }, 'Surebet scan failed');
      reply.status(500).send({
        error: 'Internal Server Error',
        message: err.message
      });
    }
  });

  /**
   * GET /api/surebet/latest
   * Get latest surebets from worker cache (no new scan)
   * 
   * Query parameters:
   * - limit: Maximum number of results (default: 20, max: 100)
   * - sport: Filter by sport (optional)
   * - minProfitPct: Filter by minimum profit (optional)
   */
  fastify.get('/latest', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          sport: { type: 'string' },
          minProfitPct: { type: 'number', minimum: 0 }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { limit, sport, minProfitPct } = request.query;
      
      const result = await getLatestSurebets({ limit, sport, minProfitPct });
      
      return {
        status: 'success',
        ...result
      };

    } catch (err) {
      fastify.log.error({ err: err.message }, 'Failed to get latest surebets');
      reply.status(500).send({
        error: 'Internal Server Error',
        message: err.message
      });
    }
  });

  /**
   * GET /api/surebet/health
   * Get surebet worker health status
   */
  fastify.get('/health', async (request, reply) => {
    try {
      const health = await getSurebetHealth();
      
      return {
        status: 'success',
        ...health
      };

    } catch (err) {
      fastify.log.error({ err: err.message }, 'Failed to get surebet health');
      reply.status(500).send({
        error: 'Internal Server Error',
        message: err.message
      });
    }
  });

  /**
   * GET /api/surebet/stream
   * Server-Sent Events (SSE) stream for real-time surebet notifications
   */
  fastify.get('/stream', async (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Send initial heartbeat
    reply.raw.write('event: connected\ndata: {"status":"connected"}\n\n');

    // Listener for new surebets
    const onNewSurebets = (surebets) => {
      const payload = JSON.stringify({
        type: 'new_surebets',
        timestamp: new Date().toISOString(),
        count: surebets.length,
        surebets,
      });
      reply.raw.write(`event: surebet\ndata: ${payload}\n\n`);
    };

    surebetEmitter.on('new_surebets', onNewSurebets);

    // Heartbeat every 30s to keep connection alive
    const heartbeat = setInterval(() => {
      reply.raw.write('event: heartbeat\ndata: {}\n\n');
    }, 30000);

    // Cleanup on disconnect
    request.raw.on('close', () => {
      surebetEmitter.off('new_surebets', onNewSurebets);
      clearInterval(heartbeat);
    });
  });

  /**
   * POST /api/surebet/execute
   * Execute a surebet — place opposing bets on both bookmakers
   * 
   * Body:
   * - surebet: The surebet opportunity object from scan results
   * - totalStake: Total stake to distribute across legs
   */
  fastify.post('/execute', {
    schema: {
      body: {
        type: 'object',
        required: ['surebet', 'totalStake'],
        properties: {
          surebet: { type: 'object' },
          totalStake: { type: 'number', minimum: 1 },
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { surebet, totalStake } = request.body;
      const mockMode = process.env.SUREBET_MOCK_MODE === 'true';

      // Validate surebet has required fields
      if (!surebet.legs || surebet.legs.length !== 2) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Surebet must have exactly 2 legs'
        });
      }

      // Calculate stakes per leg based on stake_ratio
      const legs = surebet.legs.map(leg => ({
        ...leg,
        stake: Math.round(totalStake * (leg.stake_ratio || 0.5) * 100) / 100,
      }));

      log.info({
        match: `${surebet.home} vs ${surebet.away}`,
        profit_pct: surebet.profit_pct,
        totalStake,
        legs: legs.map(l => ({ book: l.book, side: l.side, odds: l.odds, stake: l.stake })),
      }, 'Executing surebet');

      // Mock execution for testing
      if (mockMode) {
        const executionId = randomUUID();
        const mockResult = {
          execution_id: executionId,
          status: 'COMPLETED',
          legs: legs.map((leg, idx) => ({
            leg_index: idx,
            book: leg.book,
            status: 'PLACED',
            placed_odds: leg.odds,
            placed_stake: leg.stake,
            order_ref: `MOCK_${leg.book.toUpperCase()}_${Date.now()}_${idx}`,
            error_code: null,
          })),
          total_stake: totalStake,
          expected_profit_pct: surebet.profit_pct,
          expected_profit_amount: Math.round(totalStake * surebet.profit_pct / 100 * 100) / 100,
          executed_at: new Date().toISOString(),
        };

        // Emit execution event to SSE clients
        surebetEmitter.emit('execution_result', mockResult);

        return {
          status: 'success',
          execution_status: mockResult.status,
          execution_id: mockResult.execution_id,
          legs: mockResult.legs,
          total_stake: mockResult.total_stake,
          expected_profit_pct: mockResult.expected_profit_pct,
          expected_profit_amount: mockResult.expected_profit_amount,
          executed_at: mockResult.executed_at,
        };
      }

      // Build opportunity object for executor
      const opportunity = {
        opportunity_id: randomUUID(),
        sport: surebet.sport || 'football',
        market: surebet.combination || surebet.market,
        scope: surebet.scope,
        home: surebet.home,
        away: surebet.away,
        from_books: legs.map(l => l.book).join(','),
        line: surebet.line,
        profit_pct: surebet.profit_pct,
        updated_at: new Date().toISOString(),
        bet: {
          total_stake: totalStake,
          profit_pct_calc: surebet.profit_pct,
          payout_equal: totalStake * (1 + surebet.profit_pct / 100),
          legs,
        },
      };

      // Execute via executor service
      const result = await executeOpportunity(opportunity);

      // Emit execution event to SSE clients
      surebetEmitter.emit('execution_result', result);

      return {
        status: 'success',
        execution_status: result.status,
        execution_id: result.execution_id,
        legs: result.legs,
        total_stake: totalStake,
        expected_profit_pct: surebet.profit_pct,
        expected_profit_amount: Math.round(totalStake * surebet.profit_pct / 100 * 100) / 100,
        executed_at: new Date().toISOString(),
      };

    } catch (err) {
      log.error({ err: err.message, stack: err.stack }, 'Surebet execution failed');
      reply.status(500).send({
        error: 'Execution Failed',
        message: err.message,
      });
    }
  });
}
