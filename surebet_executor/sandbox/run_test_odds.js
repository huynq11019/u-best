import { chromium } from 'playwright';
import X1Adapter from './src/adapters/x1Adapter.js';
import { SportType } from './src/adapters/baseAdapter.js';
import { config } from './src/config/index.js';

async function runTest() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  const adapter = new X1Adapter('x1', config.bookkies.x1);
  const sportsToTest = [SportType.FOOTBALL, SportType.BASKETBALL, SportType.ALL];

  for (const sport of sportsToTest) {
    console.log(`\nTesting getActiveOdds for sport: ${sport}`);
    try {
      const odds = await adapter.getActiveOdds(page, sport);
      console.log(`  → Found ${odds.length} active events`);
      if (odds.length > 0) {
        const sample = odds[0];
        console.log(`  Sample event: [${sample.league}] ${sample.home} vs ${sample.away}`);
        console.log(`  Selections (${sample.selections.length}):`, sample.selections.slice(0, 3));
      }
    } catch (e) {
      console.error(e);
    }
  }
  await browser.close();
}
runTest();
