import { groupOddsByEvent } from './eventHelpers.js';

describe('groupOddsByEvent', () => {
  it('groups odds by eventId correctly', () => {
    const odds = [
      { eventId: '123', sport: 'football', league: 'PL', home: 'Chelsea', away: 'Arsenal', marketType: '1X2', startTime: 'Live' },
      { eventId: '123', sport: 'football', league: 'PL', home: 'Chelsea', away: 'Arsenal', marketType: 'OU', startTime: 'Live' },
      { eventId: '456', sport: 'football', league: 'La Liga', home: 'Real Madrid', away: 'Barcelona', marketType: '1X2', startTime: 'Live' }
    ];

    const result = groupOddsByEvent(odds);

    expect(result).toHaveLength(2);
    expect(result[0].eventId).toBe('123');
    expect(result[0].markets).toHaveLength(2);
    expect(result[0].markets[0].marketType).toBe('1X2');
    expect(result[0].markets[1].marketType).toBe('OU');
    
    expect(result[1].eventId).toBe('456');
    expect(result[1].markets).toHaveLength(1);
    expect(result[1].markets[0].marketType).toBe('1X2');
  });

  it('uses fallback key when eventId is missing', () => {
    const odds = [
      { sport: 'football', league: 'PL', home: 'Chelsea', away: 'Arsenal', marketType: '1X2', startTime: 'Live' },
      { sport: 'football', league: 'PL', home: 'Chelsea', away: 'Arsenal', marketType: 'OU', startTime: 'Live' },
      { sport: 'football', league: 'PL', home: 'Chelsea', away: 'Man Utd', marketType: '1X2', startTime: 'Live' }
    ];

    const result = groupOddsByEvent(odds);

    expect(result).toHaveLength(2);
    
    // The fallback key structure should group the first two odds
    expect(result[0].markets).toHaveLength(2);
    expect(result[0].eventId).toBe('football|PL|Chelsea|Arsenal');

    // The third odd gets its own group
    expect(result[1].markets).toHaveLength(1);
    expect(result[1].eventId).toBe('football|PL|Chelsea|Man Utd');
  });
});
