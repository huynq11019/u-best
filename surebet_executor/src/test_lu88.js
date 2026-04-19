/**
 * Quick smoke-test for the Lu88 adapter.
 *
 * Run with:
 *   node src/test_lu88.js
 *
 * Prerequisites:
 *   - .env must have LU88_USERNAME / LU88_PASSWORD set
 *   - Playwright + Chromium installed
 */
import 'dotenv/config';
import { chromium } from 'playwright';
import Lu88Adapter from './adapters/lu88Adapter.js';
import { config } from './config/index.js';

async function main() {
  console.log('=== Lu88 Adapter Smoke Test ===\n');
  console.log(`Username : ${config.bookkies.lu88.username}`);
  console.log(`Base URL : ${config.bookkies.lu88.baseUrl}`);
  console.log('');

  const adapter = new Lu88Adapter('lu88', config.bookkies.lu88);

  const browser = await chromium.launch({
    headless: config.browserPool.headless,
    executablePath: config.browserPool.executablePath || undefined,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--no-first-run',
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ignoreHTTPSErrors: true,
  });

  // Stealth patch
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();

  try {
    // ── Step 1: Login ──────────────────────────────────────────────────────────
    console.log('[1/3] Running adapter.login()...');
    await adapter.login(page);
    console.log(`      ✓ Login completed`);
    console.log(`      Token acquired: ${adapter._authToken ? 'yes' : 'no'}\n`);

    // ── Step 2: Warm up (fetch SportV URL) ────────────────────────────────────
    console.log('[2/3] Running adapter.warmUp()...');
    await adapter.warmUp(page);
    console.log(`      ✓ Warm-up completed`);
    console.log(`      DepositProcessLogin URL: ${adapter._sportvGameUrl || '(not captured)'}`);
    console.log(`      Final browser URL: ${page.url()}\n`);

    // ── Step 3: Get active odds ────────────────────────────────────────────────
    console.log('[3/3] Running adapter.getActiveOdds()...');
    const odds = await adapter.getActiveOdds(page);
    const ouOdds = odds.filter(o => o.marketType === 'OU');
    console.log('--- Over/Under Odds Sample ---');
    if (ouOdds.length > 0) {
      console.log(`Found ${ouOdds.length} OU markets\n`);
      ouOdds.slice(0, 3).forEach((odd, i) => {
        console.log(`  [${i + 1}] ${odd.home} vs ${odd.away} (${odd.league})`);
        odd.selections.forEach(s => {
          const line = s.line != null ? ` (line: ${s.line})` : '';
          console.log(`       ${s.label}${line}: ${s.odds}`);
        });
      });
    } else {
      console.log('  (No OU odds found)');
    }
    console.log(`\n      ✓ getActiveOdds returned ${odds.length} total market records`);
    console.log(`      ✓ OU markets: ${ouOdds.length}\n`);

    console.log('=== All steps passed ===');
  } catch (err) {
    console.error('\n✗ Test failed:', err.message);
    console.error(err.stack);
    process.exitCode = 1;
  } finally {
    await page.waitForTimeout(3000); // brief pause to inspect browser state
    await browser.close();
  }
}

main();
