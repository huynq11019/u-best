import 'dotenv/config';
import { chromium } from 'playwright';
import Lu88Adapter from './src/adapters/lu88Adapter.js';
import { config } from './src/config/index.js';
import fs from 'fs';

// Override params for test
import { BaseAdapter } from './src/adapters/baseAdapter.js';

async function main() {
  const adapter = new Lu88Adapter('lu88', config.bookkies.lu88);
  adapter._buildApiUrls = function() {
      const baseUrl = (this.config.baseUrl || 'https://lu88.moe').replace(/\/$/, '');
      return {
        login: `${baseUrl}/gw/api/v2/auth/login`,
        gameUrl: `${baseUrl}/gw/api/v2/game/url`,
        userInfo: `${baseUrl}/gw/api/v2/user/info`,
        baseUrl,
      };
  };
  
  // Custom warmUp to use Sports instead of VirtualSports
  adapter.warmUp = async function(page) {
    if (!this._authToken) throw new Error('Lu88: missing auth token');
    const { gameUrl } = this._buildApiUrls();
    const qs = new URLSearchParams({
      partner_provider: 'sportv',
      partner_game_type: 'S', // S for Sports instead of empty (which resolves to virtual apparently, or it's just defaulting)
      home: 'https://lu88.moe?ref_domain=false',
      device: 'pc',
    }).toString();
    const apiUrl = `${gameUrl}?${qs}`;

    let result = await page.evaluate(async ({ url, token }) => {
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` }});
      return { status: resp.status, body: await resp.text() };
    }, { url: apiUrl, token: this._authToken });

    const sportvUrl = JSON.parse(result.body).data;
    console.log("DepositProcessLogin URL:", sportvUrl);
    await page.goto(sportvUrl, { waitUntil: 'commit', timeout: 90000 });
    await page.waitForTimeout(5000);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  await adapter.login(page);
  await adapter.warmUp(page);
  
  const frame = page.frame({ name: 'sportsFrame' });
  if (frame) {
    console.log("Checking left menu for football IN FRAME...");
    await frame.waitForSelector('.c-side-nav__item', { timeout: 10000 }).catch(() => console.log("timeout"));
    
    const elements = await frame.locator('.c-side-nav__item span').all();
    for (const el of elements) {
      const txt = await el.textContent() || '';
      const t = txt.trim();
      
      if (t === 'Bóng đá') {
        console.log("Clicking normal football: ", t);
        await el.click({ force: true, timeout: 5000 });
        await page.waitForTimeout(7000);
        
        const content = await frame.content();
        fs.writeFileSync('sportsFrameNormal.html', content);
        
        const vs = await frame.locator('[id^="vstitle"]').count();
        console.log("vstitle count = ", vs);
        break; // found and clicked
      }
    }
  }
  await browser.close();
}
main();
