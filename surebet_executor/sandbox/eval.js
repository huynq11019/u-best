import 'dotenv/config';
import { chromium } from 'playwright';
import Lu88Adapter from './src/adapters/lu88Adapter.js';
import { config } from './src/config/index.js';
import fs from 'fs';

async function main() {
  const adapter = new Lu88Adapter('lu88', config.bookkies.lu88);
  const browser = await chromium.launch({
    headless: true,
    executablePath: config.browserPool.executablePath || undefined,
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  await adapter.login(page);
  await adapter.warmUp(page);
  
  const frame = page.frame({ name: 'sportsFrame' });
  if (frame) {
    console.log("sportsFrame url is:", frame.url());
    
    // Check if there are other subframes or just main page content
    const iframes = await frame.locator('iframe').all();
    console.log("Iframes inside sportsFrame:", iframes.length);
    for (let i = 0; i < iframes.length; i++) {
        const name = await iframes[i].getAttribute('name');
        const src = await iframes[i].getAttribute('src');
        const id = await iframes[i].getAttribute('id');
        console.log(`- Frame ${i} id=${id}, name=${name}, src=${src}`);
    }
  }
  await browser.close();
}
main();
