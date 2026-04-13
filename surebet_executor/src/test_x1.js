import { chromium } from 'playwright';
import X1Adapter from './adapters/x1Adapter.js';
import { config } from './config/index.js';

async function runTest() {
  console.log('Starting X1Adapter test...');
  
  const browser = await chromium.launch({
    headless: false,
    executablePath: config.browserPool.executablePath || undefined
  });
  
  const context = await browser.newContext();
  const page = await context.newPage();

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
  } finally {
    console.log('Closing browser in 5 seconds...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    await browser.close();
  }
}

runTest();
