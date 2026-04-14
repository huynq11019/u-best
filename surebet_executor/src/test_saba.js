// Test script for SabaAdapter
// Run: node src/test_saba.js
import { chromium } from 'playwright';
import SabaAdapter from './adapters/sabaAdapter.js';
import { SportType } from './adapters/baseAdapter.js';
import { config } from './config/index.js';
import fs from 'fs';
import path from 'path';

async function runTest() {
  console.log('='.repeat(60));
  console.log('SabaAdapter Test');
  console.log('='.repeat(60));

  let context;
  let browser;

  // Use persistent profile when configured (preserves cookies across runs)
  if (config.browserPool.userDataDir) {
    console.log(`► Using persistent Chrome profile: ${config.browserPool.userDataDir}`);
    context = await chromium.launchPersistentContext(config.browserPool.userDataDir, {
      headless: false,                                    // Must be visible for manual login
      executablePath: config.browserPool.executablePath || undefined,
      viewport: { width: 1280, height: 800 },
    });
    browser = context.browser();
  } else {
    browser = await chromium.launch({
      headless: false,                                    // Must be visible for manual login
      executablePath: config.browserPool.executablePath || undefined,
    });
    context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  }

  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

  const adapter = new SabaAdapter('saba', config.bookkies.saba);

  try {
    // ── Step 1: Login (session-restore) ──────────────────────────
    console.log('\n[1/3] Testing login()...');
    console.log('      Loading session from .saba_session.json...');
    await adapter.login(page);
    console.log('      ✓ Login successful');

    // ── Step 2: Warm-up ────────────────────────────────────────────────────
    console.log('\n[2/3] Testing warmUp()...');
    await adapter.warmUp(page);
    console.log('      ✓ Warm-up complete');

    // ── Step 3: getActiveOdds ──────────────────────────────────────────────
    console.log('\n[3/3] Testing getActiveOdds(FOOTBALL)...');
    const odds = await adapter.getActiveOdds(page, SportType.FOOTBALL);
    console.log(`      ✓ Found ${odds.length} OU football events`);

    if (odds.length > 0) {
      console.log('\n  Sample events:');
      odds.slice(0, 5).forEach((ev, i) => {
        console.log(`  [${i + 1}] [${ev.league || 'N/A'}] ${ev.home} vs ${ev.away}`);
        ev.selections.forEach(s => {
          const line = s.line != null ? ` (line: ${s.line})` : '';
          console.log(`       ${s.label}${line}: ${s.odds}`);
        });
      });
    } else {
      console.warn('  ⚠ No OU odds found — the lobby may need login or page selectors may need update.');
    }

  } catch (error) {
    console.error('\n✗ Test failed:', error.message);

    // Save failure screenshot
    const dir = './error_screenshots';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `saba_failure_${Date.now()}.png`);
    await page.screenshot({ path: file, fullPage: true }).catch(() => {});
    console.error(`  Screenshot saved: ${file}`);

  } finally {
    console.log('\nClosing browser in 5 seconds...');
    await new Promise(r => setTimeout(r, 5000));
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

runTest();
