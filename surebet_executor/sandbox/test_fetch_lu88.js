import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  page.on('console', msg => console.log('Console:', msg.text()));
  
  await page.goto('https://lu88.moe', { waitUntil: 'commit', timeout: 30000 });
  console.log('Page URL:', page.url());
  
  try {
    const res = await page.evaluate(async () => {
      try {
        const resp = await fetch('https://lu88.moe/gw/api/v2/auth/login', { method: 'POST' });
        return { status: resp.status, text: await resp.text() };
      } catch (err) {
        return { error: err.message, stack: err.stack };
      }
    });
    console.log('Fetch result:', res);
  } catch (err) {
    console.error('Fetch error:', err.message);
  }
  
  await browser.close();
})();
