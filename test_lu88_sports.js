import 'dotenv/config';
import { chromium } from 'playwright';
import Lu88Adapter from './src/adapters/lu88Adapter.js';
import { config } from './src/config/index.js';

async function main() {
  const adapter = new Lu88Adapter('lu88', config.bookkies.lu88);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  await adapter.login(page);
  
  // manually tweak warmUp logic here to intercept sportvUrl
  await adapter.warmUp(page);
  
  const odds = await adapter.getActiveOdds(page);
  console.log(odds);
  await browser.close();
}
main();
