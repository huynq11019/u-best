import { chromium, firefox } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('Navigating to Live Football...');
  let apiData = [];
  page.on('response', async (res) => {
    if (res.url().includes('Zip') || res.url().includes('Live') || res.url().includes('event')) {
      // Just check URLs that might match odds responses
      // console.log(`[API] ${res.url()}`);
    }
  });

  await page.goto('https://1xfun888bet.com/vi/live/football', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  // Attempt to find event links
  const links = await page.$$eval('a.dashboard-game-block__link, a[href*="/live/football/"]', els => els.map(e => e.href));
  const validLinks = [...new Set(links)].filter(l => l.length > 30);
  
  if (validLinks.length > 0) {
    const eventUrl = validLinks[0];
    console.log('Going to detailed event: ' + eventUrl);
    await page.goto(eventUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    
    // Let's inspect the canvas
    const canvasExists = await page.evaluate(() => {
        const cvs = document.querySelector('.market-grid-canvas__canvas');
        return !!cvs;
    });
    console.log('Canvas exists?', canvasExists);

    // Let's inspect global variables for methods to place bets
    const globals = await page.evaluate(() => {
        return Object.keys(window).filter(k => k.toLowerCase().includes('bet') || k.toLowerCase().includes('slip') || k.toLowerCase().includes('store'));
    });
    console.log('Interesting Window globals:', globals);

  } else {
    console.log('No event links found.');
  }

  await browser.close();
})();
