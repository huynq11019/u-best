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
