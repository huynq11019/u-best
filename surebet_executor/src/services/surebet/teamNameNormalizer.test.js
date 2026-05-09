// T016 - Unit tests for team name normalizer
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { normalizeTeamName, teamsMatch, calculateTeamSimilarity } from './teamNameNormalizer.js';

describe('teamNameNormalizer', () => {
  describe('normalizeTeamName', () => {
    it('should normalize basic team names', () => {
      assert.strictEqual(normalizeTeamName('Manchester United'), 'manchester united');
      assert.strictEqual(normalizeTeamName('FC Barcelona'), 'barcelona');
      assert.strictEqual(normalizeTeamName('Real Madrid CF'), 'real madrid');
    });

    it('should remove Vietnamese diacritics', () => {
      assert.strictEqual(normalizeTeamName('Hà Nội FC'), 'ha noi');
      assert.strictEqual(normalizeTeamName('TP.HCM'), 'tp hcm');
      assert.strictEqual(normalizeTeamName('Sài Gòn'), 'sai gon');
    });

    it('should strip common suffixes and prefixes', () => {
      assert.strictEqual(normalizeTeamName('Manchester United FC'), 'manchester united');
      assert.strictEqual(normalizeTeamName('FC Barcelona'), 'barcelona');
      assert.strictEqual(normalizeTeamName('Athletic Bilbao'), 'bilbao');
      assert.strictEqual(normalizeTeamName('Sporting CP'), 'sporting cp');
    });

    it('should handle special characters and spacing', () => {
      assert.strictEqual(normalizeTeamName('Manchester United - FC'), 'manchester united');
      assert.strictEqual(normalizeTeamName('Real   Madrid'), 'real madrid');
      assert.strictEqual(normalizeTeamName('  Liverpool  FC  '), 'liverpool');
    });

    it('should handle edge cases', () => {
      assert.strictEqual(normalizeTeamName(''), '');
      assert.strictEqual(normalizeTeamName(null), '');
      assert.strictEqual(normalizeTeamName(undefined), '');
      assert.strictEqual(normalizeTeamName(123), '');
    });
  });

  describe('teamsMatch', () => {
    it('should match exact team names', () => {
      assert.strictEqual(teamsMatch('Man United', 'Liverpool', 'Man United', 'Liverpool'), true);
    });

    it('should match normalized team names', () => {
      assert.strictEqual(teamsMatch('Manchester United FC', 'Liverpool', 'Manchester United', 'Liverpool FC'), true);
    });

    it('should match swapped home/away teams', () => {
      assert.strictEqual(teamsMatch('Man United', 'Liverpool', 'Liverpool', 'Man United'), true);
    });

    it('should not match different teams', () => {
      assert.strictEqual(teamsMatch('Man United', 'Liverpool', 'Arsenal', 'Chelsea'), false);
    });

    it('should handle Vietnamese team names', () => {
      assert.strictEqual(teamsMatch('Hà Nội FC', 'TP.HCM', 'Ha Noi', 'TP HCM'), true);
    });
  });

  describe('calculateTeamSimilarity', () => {
    it('should return 1.0 for identical names', () => {
      assert.strictEqual(calculateTeamSimilarity('Man United', 'Man United'), 1.0);
    });

    it('should return 1.0 for normalized identical names', () => {
      assert.strictEqual(calculateTeamSimilarity('Manchester United FC', 'Manchester United'), 1.0);
    });

    it('should return 0.0 for empty names', () => {
      assert.strictEqual(calculateTeamSimilarity('', 'Man United'), 0.0);
      assert.strictEqual(calculateTeamSimilarity('Man United', ''), 0.0);
      assert.strictEqual(calculateTeamSimilarity('', ''), 0.0);
    });

    it('should calculate reasonable similarity scores', () => {
      const score1 = calculateTeamSimilarity('Manchester United', 'Manchester Utd');
      assert(score1 > 0.8, `Expected > 0.8, got ${score1}`);

      const score2 = calculateTeamSimilarity('Real Madrid', 'Real Madrid CF');
      assert(score2 > 0.8, `Expected > 0.8, got ${score2}`);

      const score3 = calculateTeamSimilarity('Arsenal', 'Chelsea');
      assert(score3 < 0.5, `Expected < 0.5, got ${score3}`);
    });
  });
});
