// T007 - Playwright Context Pool Manager
import { chromium } from 'playwright';
import { createPool } from 'generic-pool';
import { config } from '../config/index.js';
import { childLogger } from '../config/logger.js';

const log = childLogger({ component: 'browserPool' });

// Map of bookmakerKey -> Pool
const pools = new Map();

// Shared persistent context to prevent 'profile locked' errors
let sharedPersistentContext = null;
let launchPromise = null;

function buildLaunchOptions() {
  return {
    headless: config.browserPool.headless,
    executablePath: config.browserPool.executablePath || undefined,
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-dev-shm-usage',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  };
}

async function applyStealth(context) {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
      configurable: true,
    });

    window.chrome = window.chrome || { runtime: {} };

    Object.defineProperty(navigator, 'languages', {
      get: () => ['vi-VN', 'vi', 'en-US', 'en'],
      configurable: true,
    });

    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
      configurable: true,
    });

    const originalQuery = window.navigator.permissions && window.navigator.permissions.query;
    if (originalQuery) {
      window.navigator.permissions.query = (parameters) => (
        parameters && parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(parameters)
      );
    }
  });
}

/**
 * Create a Playwright page pool for a given bookmaker adapter.
 * The factory opens a browser context + page, runs login+warmUp, and
 * hands it back to the pool ready for immediate bet placement.
 *
 * @param {string} bookmakerKey
 * @param {import('../adapters/baseAdapter.js').BaseAdapter} adapter
 * @returns {import('generic-pool').Pool<import('playwright').Page>}
 */
function createBookmakerPool(bookmakerKey, adapter) {
  const factory = {
    async create() {
      // If using a persistent context (User Profile), we create it once and borrow pages from it.
      if (config.browserPool.userDataDir) {
        if (!sharedPersistentContext && !launchPromise) {
          log.info({ bookmakerKey, userDataDir: config.browserPool.userDataDir }, 'Launching shared persistent context');
          launchPromise = chromium.launchPersistentContext(
            config.browserPool.userDataDir,
            buildLaunchOptions()
          ).then(async (ctx) => {
            await applyStealth(ctx);
            sharedPersistentContext = ctx;
            return ctx;
          });
        }

        if (launchPromise) {
          await launchPromise;
        }
        
        const page = await sharedPersistentContext.newPage();
        
        // Attach crash recovery
        page.on('crash', () => {
          log.error({ bookmakerKey }, 'Page crashed in persistent context');
          page._crashed = true;
        });

        try {
          // In persistent context, we might already be logged in. 
          // adapter.login should check if login is needed.
          await adapter.login(page);
          await adapter.warmUp(page);
        } catch (err) {
          log.error({ bookmakerKey, err: err.message }, 'Persistent context page warm-up failed');
          await page.close().catch(() => {});
          throw err;
        }

        page._context = sharedPersistentContext;
        page._isPersistent = true;
        return page;
      }

      // Default behavior: Standard browser + isolated contexts
      let browser = null;
      if (!browser || !browser.isConnected()) {
        log.info({ bookmakerKey }, 'Launching standard browser');
        browser = await chromium.launch(buildLaunchOptions());
      }

      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        ignoreHTTPSErrors: true,
        locale: 'vi-VN',
        timezoneId: 'Asia/Ho_Chi_Minh',
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      });

      await applyStealth(context);

      const page = await context.newPage();

      page.on('crash', () => {
        log.error({ bookmakerKey }, 'Page crashed — will be destroyed from pool');
        page._crashed = true;
      });

      try {
        log.info({ bookmakerKey }, 'Running login + warmUp');
        await adapter.login(page);
        await adapter.warmUp(page);
        log.info({ bookmakerKey }, 'Browser context warmed and ready');
      } catch (err) {
        log.error({ bookmakerKey, err: err.message }, 'Warm-up failed, destroying context');
        await context.close().catch(() => {});
        throw err;
      }

      page._context = context;
      return page;
    },

    async destroy(page) {
      try {
        if (page._isPersistent) {
          await page.close();
        } else {
          await page._context?.close();
        }
        log.info({ bookmakerKey }, 'Browser resources closed');
      } catch (err) {
        log.warn({ bookmakerKey, err: err.message }, 'Error closing browser resources');
      }
    },

    validate(page) {
      if (page._crashed) return false;
      if (!page.isClosed()) return true;
      return false;
    },
  };

  const pool = createPool(factory, {
    min: config.browserPool.min,
    max: config.browserPool.max,
    testOnBorrow: true,
    autostart: false,
    acquireTimeoutMillis: 15000,
    idleTimeoutMillis: 60000,
    evictionRunIntervalMillis: 30000,
  });

  pool.on('factoryCreateError', (err) => {
    log.error({ bookmakerKey, err: err.message }, 'Pool factory create error');
  });

  pool.on('factoryDestroyError', (err) => {
    log.error({ bookmakerKey, err: err.message }, 'Pool factory destroy error');
  });

  return pool;
}

/**
 * Register and warm-up a bookmaker browser pool.
 * @param {string} bookmakerKey
 * @param {import('../adapters/baseAdapter.js').BaseAdapter} adapter
 */
export async function initPool(bookmakerKey, adapter) {
  if (pools.has(bookmakerKey)) {
    log.warn({ bookmakerKey }, 'Pool already initialized, skipping');
    return;
  }
  const pool = createBookmakerPool(bookmakerKey, adapter);
  pools.set(bookmakerKey, pool);
  await pool.start();
  log.info({ bookmakerKey, min: config.browserPool.min }, 'Pool started');
}

/**
 * Borrow a warmed page from the pool for a bookmaker.
 * @param {string} bookmakerKey
 * @returns {Promise<import('playwright').Page>}
 */
export async function acquirePage(bookmakerKey) {
  const pool = pools.get(bookmakerKey);
  if (!pool) throw new Error(`No pool found for bookmaker: ${bookmakerKey}`);
  return pool.acquire();
}

/**
 * Return a page back to the pool after use.
 * @param {string} bookmakerKey
 * @param {import('playwright').Page} page
 */
export async function releasePage(bookmakerKey, page) {
  const pool = pools.get(bookmakerKey);
  if (!pool) return;
  await pool.release(page);
}

/**
 * Permanently remove a page from the pool (e.g. after crash).
 * @param {string} bookmakerKey
 * @param {import('playwright').Page} page
 */
export async function destroyPage(bookmakerKey, page) {
  const pool = pools.get(bookmakerKey);
  if (!pool) return;
  await pool.destroy(page);
}

/**
 * Drain and terminate all pools gracefully.
 */
export async function drainAllPools() {
  for (const [key, pool] of pools.entries()) {
    log.info({ bookmakerKey: key }, 'Draining pool');
    await pool.drain();
    await pool.clear();
  }
  pools.clear();
  log.info('All browser pools drained');
}
