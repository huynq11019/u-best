import { chromium } from 'playwright';
import fs from 'fs';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  await page.goto('https://1xfun888bet.com/vi/live/football', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000); // let UI settle
  
  const html = await page.content();
  fs.writeFileSync('1xbet_live.html', html);
  
  await browser.close();
  console.log('Saved to 1xbet_live.html');
})();
