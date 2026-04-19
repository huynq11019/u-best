const { chromium } = require('playwright');
const path = require('path');
require('dotenv').config();

async function main() {
    const Lu88Adapter = (await import('./src/adapters/lu88Adapter.js')).default;
    const { config } = (await import('./src/config/index.js'));
    const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const adapter = new Lu88Adapter('lu88', config.bookkies.lu88);
  await adapter.login(page);
  await adapter.warmUp(page);
  await page.waitForTimeout(3000);
  
  const frame = page.frameLocator('#sportsFrame');
  await frame.locator('.YSWHH').first().waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
  
  const html = await frame.locator('.YSWHH').first().innerHTML();
  require('fs').writeFileSync('single_match.html', html);
  console.log('Saved single_match.html');
  await browser.close();
}
main();
