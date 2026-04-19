import Fastify from 'fastify';
import { apiRoutes } from './routes.js';
import * as adapterRegistry from '../services/adapterRegistry.js';
import * as browserPool from '../services/browserPool.js';

jest.mock('../services/adapterRegistry.js');
jest.mock('../services/browserPool.js');

describe('API Routes', () => {
  let app;
  
  beforeEach(async () => {
    app = Fastify();
    await app.register(apiRoutes);
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  const MOCK_ODDS = [
    { eventId: '1', home: 'Team A', away: 'Team B', marketType: '1X2', sport: 'football' },
    { eventId: '1', home: 'Team A', away: 'Team B', marketType: 'OU', sport: 'football' },
    { eventId: '2', home: 'Team C', away: 'Team D', marketType: 'AH', sport: 'football' },
  ];

  it('GET /odds/:bookmakerKey returns flat odds', async () => {
    adapterRegistry.hasAdapter.mockReturnValue(true);
    adapterRegistry.getAdapter.mockReturnValue({
      getActiveOdds: jest.fn().mockResolvedValue(MOCK_ODDS),
    });
    browserPool.acquirePage.mockResolvedValue({});
    browserPool.releasePage.mockResolvedValue({});

    const response = await app.inject({
      method: 'GET',
      url: '/odds/mockBookmaker'
    });

    expect(response.statusCode).toBe(200);
    const json = JSON.parse(response.payload);
    expect(json.status).toBe('success');
    expect(json.count).toBe(3);
    expect(json.data).toEqual(MOCK_ODDS);
    expect(browserPool.acquirePage).toHaveBeenCalledWith('mockBookmaker');
    expect(browserPool.releasePage).toHaveBeenCalled();
  });

  it('GET /:bookmakerKey/events groups by event', async () => {
    adapterRegistry.hasAdapter.mockReturnValue(true);
    adapterRegistry.getAdapter.mockReturnValue({
      getActiveOdds: jest.fn().mockResolvedValue(MOCK_ODDS),
    });
    browserPool.acquirePage.mockResolvedValue({});
    browserPool.releasePage.mockResolvedValue({});

    const response = await app.inject({
      method: 'GET',
      url: '/mockBookmaker/events'
    });

    expect(response.statusCode).toBe(200);
    const json = JSON.parse(response.payload);
    expect(json.status).toBe('success');
    expect(json.count).toBe(2); // event 1 and event 2
    expect(json.events[0].eventId).toBe('1');
    expect(json.events[0].markets).toHaveLength(2);
    expect(json.events[1].eventId).toBe('2');
    expect(json.events[1].markets).toHaveLength(1);
  });

  it('GET /:bookmakerKey/events/:eventId gets a specific event details', async () => {
    adapterRegistry.hasAdapter.mockReturnValue(true);
    adapterRegistry.getAdapter.mockReturnValue({
      getActiveOdds: jest.fn().mockResolvedValue(MOCK_ODDS),
    });
    browserPool.acquirePage.mockResolvedValue({});
    browserPool.releasePage.mockResolvedValue({});

    const response = await app.inject({
      method: 'GET',
      url: '/mockBookmaker/events/1'
    });

    expect(response.statusCode).toBe(200);
    const json = JSON.parse(response.payload);
    expect(json.status).toBe('success');
    expect(json.event).toBeDefined();
    expect(json.event.eventId).toBe('1');
    expect(json.event.markets).toHaveLength(2);
  });

  it('GET /:bookmakerKey/events/:eventId returns 404 for unknown eventId', async () => {
    adapterRegistry.hasAdapter.mockReturnValue(true);
    adapterRegistry.getAdapter.mockReturnValue({
      getActiveOdds: jest.fn().mockResolvedValue(MOCK_ODDS),
    });
    browserPool.acquirePage.mockResolvedValue({});
    browserPool.releasePage.mockResolvedValue({});

    const response = await app.inject({
      method: 'GET',
      url: '/mockBookmaker/events/999'
    });

    expect(response.statusCode).toBe(404);
    const json = JSON.parse(response.payload);
    expect(json.error).toBe('Not Found');
    expect(json.message).toContain('not found');
  });

  it('returns 404 if adapter not found', async () => {
    adapterRegistry.hasAdapter.mockReturnValue(false);

    const response = await app.inject({
      method: 'GET',
      url: '/mockBookmaker/events'
    });

    expect(response.statusCode).toBe(404);
  });
});
