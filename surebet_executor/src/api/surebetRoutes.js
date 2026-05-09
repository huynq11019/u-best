// T016 - Surebet discovery API routes
import { scanSurebets, validateScanParams } from '../services/surebet/surebetFinder.js';
import { getLatestSurebets, getSurebetHealth } from '../services/surebet/surebetWorker.js';

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
}
