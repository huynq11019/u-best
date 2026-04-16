import 'dotenv/config';
import { chromium } from 'playwright';
import Lu88Adapter from './src/adapters/lu88Adapter.js';
import { config } from './src/config/index.js';
import fs from 'fs';

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
  
  // Custom warmUp to test passing sport URL directly or modify the DepositProcessLogin
  adapter.warmUp = async function(page) {
    if (!this._authToken) throw new Error('Lu88: missing auth token');
    const { gameUrl } = this._buildApiUrls();
    const qs = new URLSearchParams({
      partner_provider: 'sportv', // maybe 'sport', 'saba' ?
      partner_game_type: '',
      home: 'https://lu88.moe?ref_domain=false',
      device: 'pc',
    }).toString();
    const apiUrl = `${gameUrl}?${qs}`;

    let result = await page.evaluate(async ({ url, token }) => {
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` }});
      return { status: resp.status, body: await resp.text() };
    }, { url: apiUrl, token: this._authToken });

    let sportvUrl = JSON.parse(result.body).data;
    // HACK: test changing Virtualsports to Sports
    sportvUrl = sportvUrl.replace('act=Virtualsports', 'act=Sports'); 
    console.log("DepositProcessLogin URL hacked:", sportvUrl);
    await page.goto(sportvUrl, { waitUntil: 'commit', timeout: 90000 });
    await page.waitForTimeout(5000);
  }

  const browser = await chromium.launch({ headless: true, executablePath: config.browserPool.executablePath || undefined });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  await adapter.login(page);
  await adapter.warmUp(page);
  
  console.log("Final page:", page.url());
  const frame = page.frame({ name: 'sportsFrame' });
  if (frame) {
    console.log("Checking left menu for football IN FRAME...");
    await frame.waitForSelector('.c-side-nav__item, .c-side-sportsmenu', { timeout: 10000 }).catch(() => console.log("timeout"));
    
    const elements = await frame.locator('.c-side-sportsmenu span, .c-side-nav__item span').all();
    for (const el of elements) {
      const txt = await el.textContent() || '';
      const t = txt.trim();
      if (t === 'Bóng đá' || t === 'Soccer' || t === 'Football') {
        console.log("Clicking normal football: ", t);
        try {
            await el.click({ force: true, timeout: 5000 });
            await page.waitForTimeout(7000);
            
            const content = await frame.content();
            fs.writeFileSync('sportsFrameNormalHack.html', content);
            
            const vs = await frame.locator('[id^="vstitle"]').count();
            console.log("vstitle count = ", vs);
        } catch(e) {}
        break; // found and clicked
      }
    }
  }
  await browser.close();
}
main();
