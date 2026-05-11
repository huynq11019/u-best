import { hasAdapter, getAdapter } from '../services/adapterRegistry.js';
import { acquirePage, releasePage } from '../services/browserPool.js';
import { groupOddsByEvent } from './eventHelpers.js';

/**
 * Fastify plugin for general API routes.
 */
export async function apiRoutes(fastify) {
  /**
   * GET /api/odds/:bookmakerKey?sport=football
   * Lấy danh sách kèo đang có (active odds) từ một nhà cái (bookmaker).
   */
  fastify.get('/odds/:bookmakerKey', async (request, reply) => {
    const { bookmakerKey } = request.params;
    const { sport, marketType } = request.query;

    if (!hasAdapter(bookmakerKey)) {
      reply.status(404).send({
        error: 'Not Found',
        message: `Bookmaker adapter "${bookmakerKey}" is not registered.`,
      });
      return;
    }

    const adapter = getAdapter(bookmakerKey);
    let page;
    
    try {
      // 1. Phân bổ context/page từ Pool (chờ các page đã login / warmup)
      page = await acquirePage(bookmakerKey);
      
      // 2. Mặc định môn thể thao là bóng đá nếu không chỉ định rõ
      const sportType = sport || 'football';
      
      // 3. Lấy dữ liệu odds qua adapter tương ứng
      let odds = await adapter.getActiveOdds(page, sportType);
      
      // 3.1. Lọc theo marketType nếu client yêu cầu (vd: ?marketType=OU)
      if (marketType) {
        odds = odds.filter(odd => odd.marketType === marketType.toUpperCase());
      }
      
      return {
        status: 'success',
        bookmakerKey,
        sport: sportType,
        count: odds.length,
        data: odds,
      };
    } catch (err) {
      fastify.log.error({ bookmakerKey, err: err.message }, 'Failed to fetch active odds from adapter');
      reply.status(500).send({
        error: 'Internal Server Error',
        message: err.message,
      });
    } finally {
      if (page) {
        // 4. Hoàn trả page lại cho pool ngay cả khi bị lỗi
        await releasePage(bookmakerKey, page).catch((e) => 
          fastify.log.warn({ err: e.message }, 'Failed to release page back to pool')
        );
      }
    }
  });

  /**
   * GET /api/:bookmakerKey/events?sport=football
   * Lấy danh sách trận đấu đang có từ một nhà cái, mỗi trận bao gồm đầy đủ các kèo.
   */
  fastify.get('/:bookmakerKey/events', async (request, reply) => {
    const { bookmakerKey } = request.params;
    const { sport, marketType } = request.query;

    if (!hasAdapter(bookmakerKey)) {
      reply.status(404).send({
        error: 'Not Found',
        message: `Bookmaker adapter "${bookmakerKey}" is not registered.`,
      });
      return;
    }

    const adapter = getAdapter(bookmakerKey);
    let page;
    
    try {
      page = await acquirePage(bookmakerKey);
      const sportType = sport || 'football';
      
      let events = await adapter.getEvents(page, sportType);
      
      // Lọc theo marketType ở cấp độ events -> markets
      if (marketType && events.length > 0) {
        events = events.map(e => ({
          ...e,
          markets: e.markets ? e.markets.filter(m => m.marketType === marketType.toUpperCase()) : []
        })).filter(e => e.markets.length > 0);
      }
      
      return {
        status: 'success',
        bookmakerKey,
        sport: sportType,
        count: events.length,
        events,
      };
    } catch (err) {
      fastify.log.error({ bookmakerKey, err: err.message }, 'Failed to fetch active odds and group by event');
      reply.status(500).send({
        error: 'Internal Server Error',
        message: err.message,
      });
    } finally {
      if (page) {
        await releasePage(bookmakerKey, page).catch((e) => 
          fastify.log.warn({ err: e.message }, 'Failed to release page back to pool')
        );
      }
    }
  });

  /**
   * POST /api/:bookmakerKey/bets
   * Đặt cược trực tiếp qua adapter của nhà cái tương ứng.
   *
   * Request body (JSON):
   * {
   *   "gameId":   714350696,   // ID trận đấu (bắt buộc)
   *   "type":     10,          // Selection Type T từ GetGameZip (bắt buộc)
   *   "odds":     1.09,        // Hệ số ăn tại thời điểm đặt (bắt buộc, > 1)
   *   "stake":    20000,       // Số tiền đặt (bắt buộc, > 0)
   *   "line":     5.5,         // Mốc kèo — handicap / O/U line (tuỳ chọn, mặc định 0)
   *   "kind":     2,           // 1=Over/Home/Yes, 2=Under/Away/No (tuỳ chọn, mặc định 1)
   *   "leagueId": "2740174",   // League ID để build Referer URL (tuỳ chọn)
   *   "home":     "Team A",    // Tên đội nhà (tuỳ chọn)
   *   "away":     "Team B",    // Tên đội khách (tuỳ chọn)
   *   "sportPath":"football"   // Sport path URL (tuỳ chọn, mặc định "football")
   * }
   *
   * Response (200):
   * {
   *   "status":        "success",
   *   "bookmakerKey":  "x1",
   *   "order_ref":     "80833384253",
   *   "placed_odds":   1.09,
   *   "placed_stake":  20000,
   *   "balance_after": 30000,
   *   "placed_at":     "2026-04-24T10:01:13.753Z",
   *   "odds_changed":  false,
   *   "line_changed":  false
   * }
   */
  fastify.post('/:bookmakerKey/bets', {
    schema: {
      params: {
        type: 'object',
        required: ['bookmakerKey'],
        properties: {
          bookmakerKey: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        required: ['gameId', 'type', 'odds', 'stake'],
        properties: {
          gameId:    { type: 'number' },
          type:      { type: 'number' },
          odds:      { type: 'number', exclusiveMinimum: 1 },
          stake:     { type: 'number', exclusiveMinimum: 0 },
          line:      { type: 'number', default: 0 },
          kind:      { type: 'number', enum: [1, 2], default: 1 },
          selectionType: { type: 'number' },
          leagueId:  { type: 'string' },
          home:      { type: 'string' },
          away:      { type: 'string' },
          sportPath: { type: 'string', default: 'football' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { bookmakerKey } = request.params;

    if (!hasAdapter(bookmakerKey)) {
      reply.status(404).send({
        error: 'Not Found',
        message: `Bookmaker adapter "${bookmakerKey}" is not registered.`,
      });
      return;
    }

    const adapter = getAdapter(bookmakerKey);

    // Kiểm tra adapter có hỗ trợ placeBet không (guard cho adapter chưa implement)
    if (typeof adapter.placeBet !== 'function') {
      reply.status(501).send({
        error: 'Not Implemented',
        message: `Adapter "${bookmakerKey}" does not support bet placement.`,
      });
      return;
    }

    // Build BetLeg từ request body — cấu trúc chuẩn dùng chung cho mọi adapter
    const leg = {
      gameId:    request.body.gameId,
      type:      request.body.type,
      selectionType: request.body.selectionType,
      odds:      request.body.odds,
      stake:     request.body.stake,
      line:      request.body.line ?? 0,
      kind:      request.body.kind ?? 1,
      leagueId:  request.body.leagueId,
      home:      request.body.home,
      away:      request.body.away,
      sportPath: request.body.sportPath ?? 'football',
    };

    let page;
    try {
      page = await acquirePage(bookmakerKey);

      const result = await adapter.placeBet(page, leg);

      return {
        status: 'success',
        bookmakerKey,
        order_ref:     result.order_ref,
        placed_odds:   result.placed_odds,
        placed_stake:  result.placed_stake,
        balance_after: result.balance_after ?? null,
        placed_at:     result.placed_at ?? null,
        odds_changed:  result.odds_changed ?? false,
        line_changed:  result.line_changed ?? false,
      };
    } catch (err) {
      fastify.log.error(
        { bookmakerKey, gameId: leg.gameId, type: leg.type, err: err.message },
        'Failed to place bet via adapter'
      );

      // Phân biệt lỗi validation (4xx) với lỗi hệ thống (5xx)
      const isClientError = /required|must be|not found|invalid/i.test(err.message);
      reply.status(isClientError ? 400 : 500).send({
        error: isClientError ? 'Bad Request' : 'Internal Server Error',
        message: err.message,
      });
    } finally {
      if (page) {
        await releasePage(bookmakerKey, page).catch((e) =>
          fastify.log.warn({ err: e.message }, 'Failed to release page back to pool')
        );
      }
    }
  });

  /**
   * POST /api/:bookmakerKey/bets/by-selection
   * Đặt cược bằng selection ID đã cache - chỉ cần eventId, selectionId, và stake.
   * Thông tin kèo (odds, line, type) tự động lookup từ cache.
   *
   * Nếu dữ liệu không có trong cache, API sẽ tự động gọi getEventOdds để lấy chi tiết
   * event và fill vào cache trước khi đặt cược.
   */
  fastify.post('/:bookmakerKey/bets/by-selection', {
    schema: {
      params: {
        type: 'object',
        required: ['bookmakerKey'],
        properties: {
          bookmakerKey: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        required: ['eventId', 'selectionId', 'stake'],
        properties: {
          eventId:   { type: 'string' },
          selectionId: { type: 'string' },
          stake:     { type: 'number', exclusiveMinimum: 0 },
          expectedOdds: { type: 'number' },
          oddsDriftThreshold: { type: 'number', default: 0.05 },
          sport: { type: 'string', default: 'football' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { bookmakerKey } = request.params;
    const { eventId, selectionId, stake, expectedOdds, oddsDriftThreshold, sport } = request.body;

    // Log request
    fastify.log.info(
      { bookmakerKey, eventId, selectionId, stake, expectedOdds, sport },
      '[bets/by-selection] Request received'
    );

    if (!hasAdapter(bookmakerKey)) {
      reply.status(404).send({
        error: 'Not Found',
        message: `Bookmaker adapter "${bookmakerKey}" is not registered.`,
      });
      return;
    }

    const adapter = getAdapter(bookmakerKey);

    // Kiểm tra adapter có hỗ trợ placeBetBySelection không
    if (typeof adapter.placeBetBySelection !== 'function') {
      reply.status(501).send({
        error: 'Not Implemented',
        message: `Adapter "${bookmakerKey}" does not support placeBetBySelection.`,
      });
      return;
    }

    let page;
    let cachePopulated = false;
    try {
      page = await acquirePage(bookmakerKey);

      // Thử đặt cược lần đầu
      let result;
      try {
        result = await adapter.placeBetBySelection(page, {
          eventId,
          selectionId,
          stake,
          expectedOdds,
          oddsDriftThreshold: oddsDriftThreshold ?? 0.05,
        });
      } catch (firstErr) {
        // Kiểm tra nếu là lỗi cache miss hoặc selection not found
        const isCacheMiss = /no cached odds/i.test(firstErr.message);
        const isSelectionNotFound = /selection.*not found/i.test(firstErr.message);

        if ((isCacheMiss || isSelectionNotFound) && typeof adapter.getEventOdds === 'function') {
          fastify.log.info(
            { bookmakerKey, eventId, selectionId },
            'Cache miss - fetching event odds to populate cache'
          );

          // Gọi getEventOdds để lấy chi tiết event và fill vào cache
          const sportType = sport || 'football';
          const eventDetail = await adapter.getEventOdds(page, eventId, sportType);

          if (!eventDetail) {
            throw new Error(`Event with id "${eventId}" not found when fetching odds.`);
          }

          cachePopulated = true;
          fastify.log.info(
            { bookmakerKey, eventId, marketsCount: eventDetail.markets?.length },
            'Event odds fetched and cached - retrying bet placement'
          );

          // Thử đặt cược lại sau khi đã populate cache
          result = await adapter.placeBetBySelection(page, {
            eventId,
            selectionId,
            stake,
            expectedOdds,
            oddsDriftThreshold: oddsDriftThreshold ?? 0.05,
          });
        } else {
          // Nếu không phải cache miss hoặc không hỗ trợ getEventOdds → throw lỗi gốc
          throw firstErr;
        }
      }

      const response = {
        status: 'success',
        bookmakerKey,
        order_ref:     result.order_ref,
        placed_odds:   result.placed_odds,
        placed_stake:  result.placed_stake,
        balance_after: result.balance_after ?? null,
        placed_at:     result.placed_at ?? null,
        odds_changed:  result.odds_changed ?? false,
        line_changed:  result.line_changed ?? false,
        cache_populated: cachePopulated,
      };

      // Log success response
      fastify.log.info(
        { bookmakerKey, eventId, selectionId, response },
        '[bets/by-selection] Response sent - success'
      );

      return response;
    } catch (err) {
      fastify.log.error(
        { bookmakerKey, eventId, selectionId, err: err.message },
        'Failed to place bet by selection via adapter'
      );

      // Phân biệt lỗi validation (4xx) với lỗi hệ thống (5xx)
      const isCacheMiss = /no cached odds/i.test(err.message);
      const isSelectionNotFound = /selection.*not found/i.test(err.message);
      const isEventNotFound = /event.*not found/i.test(err.message);
      const isOddsDrift = /drifted too much/i.test(err.message);

      if (isCacheMiss || isSelectionNotFound || isEventNotFound) {
        reply.status(400).send({
          error: 'Bad Request',
          message: err.message,
          code: isEventNotFound ? 'EVENT_NOT_FOUND' : (isCacheMiss ? 'CACHE_MISS' : 'SELECTION_NOT_FOUND'),
        });
      } else if (isOddsDrift) {
        reply.status(409).send({
          error: 'Conflict',
          message: err.message,
          code: 'ODDS_DRIFTED',
        });
      } else {
        reply.status(500).send({
          error: 'Internal Server Error',
          message: err.message,
        });
      }
    } finally {
      if (page) {
        await releasePage(bookmakerKey, page).catch((e) =>
          fastify.log.warn({ err: e.message }, 'Failed to release page back to pool')
        );
      }
    }
  });

  /**
   * GET /api/:bookmakerKey/events/:eventId?sport=football
   * Lấy chi tiết các kèo của một trận đấu dựa vào eventId từ một nhà cái.
   */
  fastify.get('/:bookmakerKey/events/:eventId', async (request, reply) => {
    const { bookmakerKey, eventId } = request.params;
    const { sport, marketType } = request.query;

    if (!hasAdapter(bookmakerKey)) {
      reply.status(404).send({
        error: 'Not Found',
        message: `Bookmaker adapter "${bookmakerKey}" is not registered.`,
      });
      return;
    }

    const adapter = getAdapter(bookmakerKey);
    let page;
    
    try {
      page = await acquirePage(bookmakerKey);
      const sportType = sport || 'football';
      
      let eventDetail = await adapter.getEventOdds(page, eventId, sportType);
      
      if (!eventDetail) {
        reply.status(404).send({
          error: 'Not Found',
          message: `Event with id "${eventId}" not found.`
        });
        return;
      }
      
      // Lọc theo marketType trong các markets của eventDetail
      if (marketType && eventDetail.markets) {
        eventDetail.markets = eventDetail.markets.filter(
          m => m.marketType === marketType.toUpperCase()
        );
      }
      
      return {
        status: 'success',
        bookmakerKey,
        sport: sportType,
        event: eventDetail,
      };
    } catch (err) {
      fastify.log.error({ bookmakerKey, eventId, err: err.message }, 'Failed to fetch active odds and get event detail');
      reply.status(500).send({
        error: 'Internal Server Error',
        message: err.message,
      });
    } finally {
      if (page) {
        await releasePage(bookmakerKey, page).catch((e) => 
          fastify.log.warn({ err: e.message }, 'Failed to release page back to pool')
        );
      }
    }
  });
}
