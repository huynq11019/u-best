// T016 - Unit tests for surebet calculator
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { findOuSurebets, calculateStakes } from './surebetCalculator.js';

describe('surebetCalculator', () => {
  const sampleEventA = {
    eventId: 'lu88_123',
    sport: 'football',
    home: 'Man United',
    away: 'Liverpool',
    league: 'Premier League',
    scope: 'live',
    markets: [
      {
        marketType: 'OU',
        lines: [
          {
            line: 2.5,
            selections: [
              { selection: 'Over', odds: 2.10, selectionId: 'lu88_over_2.5' },
              { selection: 'Under', odds: 1.80, selectionId: 'lu88_under_2.5' }
            ]
          },
          {
            line: 3.0,
            selections: [
              { selection: 'Over', odds: 1.95, selectionId: 'lu88_over_3.0' },
              { selection: 'Under', odds: 1.85, selectionId: 'lu88_under_3.0' }
            ]
          }
        ]
      }
    ]
  };

  const sampleEventB = {
    eventId: 'x1_abc',
    sport: 'football',
    home: 'Man United',
    away: 'Liverpool',
    league: 'Premier League',
    scope: 'live',
    markets: [
      {
        marketType: 'OU',
        lines: [
          {
            line: 2.5,
            selections: [
              { selection: 'Over', odds: 1.95, selectionId: 'x1_over_2.5' }, // Lower to create surebet
              { selection: 'Under', odds: 2.00, selectionId: 'x1_under_2.5' } // Higher to create surebet
            ]
          },
          {
            line: 3.0,
            selections: [
              { selection: 'Over', odds: 1.90, selectionId: 'x1_over_3.0' },
              { selection: 'Under', odds: 1.90, selectionId: 'x1_under_3.0' }
            ]
          }
        ]
      }
    ]
  };

  const matchInfo = {
    matchType: 'exact',
    score: 1.0
  };

  describe('findOuSurebets', () => {
    it('should find surebets when profit > threshold', () => {
      const surebets = findOuSurebets(sampleEventA, sampleEventB, matchInfo, { minProfitPct: 0.5 });
      
      assert(surebets.length > 0, 'Should find surebets');
      
      // Check first surebet structure
      const surebet = surebets[0];
      assert(surebet.matchKey, 'Should have matchKey');
      assert.strictEqual(surebet.sport, 'football');
      assert.strictEqual(surebet.home, 'Man United');
      assert.strictEqual(surebet.away, 'Liverpool');
      assert.strictEqual(surebet.scope, 'live');
      assert(surebet.line !== undefined, 'Should have line value');
      assert.strictEqual(surebet.matchType, 'exact');
      assert.strictEqual(surebet.matchScore, 1.0);
      assert(Array.isArray(surebet.legs), 'Should have legs array');
      assert.strictEqual(surebet.legs.length, 2, 'Should have exactly 2 legs');
      assert(surebet.profit_pct >= 0.5, 'Profit should be above threshold');
      assert(surebet.fetched_at, 'Should have fetched_at timestamp');
    });

    it('should not find surebets when profit < threshold', () => {
      const surebets = findOuSurebets(sampleEventA, sampleEventB, matchInfo, { minProfitPct: 10.0 });
      
      assert.strictEqual(surebets.length, 0, 'Should not find surebets with high threshold');
    });

    it('should find both combinations for same line', () => {
      const surebets = findOuSurebets(sampleEventA, sampleEventB, matchInfo, { minProfitPct: 0.1 });
      
      // Should find both Over_A_Under_B and Over_B_Under_A combinations
      const line2_5Surebets = surebets.filter(s => s.line === 2.5);
      assert(line2_5Surebets.length >= 1, 'Should find at least one combination for line 2.5');
      
      const combinations = line2_5Surebets.map(s => s.combination);
      assert(combinations.includes('Over_A_Under_B') || combinations.includes('Over_B_Under_A'), 
        'Should find valid combinations');
    });

    it('should handle events without OU markets', () => {
      const eventNoOU = {
        eventId: 'test_456',
        sport: 'football',
        home: 'Team A',
        away: 'Team B',
        markets: [
          { marketType: '1X2', options: [] }
        ]
      };

      const surebets = findOuSurebets(eventNoOU, sampleEventB, matchInfo);
      assert.strictEqual(surebets.length, 0, 'Should not find surebets without OU markets');
    });

    it('should handle mismatched lines', () => {
      const eventDifferentLines = {
        eventId: 'test_789',
        sport: 'football',
        home: 'Man United',
        away: 'Liverpool',
        markets: [
          {
            marketType: 'OU',
            lines: [
              {
                line: 1.5, // Different line
                selections: [
                  { selection: 'Over', odds: 2.10 },
                  { selection: 'Under', odds: 1.80 }
                ]
              }
            ]
          }
        ]
      };

      const surebets = findOuSurebets(eventDifferentLines, sampleEventB, matchInfo);
      assert.strictEqual(surebets.length, 0, 'Should not find surebets with mismatched lines');
    });

    it('should calculate correct profit percentages', () => {
      const surebets = findOuSurebets(sampleEventA, sampleEventB, matchInfo, { minProfitPct: 0.1 });
      
      for (const surebet of surebets) {
        const overLeg = surebet.legs.find(l => l.side === 'Over');
        const underLeg = surebet.legs.find(l => l.side === 'Under');
        
        // Manual calculation to verify
        const implied = 1/overLeg.odds + 1/underLeg.odds;
        const expectedProfit = (1/implied - 1) * 100;
        
        assert(Math.abs(surebet.profit_pct - expectedProfit) < 0.01, 
          `Profit calculation incorrect: expected ${expectedProfit}, got ${surebet.profit_pct}`);
      }
    });
  });

  describe('calculateStakes', () => {
    it('should calculate correct stake amounts', () => {
      const surebet = {
        legs: [
          { book: 'lu88', side: 'Over', odds: 2.10, stake_ratio: 0.473 },
          { book: 'x1', side: 'Under', odds: 1.85, stake_ratio: 0.527 }
        ],
        profit_pct: 1.5
      };

      const result = calculateStakes(surebet, 100);
      
      assert.strictEqual(result.total_stake, 100, 'Total stake should be 100');
      assert.strictEqual(result.legs.length, 2, 'Should have 2 legs');
      
      const overLeg = result.legs.find(l => l.side === 'Over');
      const underLeg = result.legs.find(l => l.side === 'Under');
      
      assert(Math.abs(overLeg.stake - 47.3) < 0.1, 'Over stake should be ~47.3');
      assert(Math.abs(underLeg.stake - 52.7) < 0.1, 'Under stake should be ~52.7');
      
      const expectedPayout = 100 * (1 + 1.5/100);
      assert(Math.abs(result.expected_payout - expectedPayout) < 0.1, 
        'Expected payout should be correct');
    });

    it('should handle zero total stake', () => {
      const surebet = {
        legs: [
          { book: 'lu88', side: 'Over', odds: 2.10, stake_ratio: 0.5 },
          { book: 'x1', side: 'Under', odds: 1.85, stake_ratio: 0.5 }
        ],
        profit_pct: 1.5
      };

      const result = calculateStakes(surebet, 0);
      
      assert.strictEqual(result.total_stake, 0, 'Total stake should be 0');
      assert.strictEqual(result.legs[0].stake, 0, 'First leg stake should be 0');
      assert.strictEqual(result.legs[1].stake, 0, 'Second leg stake should be 0');
      assert.strictEqual(result.expected_payout, 0, 'Expected payout should be 0');
    });
  });
});
