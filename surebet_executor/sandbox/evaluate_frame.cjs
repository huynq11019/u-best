const { chromium } = require('playwright');
const path = require('path');
require('dotenv').config();

async function main() {
    const Lu88Adapter = (await import('./src/adapters/lu88Adapter.js')).default;
    const { config } = (await import('./src/config/index.js'));
    const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROME_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  const adapter = new Lu88Adapter('lu88', config.bookkies.lu88);
  await adapter.login(page);
  await adapter.warmUp(page);
  await page.waitForTimeout(3000);
  console.log("Frames:", page.frames().map(f => f.name()));
  const frame = page.frame({ name: 'sportsFrame' });
  if (frame) {
      console.log("Frame URL:", frame.url());
      const html = await frame.content();
      require('fs').writeFileSync('lu88_frame.html', html);
      console.log("Saved lu88_frame.html");
  } else {
      console.log("sportsFrame not found");
  }
  await browser.close();
}
main();
