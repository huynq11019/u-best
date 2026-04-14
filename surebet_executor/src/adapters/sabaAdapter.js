// T014 - Saba UI Adapter: login (session-restore), warmUp, placeBet, hedgeLeg, voidLeg, getActiveOdds
import { BaseAdapter, SportType } from './baseAdapter.js';
import { childLogger } from '../config/logger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = childLogger({ component: 'sabaAdapter' });

// ─── Constants ────────────────────────────────────────────────────────────────

const HOME_URL  = 'https://www.bhxc969.net/Home/Index';
const LOBBY_URL = 'https://www.bhxc969.net/Game/OneBookSportGameLobby';

/**
 * Domains known to host the Saba sportsbook iframe content.
 * Used to identify the embedded frame after the lobby loads.
 */
const SABA_IFRAME_DOMAINS = ['net2cast.com', 'botjfpwy7.com', 'ibc003.com', 'ibcbet.com', 'saba.sport'];

/** Timeout (ms) to wait for the Saba iframe to appear in the lobby. */
const IFRAME_LOAD_TIMEOUT_MS = 15000;

/**
 * Path to the session snapshot file.
 * Stores cookies + localStorage after a successful manual login,
 * so subsequent runs can restore the session automatically.
 */
const SESSION_FILE = path.resolve(__dirname, '../../.saba_session.json');

/**
 * Selectors that are visible only when the user is authenticated.
 * At least one must be present for the session to be considered valid.
 */
const LOGGED_IN_SELECTORS = [
  'a#signout',                     // "Đăng xuất" link
  'a.memberCtrl[href*="signout"]',
  '[ng-click*="signout"]',
  '[ng-click*="logout"]',
  '.member-area',
  '#memberArea',
  'span.balance',
  'span.username',
  '.user-balance',
];

/** Timeout (ms) to wait for the user to be verified as logged in. */
const LOGIN_VERIFY_TIMEOUT_MS = 15000;
const LOGIN_POLL_INTERVAL_MS  = 1500;

// ─── Session helpers ──────────────────────────────────────────────────────────

/**
 * Save cookies + a selection of localStorage keys to disk.
 * @param {import('playwright').Page} page
 */
async function saveSession(page) {
  try {
    const cookies = await page.context().cookies();

    const storage = await page.evaluate(() => {
      const data = {};
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        data[`ss:${k}`] = sessionStorage.getItem(k);
      }
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        // Only pick up auth/token keys to keep snapshot small
        if (/token|refresh|auth|session|member|user/i.test(k)) {
          data[`ls:${k}`] = localStorage.getItem(k);
        }
      }
      return data;
    });

    const snapshot = { cookies, storage, savedAt: new Date().toISOString() };
    fs.writeFileSync(SESSION_FILE, JSON.stringify(snapshot, null, 2), 'utf-8');
    log.info({ path: SESSION_FILE }, 'Saba: session snapshot saved');
  } catch (err) {
    log.warn({ err: err.message }, 'Saba: could not save session snapshot');
  }
}

/**
 * Restore cookies + localStorage from the snapshot file.
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>} true if a snapshot was loaded
 */
async function restoreSession(page) {
  if (!fs.existsSync(SESSION_FILE)) {
    log.info('Saba: no session snapshot found — fresh login required');
    return false;
  }

  try {
    const raw  = fs.readFileSync(SESSION_FILE, 'utf-8');
    const snap = JSON.parse(raw);

    // Inject cookies into the browser context
    if (snap.cookies && snap.cookies.length > 0) {
      await page.context().addCookies(snap.cookies);
      log.info({ count: snap.cookies.length }, 'Saba: restored cookies from snapshot');
    }

    // Navigate first so that localStorage can be set on correct origin
    await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1000);

    // Restore localStorage / sessionStorage
    if (snap.storage && Object.keys(snap.storage).length > 0) {
      await page.evaluate((storageMap) => {
        for (const [key, value] of Object.entries(storageMap)) {
          if (key.startsWith('ls:')) {
            localStorage.setItem(key.slice(3), value);
          } else if (key.startsWith('ss:')) {
            try { sessionStorage.setItem(key.slice(3), value); } catch (_) {}
          }
        }
      }, snap.storage);
      log.info({ count: Object.keys(snap.storage).length }, 'Saba: restored storage from snapshot');
    }

    log.info({ savedAt: snap.savedAt }, 'Saba: session snapshot restored');
    return true;
  } catch (err) {
    log.warn({ err: err.message }, 'Saba: failed to restore session snapshot — will require manual login');
    return false;
  }
}

/**
 * Poll the page for any logged-in selector until one is visible or timeout.
 * @param {import('playwright').Page} page
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
async function waitForLoggedIn(page, timeoutMs = LOGIN_VERIFY_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const sel of LOGGED_IN_SELECTORS) {
      try {
        const visible = await page.locator(sel).first().isVisible({ timeout: 300 });
        if (visible) return true;
      } catch (_) {}
    }
    await page.waitForTimeout(LOGIN_POLL_INTERVAL_MS);
  }
  return false;
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

/**
 * Saba bookmaker adapter for bhxc969.net.
 *
 * ## Authentication Strategy
 * The Saba login page requires a human-solvable CAPTCHA, so automated
 * credential submission is not feasible.  Instead we use a **session-restore**
 * approach:
 *
 *  1. On first run: open the browser (non-headless), navigate to the home page,
 *     and wait silently for the user to log in manually.
 *  2. After login is detected: snapshot cookies + relevant storage tokens to
 *     `.saba_session.json` on disk.
 *  3. On subsequent runs: inject the snapshot, reload the page — the site sees
 *     a valid session and logs the user in automatically without any CAPTCHA.
 */
export default class SabaAdapter extends BaseAdapter {
  constructor(bookmakerKey, bookkieConfig) {
    super(bookmakerKey, bookkieConfig);
  }

  // ── login ──────────────────────────────────────────────────────────────────

  /**
   * Opens the home page and waits indefinitely for the user to manually load the Lobby page.
   * Tool takes over when the user pastes the lobby URL into the original tab.
   * @param {import('playwright').Page} page
   */
  async login(page) {
    log.info('Saba: Bật trình duyệt. Bạn hãy login, click mở sảnh Saba rồi copy URL của tab sảnh dán đè lại vào tab gốc (Tab 1) này.');
    
    // Fallback direct URL if the user doesn't already have the browser tab open to HOME_URL
    if (!page.url().includes('bhxc969.net')) {
      await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }

    // Wait until the user manually navigates Tab 1 into the lobby
    await page.waitForFunction((lobbyUrl) => {
      const isLobby = window.location.href.includes('OneBookSportGameLobby') || window.location.href.includes('CheckGame');
      const hasIframe = Array.from(document.querySelectorAll('iframe')).some(f => 
        f.src.includes('net2cast.com') || f.src.includes('botjfpwy7.com') || f.src.includes('ibc003.com')
      );
      return isLobby || hasIframe;
    }, LOBBY_URL, { timeout: 0 }); // wait indefinitely

    log.info('Saba: Đã nhận diện sảnh Game Lobby. Tool bắt đầu lấy kèo!');
    this._isLoggedIn = true;
  }

  // ── warmUp ─────────────────────────────────────────────────────────────────

  /**
   * Navigate to the Saba game lobby and wait for the embedded iframe to load.
   * IF already in the lobby, skip navigation to prevent wiping user's manual session.
   * @param {import('playwright').Page} page
   */
  async warmUp(page) {
    if (!page.url().includes('OneBookSportGameLobby') && !page.url().includes('CheckGame')) {
      log.info('Saba: warming up — navigating to game lobby');
      await page.goto(LOBBY_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);
    } else {
      log.info('Saba: warming up — already in game lobby natively!');
    }

    const iframeSrc = await this._findSabaIframeSrc(page);
    if (iframeSrc) {
      log.info({ iframeSrc }, 'Saba: Saba iframe detected in lobby');
    } else {
      log.warn('Saba: Saba iframe not found in lobby — page structure may have changed, or we are directly in the provider lobby');
    }

    log.info('Saba: warm-up complete');
  }

  /**
   * Find the src URL of the embedded Saba cross-origin iframe.
   * @param {import('playwright').Page} page
   * @returns {Promise<string|null>}
   */
  async _findSabaIframeSrc(page) {
    try {
      const iframes = await page.evaluate((knownDomains) => {
        return Array.from(document.querySelectorAll('iframe'))
          .map(f => f.src)
          .filter(src => src && knownDomains.some(d => src.includes(d)));
      }, SABA_IFRAME_DOMAINS);

      if (iframes.length > 0) return iframes[0];

      // If no known domain matched, return the first non-empty iframe src
      const fallback = await page.evaluate(() => {
        const f = document.querySelector('iframe[src]');
        return f ? f.src : null;
      });
      return fallback;
    } catch (err) {
      log.warn({ err: err.message }, 'Saba: could not inspect iframe src');
      return null;
    }
  }

  // ── getActiveOdds ──────────────────────────────────────────────────────────

  /**
   * Fetch OU (Over/Under) odds for football from the Saba game lobby.
   *
   * The Saba lobby at bhxc969.net embeds the sportsbook in a **cross-origin
   * iframe** (hosted on rrl.net2cast.com / botjfpwy7.com).  Because direct
   * DOM access across origins is blocked by the browser, we use two strategies:
   *
   *   A) Navigate directly to the iframe's src URL — the session cookies set
   *      on the bhxc969.net domain are shared with the embedded frame, so the
   *      external platform will recognise the session and render the odds.
   *   B) Use Playwright frameLocator() to access the iframe context and scrape
   *      from within (works only when Playwright can pierce the frame boundary).
   *
   * @param {import('playwright').Page} page
   * @param {string} [sportType=SportType.FOOTBALL]
   * @returns {Promise<import('./baseAdapter.js').ActiveOdd[]>}
   */
  async getActiveOdds(page, sportType = SportType.FOOTBALL) {
    if (sportType !== SportType.FOOTBALL && sportType !== SportType.ALL) {
      log.warn({ sportType }, 'Saba: only football OU odds are supported; returning empty');
      return [];
    }

    // Only navigate if we are NOT already in the lobby or inside the provider iframe
    const currentUrl = page.url();
    const isLobby = currentUrl.includes('OneBookSportGameLobby') || currentUrl.includes('CheckGame');
    const isAlreadyInProvider = SABA_IFRAME_DOMAINS.some(d => currentUrl.includes(d));

    if (!isLobby && !isAlreadyInProvider) {
      log.info({ sportType }, 'Saba: getActiveOdds — loading game lobby');
      await page.goto(LOBBY_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(4000);
    }

    // ── Strategy A: Provider scrape (check if we are literally in the provider page) ──────
    const frameOdds = await this._scrapeFromFrames(page);
    if (frameOdds.length > 0) {
      log.info({ count: frameOdds.length }, 'Saba: getActiveOdds complete (frame scrape)');
      return frameOdds;
    }

    // If the window itself is the provider page it won't have an iframe src in domains!
    const directOdds = await this._scrapeSabaOddsFromPage(page, sportType);
    if (directOdds.length > 0) {
      log.info({ count: directOdds.length }, 'Saba: getActiveOdds complete (direct page scrape)');
      return directOdds;
    }

    // ── Strategy B: navigate directly to the iframe src (if we are in wrapper) ────────────
    const iframeSrc = await this._findSabaIframeSrc(page);
    if (iframeSrc) {
      log.info({ iframeSrc }, 'Saba: navigating directly to Saba iframe src');
      try {
        await page.goto(iframeSrc, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(5000);
        const nestedOdds = await this._scrapeSabaOddsFromPage(page, sportType);
        if (nestedOdds.length > 0) {
          log.info({ count: nestedOdds.length }, 'Saba: getActiveOdds complete (iframe navigation)');
          return nestedOdds;
        }
      } catch (err) {
        log.warn({ err: err.message }, 'Saba: direct iframe navigation failed');
      }
    }

    log.warn('Saba: getActiveOdds — no OU odds found via any strategy');
    return [];
  }

  /**
   * Scrape OU odds from the current page (used after direct iframe navigation).
   * Covers both old and new Saba sportsbook UI layouts.
   *
   * Visual layout from inspector:
   *   Columns: [League] [Teams] [Handicap line/odds] [OU line | Over(o) | Under(u)] [1X2]
   *   Live matches are tagged "TRỰC TIẾP" with a running time (e.g. "2H 37'")
   *
   * @param {import('playwright').Page} page
   * @param {string} sportType
   * @returns {Promise<import('./baseAdapter.js').ActiveOdd[]>}
   */
  async _scrapeSabaOddsFromPage(page, sportType) {
    return page.evaluate((sport) => {
      const results = [];

      const text = (el, sel) => {
        if (!el) return '';
        const node = sel ? el.querySelector(sel) : el;
        return (node?.textContent || '').trim().replace(/\s+/g, ' ');
      };

      const parseNum = (raw) => {
        const n = parseFloat((raw || '').replace(/,/g, '.'));
        return isNaN(n) ? null : n;
      };

      /**
       * Saba sportsbook renders matches in <tr> rows grouped under league headers.
       * Known selectors (confirmed via visual inspection):
       *   - Match rows:   tr[id^="tr"], tr.ng-scope[id], tr[class*="match"]
       *   - Home team:    td.team-name:nth-child(1), .home-name, [class*="HomeTeam"]
       *   - Away team:    td.team-name:nth-child(2), .away-name, [class*="AwayTeam"]
       *   - OU line:      td[class*="hdp"] or td with text like "3.00", "3.25"
       *   - Over (o):     .o-odds, [class*="overOdds"], span.o (first odds after line)
       *   - Under (u):    .u-odds, [class*="underOdds"], span.u (second odds after line)
       *   - Time:         td.time, .match-time, [class*="live-time"]
       *   - League header:tr[class*="league"], tr.comp-row, .comp-name, .leagueName
       */

      // ── collect all candidate row elements ────────────────────────────────
      const rowSelectors = [
        'tr[id^="tr"]',            // Saba classic: rows with id="tr12345"
        'tr.ng-scope',             // AngularJS rendered rows
        'tr[class*="match"]',
        '[class*="match-row"]',
        '[class*="event-row"]',
        '[data-event-id]',
        '[data-match-id]',
      ].join(', ');

      const rows = Array.from(document.querySelectorAll(rowSelectors));

      let currentLeague = '';

      rows.forEach((row, idx) => {
        try {
          // Detect league header rows (they usually have colspan and league name)
          const isLeagueHeader =
            row.classList.contains('league') ||
            row.classList.contains('comp-row') ||
            row.getAttribute('colspan') === '100' ||
            (row.cells && row.cells.length <= 2 && row.cells[0]?.colSpan > 3);

          if (isLeagueHeader) {
            const leagueText = text(row);
            if (leagueText) currentLeague = leagueText;
            return;
          }

          // ── ID ──────────────────────────────────────────────────────────
          const rowId = row.id || '';
          const eventId =
            row.getAttribute('data-event-id') ||
            row.getAttribute('data-match-id') ||
            (rowId.startsWith('tr') ? rowId.slice(2) : rowId) ||
            `saba-${idx + 1}`;

          // ── Teams ────────────────────────────────────────────────────────
          const homeEl = row.querySelector(
            '.home-name, [class*="HomeTeam"], [class*="home-team"], [class*="home_team"], ' +
            'td.team:nth-of-type(1), td[class*="team"]:first-child',
          );
          const awayEl = row.querySelector(
            '.away-name, [class*="AwayTeam"], [class*="away-team"], [class*="away_team"], ' +
            'td.team:nth-of-type(2), td[class*="team"]:last-child',
          );

          // Saba sometimes puts both teams in one cell separated by " vs " or newline
          const teamsCell = row.querySelector('.team-name, [class*="teams"], [class*="match-name"]');
          let home = text(homeEl) || '';
          let away = text(awayEl) || '';

          if ((!home || !away) && teamsCell) {
            const raw = teamsCell.textContent.replace(/\s+/g, ' ').trim();
            const parts = raw.split(/\bvs\b|\n/i).map(s => s.trim());
            if (parts.length >= 2) { home = home || parts[0]; away = away || parts[1]; }
          }

          if (!home && !away) return; // skip rows without team info

          home = home || 'Unknown';
          away = away || 'Unknown';

          // ── League (from row or from last header) ─────────────────────
          const leagueEl = row.querySelector(
            '[class*="league"], [class*="comp"], [class*="competition"]',
          );
          const league = text(leagueEl) || currentLeague;

          // ── Start time ────────────────────────────────────────────────
          const timeEl = row.querySelector(
            '.match-time, .time, [class*="live-time"], [class*="kickoff"], [class*="matchTime"]',
          );
          const startTime = text(timeEl);

          // ── OU odds ──────────────────────────────────────────────────
          // Saba columns (Tài Xỉu): [hdp/line] [Over(o)] [Under(u)]
          // Cells are usually ordered left-to-right; look for explicit classes first.
          const overEl = row.querySelector(
            '.o-odds, [class*="over-odds"], [class*="overOdds"], [class*="ou-o"], ' +
            'span.o, td.o, [data-type="over"], [data-bet="over"]',
          );
          const underEl = row.querySelector(
            '.u-odds, [class*="under-odds"], [class*="underOdds"], [class*="ou-u"], ' +
            'span.u, td.u, [data-type="under"], [data-bet="under"]',
          );
          const lineEl = row.querySelector(
            '[class*="hdp"], [class*="ou-line"], [class*="ou-hdp"], ' +
            '.handicap, [class*="spread"], td.line',
          );

          let overOdds  = parseNum(text(overEl));
          let underOdds = parseNum(text(underEl));
          const line    = parseNum(text(lineEl));

          // Fallback: if explicit o/u classes not found, try reading all numeric
          // tds and pick the two after the handicap line position
          if (overOdds === null && underOdds === null) {
            const cells = Array.from(row.querySelectorAll('td'));
            // find cell with a line-like value (e.g. 2.5, 3, 3.25)
            let lineIdx = -1;
            cells.forEach((cell, ci) => {
              const v = parseNum(cell.textContent);
              if (v !== null && v > 0 && v < 10 && (v % 0.25 === 0 || v % 0.5 === 0)) {
                if (lineIdx === -1) lineIdx = ci;
              }
            });
            if (lineIdx >= 0 && lineIdx + 2 < cells.length) {
              overOdds  = parseNum(cells[lineIdx + 1]?.textContent);
              underOdds = parseNum(cells[lineIdx + 2]?.textContent);
            }
          }

          const selections = [];
          if (overOdds  !== null) selections.push({ label: 'Over',  odds: overOdds,  line });
          if (underOdds !== null) selections.push({ label: 'Under', odds: underOdds, line });

          if (selections.length > 0) {
            results.push({
              eventId,
              sport,
              home,
              away,
              league,
              marketType: 'OU',
              startTime,
              selections,
              scope: startTime.includes("'") || startTime.toLowerCase().includes('live') ? 'live' : 'prematch',
            });
          }
        } catch (_) {
          // Skip malformed rows silently
        }
      });

      return results;
    }, sportType);
  }

  /**
   * Attempt to scrape OU odds from Playwright frame objects.
   * Works only for same-origin or frames where Playwright can access the DOM.
   * @param {import('playwright').Page} page
   * @returns {Promise<import('./baseAdapter.js').ActiveOdd[]>}
   */
  async _scrapeFromFrames(page) {
    const allOdds = [];

    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue; // already handled via direct nav
      try {
        const frameUrl = frame.url();
        if (!frameUrl || frameUrl === 'about:blank') continue;
        log.debug({ frameUrl }, 'Saba: evaluating child frame');

        // Only try frames that originate from known Saba domains
        const isSabaDomain = SABA_IFRAME_DOMAINS.some(d => frameUrl.includes(d));
        if (!isSabaDomain) {
          log.debug({ frameUrl }, 'Saba: skipping non-Saba frame');
          continue;
        }

        const odds = await this._scrapeSabaOddsFromPage(
          { evaluate: (fn, arg) => frame.evaluate(fn, arg) },
          'football',
        );
        allOdds.push(...odds);
      } catch (err) {
        log.debug({ frameUrl: frame.url(), err: err.message }, 'Saba: frame scrape skipped (cross-origin or error)');
      }
    }

    return allOdds;
  }

  // ── placeBet ───────────────────────────────────────────────────────────────

  /**
   * Place a bet on the Saba UI.
   * @param {import('playwright').Page} page
   * @param {import('../models/index.js').BetLeg} leg
   * @returns {Promise<{ order_ref: string, placed_odds: number, placed_stake: number }>}
   */
  async placeBet(page, leg) {
    log.info({ leg: { type: leg.type, odds: leg.odds, stake: leg.stake } }, 'Saba: placing bet');
    // TODO: implement actual UI interaction when bet-slip selectors are confirmed.
    throw new Error(
      'SabaAdapter.placeBet() not yet implemented — Saba bet-slip selectors need confirmation',
    );
  }

  // ── hedgeLeg ───────────────────────────────────────────────────────────────

  /**
   * @param {import('playwright').Page} page
   * @param {import('../models/index.js').BetLeg} leg
   */
  async hedgeLeg(page, leg) {
    log.warn({ leg: { type: leg.type, book: leg.book } }, 'Saba: hedgeLeg called — not yet implemented');
    throw new Error('SabaAdapter.hedgeLeg() not yet implemented');
  }

  // ── voidLeg ────────────────────────────────────────────────────────────────

  /**
   * @param {import('playwright').Page} page
   * @param {string} orderRef
   */
  async voidLeg(page, orderRef) {
    log.warn({ orderRef }, 'Saba: voidLeg called — not yet implemented');
    throw new Error('SabaAdapter.voidLeg() not yet implemented');
  }
}
