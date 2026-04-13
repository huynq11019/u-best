import { chromium } from 'playwright';
import X1Adapter from './adapters/x1Adapter.js';
import { config } from './config/index.js';
import fs from 'fs';
import path from 'path';

async function runTest() {
  console.log('Starting X1Adapter test...');
  
  let context;
  let browser;

  if (config.browserPool.userDataDir) {
    console.log(`Using persistent context from: ${config.browserPool.userDataDir}`);
    context = await chromium.launchPersistentContext(config.browserPool.userDataDir, {
      headless: config.browserPool.headless,
      executablePath: config.browserPool.executablePath || undefined,
      viewport: { width: 1280, height: 720 }
    });
    browser = context.browser(); // Might be null for persistent context
  } else {
    browser = await chromium.launch({
      headless: config.browserPool.headless,
      executablePath: config.browserPool.executablePath || undefined
    });
    context = await browser.newContext();
  }
  
  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();


  const adapter = new X1Adapter('x1', config.bookkies.x1);

  try {
    console.log('Testing login...');
    await adapter.login(page);
    console.log('Login result: success');

    console.log('Testing warmUp...');
    await adapter.warmUp(page);
    console.log('warmUp result: success');

  } catch (error) {
    console.error('Test failed:', error);
    
    // Take screenshot on failure
    const screenshotDir = './error_screenshots';
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir);
    }
    const screenshotPath = path.join(screenshotDir, `failure_${Date.now()}.png`);
    console.log(`Saving failure screenshot to: ${screenshotPath}`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    
  } finally {
    console.log('Closing browser in 5 seconds...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    if (context) await context.close();
    if (browser) await browser.close().catch(() => {});
  }
}

runTest();
