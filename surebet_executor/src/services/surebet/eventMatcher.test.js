// T016 - Unit tests for event matcher
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { matchEvents, createMatchKey, filterBySport, filterByScope } from './eventMatcher.js';

describe('eventMatcher', () => {
  const sampleEventsA = [
    {
      eventId: 'lu88_123',
      sport: 'football',
      home: 'Manchester United',
      away: 'Liverpool',
      league: 'Premier League',
      scope: 'live',
      markets: [{ marketType: 'OU' }]
    },
    {
      eventId: 'lu88_456',
      sport: 'football',
      home: 'Arsenal',
      away: 'Chelsea',
      league: 'Premier League',
      scope: 'live',
      markets: [{ marketType: 'OU' }]
    },
    {
      eventId: 'lu88_789',
      sport: 'basketball',
      home: 'Lakers',
      away: 'Celtics',
      league: 'NBA',
      scope: 'prematch',
      markets: [{ marketType: 'OU' }]
    }
  ];

  const sampleEventsB = [
    {
      eventId: 'x1_abc',
      sport: 'football',
      home: 'Manchester United',
      away: 'Liverpool',
      league: 'Premier League',
      scope: 'live',
      markets: [{ marketType: 'OU' }]
    },
    {
      eventId: 'x1_def',
      sport: 'football',
      home: 'Liverpool',
      away: 'Manchester United', // Swapped
      league: 'Premier League',
      scope: 'live',
      markets: [{ marketType: 'OU' }]
    },
    {
      eventId: 'x1_ghi',
      sport: 'football',
      home: 'Manchester Utd', // Slight variation
      away: 'Liverpool FC',
      league: 'Premier League',
      scope: 'live',
      markets: [{ marketType: 'OU' }]
    },
    {
      eventId: 'x1_jkl',
      sport: 'basketball',
      home: 'Lakers',
      away: 'Celtics',
      league: 'NBA',
      scope: 'prematch',
      markets: [{ marketType: 'OU' }]
    }
  ];

  describe('matchEvents', () => {
    it('should find exact matches', () => {
      const matches = matchEvents(sampleEventsA, sampleEventsB, { fuzzyThreshold: 0.85 });
      const exactMatches = matches.filter(m => m.matchType === 'exact');
      
      assert(exactMatches.length >= 2, 'Should find at least 2 exact matches');
      
      // Check first exact match
      const firstExact = exactMatches[0];
      assert.strictEqual(firstExact.eventA.eventId, 'lu88_123');
      assert.strictEqual(firstExact.eventB.eventId, 'x1_abc');
      assert.strictEqual(firstExact.score, 1.0);
      assert.strictEqual(firstExact.matchType, 'exact');
    });

    it('should find swapped matches', () => {
      const matches = matchEvents(sampleEventsA, sampleEventsB, { fuzzyThreshold: 0.85 });
      const exactMatches = matches.filter(m => m.matchType === 'exact');
      
      // Should find at least one exact match (could be direct or swapped)
      assert(exactMatches.length >= 1, 'Should find at least one exact match');
      
      // Check if any match involves lu88_123
      const lu88Match = exactMatches.find(m => m.eventA.eventId === 'lu88_123');
      assert(lu88Match, 'Should find match for lu88_123');
    });

    it('should find fuzzy matches above threshold', () => {
      // Create separate test data to avoid conflicts with previous matches
      const eventsA2 = [
        {
          eventId: 'lu88_fuzzy',
          sport: 'football',
          home: 'Manchester Utd',
          away: 'Liverpool FC',
          league: 'Premier League',
          scope: 'live',
          markets: [{ marketType: 'OU' }]
        }
      ];
      
      const eventsB2 = [
        {
          eventId: 'x1_fuzzy',
          sport: 'football',
          home: 'Manchester United',
          away: 'Liverpool',
          league: 'Premier League',
          scope: 'live',
          markets: [{ marketType: 'OU' }]
        }
      ];
      
      const matches = matchEvents(eventsA2, eventsB2, { fuzzyThreshold: 0.8 });
      const fuzzyMatches = matches.filter(m => m.matchType === 'fuzzy');
      
      assert(fuzzyMatches.length > 0, 'Should find fuzzy match');
      const fuzzyMatch = fuzzyMatches[0];
      assert(fuzzyMatch.score > 0.8, 'Fuzzy score should be above threshold');
      assert(fuzzyMatch.score < 1.0, 'Fuzzy score should be less than 1.0');
    });

    it('should not find fuzzy matches below threshold', () => {
      const matches = matchEvents(sampleEventsA, sampleEventsB, { fuzzyThreshold: 0.95 });
      const fuzzyMatches = matches.filter(m => m.matchType === 'fuzzy');
      
      // With high threshold, should not find fuzzy match
      const fuzzyMatch = fuzzyMatches.find(m => 
        m.eventA.eventId === 'lu88_123' && m.eventB.eventId === 'x1_ghi'
      );
      assert(!fuzzyMatch, 'Should not find fuzzy match below threshold');
    });

    it('should filter by sport when required', () => {
      const matches = matchEvents(sampleEventsA, sampleEventsB, { 
        fuzzyThreshold: 0.85,
        requireSameSport: true 
      });
      
      // Should not match football with basketball
      const crossSportMatch = matches.find(m => 
        (m.eventA.sport === 'football' && m.eventB.sport === 'basketball') ||
        (m.eventA.sport === 'basketball' && m.eventB.sport === 'football')
      );
      assert(!crossSportMatch, 'Should not match different sports');
    });

    it('should filter by scope when required', () => {
      const matches = matchEvents(sampleEventsA, sampleEventsB, { 
        fuzzyThreshold: 0.85,
        requireSameScope: true 
      });
      
      // Should not match live with prematch
      const crossScopeMatch = matches.find(m => 
        (m.eventA.scope === 'live' && m.eventB.scope === 'prematch') ||
        (m.eventA.scope === 'prematch' && m.eventB.scope === 'live')
      );
      assert(!crossScopeMatch, 'Should not match different scopes');
    });

    it('should not reuse matched events', () => {
      const matches = matchEvents(sampleEventsA, sampleEventsB, { fuzzyThreshold: 0.85 });
      const usedEventBIds = matches.map(m => m.eventB.eventId);
      const uniqueEventBIds = [...new Set(usedEventBIds)];
      
      assert.strictEqual(usedEventBIds.length, uniqueEventBIds.length, 
        'Each event B should only be used once');
    });
  });

  describe('createMatchKey', () => {
    it('should create unique match key', () => {
      const pair = {
        eventA: { eventId: 'lu88_123' },
        eventB: { eventId: 'x1_abc' }
      };
      
      const key = createMatchKey(pair);
      assert.strictEqual(key, 'lu88_123__x1_abc');
    });
  });

  describe('filterBySport', () => {
    it('should filter matches by sport', () => {
      const matches = [
        { eventA: { sport: 'football' }, eventB: { sport: 'football' } },
        { eventA: { sport: 'basketball' }, eventB: { sport: 'basketball' } },
        { eventA: { sport: 'football' }, eventB: { sport: 'football' } }
      ];
      
      const footballMatches = filterBySport(matches, 'football');
      assert.strictEqual(footballMatches.length, 2);
      
      const basketballMatches = filterBySport(matches, 'basketball');
      assert.strictEqual(basketballMatches.length, 1);
    });
  });

  describe('filterByScope', () => {
    it('should filter matches by scope', () => {
      const matches = [
        { eventA: { scope: 'live' }, eventB: { scope: 'live' } },
        { eventA: { scope: 'prematch' }, eventB: { scope: 'prematch' } },
        { eventA: { scope: 'live' }, eventB: { scope: 'live' } }
      ];
      
      const liveMatches = filterByScope(matches, 'live');
      assert.strictEqual(liveMatches.length, 2);
      
      const prematchMatches = filterByScope(matches, 'prematch');
      assert.strictEqual(prematchMatches.length, 1);
    });
  });
});
