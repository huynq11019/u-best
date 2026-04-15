// T003 - Base configuration loader
import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  minProfitPct: parseFloat(process.env.MVP_MIN_PROFIT_PCT || '3.0'),
  staleWindowMs: parseInt(process.env.STALE_WINDOW_MS || '5000', 10),
  dedupTtlSeconds: parseInt(process.env.DEDUP_TTL_SECONDS || '300', 10),
  executionDeadlineMs: parseInt(process.env.EXECUTION_DEADLINE_MS || '20000', 10),
  maxStakePerLeg: parseFloat(process.env.MAX_STAKE_PER_LEG || '1000'),
  allowedBookmakers: (process.env.ALLOWED_BOOKMAKERS || 'saba,x1,lu88').split(',').map(b => b.trim()),
  bookkies: {
    saba: {
      baseUrl: process.env.SABA_BASE_URL || 'https://saba.sport',
      username: process.env.SABA_USERNAME || '',
      password: process.env.SABA_PASSWORD || '',
    },
    x1: {
      baseUrl: process.env.X1_BASE_URL || 'https://1xbet.com',
      username: process.env.X1_USERNAME || '',
      password: process.env.X1_PASSWORD || '',
    },
    lu88: {
      baseUrl: process.env.LU88_BASE_URL || 'https://lu88.moe',
      username: process.env.LU88_USERNAME || '',
      password: process.env.LU88_PASSWORD || '',
    },
  },
  browserPool: {
    min: parseInt(process.env.BROWSER_POOL_MIN || '1', 10),
    max: parseInt(process.env.BROWSER_POOL_MAX || '3', 10),
    headless: process.env.BROWSER_HEADLESS !== 'false',
    userDataDir: process.env.CHROME_USER_DATA_DIR || null, // e.g., /Users/name/Library/Application Support/Google/Chrome
    executablePath: process.env.CHROME_EXECUTABLE_PATH || null, // e.g., /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
  },
};
