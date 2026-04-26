import { chromium } from 'playwright';
import X1Adapter from './adapters/x1Adapter.js';
import { SportType } from './adapters/baseAdapter.js';
import { config } from './config/index.js';
import fs from 'fs';
import path from 'path';

/**
 * Test script: Full luồng getActiveOdds → getEventOdds → placeBet trên x1.
 *
 * Usage:
 *   node src/test_x1_placebet.js                   # DRY_RUN (chỉ in leg, không đặt thật)
 *   DRY_RUN=false node src/test_x1_placebet.js     # ĐẶT THẬT — cẩn thận!
 *   STAKE=10000 node src/test_x1_placebet.js       # Tuỳ chỉnh stake
 *   SELECTION=Under node src/test_x1_placebet.js   # Chọn cửa Under thay vì Over
 */

const DRY_RUN = process.env.DRY_RUN !== 'false';
const STAKE = parseInt(process.env.STAKE || '10000', 10);
const SELECTION = process.env.SELECTION || 'Over'; // 'Over' | 'Under'

async function runTest() {
  console.log('=== X1 PlaceBet Integration Test ===');
  console.log(`  DRY_RUN:    ${DRY_RUN}`);
  console.log(`  STAKE:      ${STAKE} VND`);
  console.log(`  SELECTION:  ${SELECTION}`);
  console.log('');

  let context;
  let browser;

  if (config.browserPool.userDataDir) {
    console.log(`Using persistent context from: ${config.browserPool.userDataDir}`);
    context = await chromium.launchPersistentContext(config.browserPool.userDataDir, {
      headless: config.browserPool.headless,
      executablePath: config.browserPool.executablePath || undefined,
      viewport: { width: 1280, height: 720 },
    });
    browser = context.browser();
  } else {
    browser = await chromium.launch({
      headless: config.browserPool.headless,
      executablePath: config.browserPool.executablePath || undefined,
    });
    context = await browser.newContext();
  }

  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
  const adapter = new X1Adapter('x1', config.bookkies.x1);

  try {
    // --- Step 1: Login ---
    console.log('[1/5] Logging in...');
    await adapter.login(page);
    console.log('  ✓ Login success');

    // --- Step 2: WarmUp ---
    console.log('[2/5] Warming up...');
    await adapter.warmUp(page);
    console.log('  ✓ WarmUp complete');

    // --- Step 3: Get active odds (live events) ---
    console.log('[3/5] Fetching active odds (football)...');
    const activeOdds = await adapter.getActiveOdds(page, SportType.FOOTBALL);
    console.log(`  ✓ Found ${activeOdds.length} live events`);

    if (activeOdds.length === 0) {
      console.log('  ✗ No live events available — cannot test placeBet. Exiting.');
      return;
    }

    // Hiển thị 5 trận đầu
    console.log('  Top events:');
    activeOdds.slice(0, 5).forEach((ev, i) => {
      console.log(`    ${i + 1}. [${ev.league}] ${ev.home} vs ${ev.away} (eventId: ${ev.eventId})`);
    });

    // --- Step 4: Get event odds (chi tiết kèo của trận đầu) ---
    const targetEvent = activeOdds[0];
    console.log(`\n[4/5] Fetching event odds for: ${targetEvent.home} vs ${targetEvent.away}`);
    console.log(`  eventId: ${targetEvent.eventId}`);

    const eventDetail = await adapter.getEventOdds(page, targetEvent.eventId, SportType.FOOTBALL);

    if (!eventDetail) {
      console.log('  ✗ No event detail returned. Exiting.');
      return;
    }

    console.log(`  ✓ Got event detail — ${eventDetail.markets.length} market group(s)`);
    eventDetail.markets.forEach((m) => {
      if (m.hasLines) {
        console.log(`    [${m.marketType}] ${m.marketName}: ${m.lines.length} line(s)`);
        m.lines.forEach((l) => {
          console.log(`      Line ${l.line}: ${l.selectionA} @${l.oddsA} (T=${l.kindA}) | ${l.selectionB} @${l.oddsB} (T=${l.kindB})`);
        });
      } else {
        console.log(`    [${m.marketType}] ${m.marketName}: ${m.options.length} option(s)`);
        m.options.forEach((o) => {
          console.log(`      ${o.selection} @${o.odds} (T=${o.kind})`);
        });
      }
    });

    // --- Step 5: Build BetLeg & PlaceBet ---
    // Tìm market OU
    const ouMarket = eventDetail.markets.find((m) => m.marketType === 'OU' && m.hasLines);
    if (!ouMarket || ouMarket.lines.length === 0) {
      console.log('\n  ✗ No OU market found — trying AH or 1X2 next...');
      // Fallback: thử AH
      const ahMarket = eventDetail.markets.find((m) => m.marketType === 'AH' && m.hasLines);
      if (!ahMarket || ahMarket.lines.length === 0) {
        console.log('  ✗ No AH market either. Exiting.');
        return;
      }
    }

    const market = ouMarket || eventDetail.markets.find((m) => m.hasLines);
    const targetLine = market.lines[0]; // Line đầu tiên (thường là mốc nhỏ nhất)

    // Parse gameId từ eventId: lấy số lớn nhất trong composite
    const parts = String(eventDetail.eventId).split('-').map(Number).filter((n) => !isNaN(n) && n > 0);
    const gameId = Math.max(...parts);
    const leagueId = parts.length >= 2 ? String(Math.min(...parts)) : '';

    // Chọn cửa: Over (A) hoặc Under (B)
    const isOver = SELECTION.toLowerCase() === 'over';
    const leg = {
      gameId,
      type: isOver ? targetLine.kindA : targetLine.kindB,
      odds: isOver ? targetLine.oddsA : targetLine.oddsB,
      line: targetLine.line,
      kind: isOver ? 1 : 2,
      stake: STAKE,
      leagueId,
      home: eventDetail.home,
      away: eventDetail.away,
      sportPath: 'football',
    };

    console.log(`\n[5/5] PlaceBet — ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
    console.log('  BetLeg:', JSON.stringify(leg, null, 2));

    if (DRY_RUN) {
      console.log('\n  ⏸ DRY_RUN=true — skipping actual bet placement.');
      console.log('  To place a real bet, run: DRY_RUN=false node src/test_x1_placebet.js');
      return;
    }

    console.log('\n  ⚡ Calling adapter.placeBet()...');
    const result = await adapter.placeBet(page, leg);

    console.log('\n  ✓ Bet placed successfully!');
    console.log('  Result:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('\n✗ Test failed:', error.message);
    console.error(error.stack);

    const screenshotDir = './error_screenshots';
    if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir);
    const screenshotPath = path.join(screenshotDir, `x1_placebet_fail_${Date.now()}.png`);
    console.log(`  Saving failure screenshot to: ${screenshotPath}`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
  } finally {
    console.log('\nClosing browser in 3 seconds...');
    await new Promise((resolve) => setTimeout(resolve, 3000));
    if (context) await context.close();
    if (browser) await browser.close().catch(() => {});
  }
}

runTest();
