/**
 * Test script to explore and capture the lu88.moe login flow.
 * Run with: node test_lu88_login.js
 */
import { chromium } from 'playwright';
import fs from 'fs';

const BASE_URL = 'https://lu88.moe';
const USERNAME = 'MIKAMIKA';
const PASSWORD = '12331';

const GAME_URL_API = 'https://lu88.moe/gw/api/v2/game/url?partner_provider=sportv&partner_game_type=&home=https%3A%2F%2Flu88.moe%3Fref_domain%3Dfalse&device=pc';

const networkLog = [];

async function run() {
  const browser = await chromium.launch({
    headless: false,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--no-first-run',
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ignoreHTTPSErrors: true,
  });

  // Intercept all network requests
  context.on('request', (req) => {
    if (req.url().includes('/gw/') || req.url().includes('/api/') || req.url().includes('/auth/') || req.url().includes('login')) {
      const entry = {
        type: 'request',
        method: req.method(),
        url: req.url(),
        headers: req.headers(),
        postData: req.postData(),
      };
      networkLog.push(entry);
      console.log(`[REQ] ${req.method()} ${req.url()}`);
      if (req.postData()) {
        console.log('  Body:', req.postData());
      }
    }
  });

  context.on('response', async (res) => {
    if (res.url().includes('/gw/') || res.url().includes('/api/') || res.url().includes('/auth/') || res.url().includes('login')) {
      let body = '';
      try {
        body = await res.text();
      } catch (_) {}
      const entry = {
        type: 'response',
        status: res.status(),
        url: res.url(),
        headers: res.headers(),
        body: body.substring(0, 2000),
      };
      networkLog.push(entry);
      console.log(`[RES] ${res.status()} ${res.url()}`);
      if (body && body.startsWith('{')) {
        console.log('  Response:', body.substring(0, 500));
      }
    }
  });

  const page = await context.newPage();

  console.log('\n=== Step 1: Navigate to homepage ===');
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  console.log('\n=== Step 2: Click login button ===');
  // The login button that opens the login modal (NOT register)
  // Try different selectors
  let clickedLogin = false;
  
  // Try finding the exact login button (not register)
  const allButtons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button, a')).map(el => ({
      tag: el.tagName,
      text: el.textContent?.trim()?.substring(0, 50),
      class: el.className?.substring(0, 150),
      id: el.id,
    })).filter(b => b.text && (b.text.includes('nhập') || b.text.includes('Login') || b.text.includes('login')));
  });
  console.log('Login-related buttons:', JSON.stringify(allButtons, null, 2));

  // Click the first "Đăng nhập" button
  try {
    await page.click('button:has-text("Đăng nhập")', { timeout: 5000 });
    clickedLogin = true;
    console.log('Clicked login button via text');
  } catch (_) {}

  if (!clickedLogin) {
    try {
      await page.click('.btn-login, [class*="btn-login"]', { timeout: 3000 });
      clickedLogin = true;
    } catch (_) {}
  }

  await page.waitForTimeout(1500);
  await page.screenshot({ path: './error_screenshots/lu88_02_after_login_click.png', fullPage: false });

  // Check if login or register modal is showing
  const loginInputVisible = await page.locator('#username-login-input').isVisible().catch(() => false);
  const registerInputVisible = await page.locator('#username-register-input').isVisible().catch(() => false);
  console.log(`Login input visible: ${loginInputVisible}, Register input visible: ${registerInputVisible}`);

  // If register modal is showing, try to switch to login tab
  if (registerInputVisible && !loginInputVisible) {
    console.log('Register tab is showing - trying to switch to login tab...');
    
    // Look for login tab
    const tabButtons = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('button, a, div[class*="tab"], li[class*="tab"]')).map(el => ({
        tag: el.tagName,
        text: el.textContent?.trim()?.substring(0, 50),
        class: el.className?.substring(0, 150),
        id: el.id,
      })).filter(b => b.text && (b.text.includes('nhập') || b.text.includes('đăng') || b.text.includes('Login')));
    });
    console.log('Tab candidates:', JSON.stringify(tabButtons, null, 2));

    try {
      // Click an element with "Đăng nhập" text that's inside the modal
      const loginTabs = page.locator('[class*="modal"] button:has-text("Đăng nhập"), [class*="modal"] a:has-text("Đăng nhập"), [class*="tab"]:has-text("Đăng nhập")');
      const count = await loginTabs.count();
      console.log(`Found ${count} login-tab candidates`);
      if (count > 0) {
        await loginTabs.first().click();
        await page.waitForTimeout(1000);
        console.log('Clicked login tab');
      }
    } catch (_) {}

    await page.screenshot({ path: './error_screenshots/lu88_03_after_tab_switch.png', fullPage: false });
    const loginInputNowVisible = await page.locator('#username-login-input').isVisible().catch(() => false);
    console.log(`Login input visible after tab switch: ${loginInputNowVisible}`);
  }

  // Dump the current visible form structure
  const formHTML = await page.evaluate(() => {
    const forms = Array.from(document.querySelectorAll('form, [class*="login-form"], [class*="auth-form"]'));
    return forms.map(f => ({
      id: f.id,
      class: f.className?.substring(0, 100),
      html: f.outerHTML?.substring(0, 2000),
    }));
  });
  fs.writeFileSync('./error_screenshots/lu88_forms.json', JSON.stringify(formHTML, null, 2));

  console.log('\n=== Step 3: Fill in credentials ===');
  // Try to fill login form
  const loginInput = page.locator('#username-login-input');
  const passwordInput = page.locator('#password-login-input');

  const canFillLogin = await loginInput.isVisible().catch(() => false);
  
  if (!canFillLogin) {
    console.log('Login form not accessible via IDs. Trying other approach...');
    
    // Dump all visible inputs
    const visibleInputs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('input')).filter(el => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }).map(el => ({
        type: el.type,
        name: el.name,
        id: el.id,
        placeholder: el.placeholder,
        class: el.className?.substring(0, 100),
      }));
    });
    console.log('Visible inputs:', JSON.stringify(visibleInputs, null, 2));
  } else {
    await loginInput.fill(USERNAME);
    await page.waitForTimeout(300);
    await passwordInput.fill(PASSWORD);
    await page.waitForTimeout(300);
    await page.screenshot({ path: './error_screenshots/lu88_04_filled.png', fullPage: false });

    console.log('\n=== Step 4: Submit login ===');
    // Click submit button
    const submitBtn = page.locator('button[type="submit"]:visible, button:has-text("Đăng nhập"):visible').last();
    
    try {
      await submitBtn.click({ timeout: 3000 });
      console.log('Clicked submit button');
    } catch (_) {
      // Try pressing Enter
      await passwordInput.press('Enter');
      console.log('Pressed Enter');
    }

    // Wait for login result
    console.log('Waiting for login result...');
    await page.waitForTimeout(5000);
    await page.screenshot({ path: './error_screenshots/lu88_05_after_submit.png', fullPage: false });
    console.log('Current URL:', page.url());

    // Check cookies
    const cookies = await context.cookies();
    const relevantCookies = cookies.filter(c => !c.name.startsWith('_'));
    console.log('\nCookies after login:');
    relevantCookies.forEach(c => console.log(`  ${c.name}=${c.value.substring(0, 100)}`));

    // Check localStorage  
    const storage = await page.evaluate(() => {
      const data = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        data[key] = localStorage.getItem(key)?.substring(0, 300);
      }
      return data;
    });
    console.log('\nLocalStorage after login:');
    console.log(JSON.stringify(storage, null, 2));
    fs.writeFileSync('./error_screenshots/lu88_localstorage.json', JSON.stringify(storage, null, 2));

    // Call game URL API
    console.log('\n=== Step 5: Call game URL API ===');
    const headers = await page.evaluate(() => {
      // Try to get auth headers from common places
      return {
        authorization: localStorage.getItem('token') || localStorage.getItem('accessToken') || localStorage.getItem('access_token') || '',
      };
    });

    try {
      const apiResponse = await page.evaluate(async (url) => {
        const resp = await fetch(url, { 
          credentials: 'include',
          headers: {
            'Accept': 'application/json',
          }
        });
        const text = await resp.text();
        return { status: resp.status, body: text, headers: Object.fromEntries(resp.headers.entries()) };
      }, GAME_URL_API);
      console.log('Game URL API Response:', JSON.stringify(apiResponse, null, 2));
      fs.writeFileSync('./error_screenshots/lu88_game_url_response.json', JSON.stringify(apiResponse, null, 2));
    } catch (err) {
      console.error('Game URL API error:', err.message);
    }
  }

  // Save all network logs
  fs.writeFileSync('./error_screenshots/lu88_network_log.json', JSON.stringify(networkLog, null, 2));
  console.log('\nNetwork log saved to lu88_network_log.json');
  console.log('\n=== KEY NETWORK EVENTS ===');
  networkLog.forEach(entry => {
    if (entry.type === 'request' && entry.postData) {
      console.log(`\nREQ: ${entry.method} ${entry.url}`);
      console.log(`  Body: ${entry.postData}`);
    }
    if (entry.type === 'response' && entry.body && entry.body.startsWith('{')) {
      const url = entry.url;
      if (url.includes('login') || url.includes('auth') || url.includes('game/url')) {
        console.log(`\nRES: ${entry.status} ${url}`);
        console.log(`  Body: ${entry.body}`);
      }
    }
  });

  console.log('\nWaiting 5 seconds before closing...');
  await page.waitForTimeout(5000);
  await browser.close();
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
