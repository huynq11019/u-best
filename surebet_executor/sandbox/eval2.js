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
    console.log("Checking left menu for football IN FRAME...");
    const footballLinks = await frame.locator('text="Bóng đá"').all();
    console.log("Football links found:", footballLinks.length);
    if (footballLinks.length > 0) {
       await footballLinks[0].scrollIntoViewIfNeeded();
       await footballLinks[0].click();
       console.log("Clicked! Waiting 5s...");
       await page.waitForTimeout(5000);
       
       const content = await frame.content();
       fs.writeFileSync('sportsFrameAfterClick.html', content);
       console.log("Saved sportsFrameAfterClick.html");
       
       // count vstitle
       const vs = await frame.locator('[id^="vstitle"]').count();
       console.log("vstitle count: ", vs);
    }
  }
  await browser.close();
}
main();
