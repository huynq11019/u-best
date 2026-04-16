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
    
    // Close overlay if exists
    try {
        await page.evaluate(() => {
            const overlays = document.querySelectorAll('.overlay, [class*="modal"], [class*="popup"], .c-preloader');
            overlays.forEach(o => o.style.display = 'none');
        });
        await frame.evaluate(() => {
            const overlays = document.querySelectorAll('.overlay, [class*="modal"], [class*="popup"], .c-preloader');
            overlays.forEach(o => o.style.display = 'none');
        });
        console.log("Cleared overlays via JS");
    } catch(e){}
    
    await frame.waitForSelector('.c-side-nav__item', { timeout: 10000 }).catch(() => console.log("timeout"));
    
    const elements = await frame.locator('.c-side-nav__item').all();
    console.log("Nav items:", elements.length);
    for (const el of elements) {
      const txt = await el.textContent() || '';
      const t = txt.trim().replace(/\s+/g, ' ');
      
      if (t.includes('Giải đấu Bóng đá Ảo') || t.includes('Bóng đá Ảo')) {
        console.log("Clicking: ", t);
        try {
          await el.click({ force: true, timeout: 5000 });
          console.log("Clicked! Waiting 5s...");
          await page.waitForTimeout(5000);
          
          const content = await frame.content();
          fs.writeFileSync('sportsFrameAfterClick.html', content);
          
          const vs = await frame.locator('[id^="vstitle"]').count();
          console.log("vstitle count = ", vs);
        } catch(e) {
          console.log("Click fail:", e.message);
        }
        break; // found and clicked
      }
    }
  }
  await browser.close();
}
main();
