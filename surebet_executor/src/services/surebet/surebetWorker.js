// T016 - Background worker for surebet detection and notifications
import { EventEmitter } from 'events';
import { scanSurebets } from './surebetFinder.js';
import { childLogger } from '../../config/logger.js';
import { config } from '../../config/index.js';

const log = childLogger({ component: 'surebetWorker' });

// SSE event emitter for real-time push to connected clients
export const surebetEmitter = new EventEmitter();
surebetEmitter.setMaxListeners(50);

// Worker state
let workerState = {
  isRunning: false,
  lastRunAt: null,
  lastError: null,
  runCount: 0,
  totalSurebetsFound: 0,
  scanIntervalMs: parseInt(process.env.SUREBET_SCAN_INTERVAL_MS || '15000'),
  ringBuffer: [],
  ringBufferSize: parseInt(process.env.SUREBET_LATEST_BUFFER_SIZE || '50'),
  dedupCache: new Set(),
  dedupTtlSeconds: parseInt(process.env.SUREBET_DEDUP_TTL_S || '120')
};

// Cleanup dedup cache periodically
setInterval(() => {
  if (workerState.dedupCache.size > 1000) {
    workerState.dedupCache.clear();
    log.debug('Cleared dedup cache to prevent memory leak');
  }
}, workerState.dedupTtlSeconds * 1000);

/**
 * Start the surebet worker
 */
export function startWorker() {
  if (workerState.isRunning) {
    log.warn('Worker is already running');
    return;
  }

  const enabled = process.env.SUREBET_WORKER_ENABLED === 'true';
  const mockMode = process.env.SUREBET_MOCK_MODE === 'true';
  
  if (!enabled && !mockMode) {
    log.info('Surebet worker is disabled (SUREBET_WORKER_ENABLED != true)');
    return;
  }

  if (mockMode) {
    // In mock mode, add some sample data to ring buffer
    addMockDataToBuffer();
    log.info('Surebet worker in mock mode - added sample data to buffer');
    return;
  }

  workerState.isRunning = true;
  log.info({ 
    interval: workerState.scanIntervalMs,
    ringBufferSize: workerState.ringBufferSize,
    dedupTtl: workerState.dedupTtlSeconds
  }, 'Starting surebet worker');

  // Run first scan immediately
  setTimeout(runWorkerLoop, 1000);
}

/**
 * Stop the surebet worker
 */
export function stopWorker() {
  workerState.isRunning = false;
  log.info('Surebet worker stopped');
}

/**
 * Main worker loop
 */
async function runWorkerLoop() {
  if (!workerState.isRunning) return;

  try {
    const startTime = Date.now();
    log.debug('Starting worker scan');

    const result = await scanSurebets();
    
    // Process new surebets
    const newSurebets = [];
    for (const surebet of result.surebets) {
      const dedupKey = createDedupKey(surebet);
      if (!workerState.dedupCache.has(dedupKey)) {
        workerState.dedupCache.add(dedupKey);
        newSurebets.push(surebet);
        
        // Add to ring buffer
        addToRingBuffer(surebet);
      }
    }

    // Send notifications for new surebets
    if (newSurebets.length > 0) {
      await sendNotifications(newSurebets);
      // Emit SSE event for connected frontend clients
      surebetEmitter.emit('new_surebets', newSurebets);
    }

    // Update worker state
    workerState.lastRunAt = new Date().toISOString();
    workerState.lastError = null;
    workerState.runCount++;
    workerState.totalSurebetsFound += newSurebets.length;

    const scanTime = Date.now() - startTime;
    log.debug({ 
      scanTime,
      totalSurebets: result.surebets.length,
      newSurebets: newSurebets.length,
      ringBufferSize: workerState.ringBuffer.length
    }, 'Worker scan completed');

  } catch (error) {
    workerState.lastError = {
      message: error.message,
      timestamp: new Date().toISOString()
    };
    log.error({ error: error.message }, 'Worker scan failed');
  }

  // Schedule next run
  if (workerState.isRunning) {
    setTimeout(runWorkerLoop, workerState.scanIntervalMs);
  }
}

/**
 * Create deduplication key for a surebet
 */
function createDedupKey(surebet) {
  return `${surebet.matchKey}_${surebet.line}_${surebet.combination}`;
}

/**
 * Add surebet to ring buffer
 */
function addToRingBuffer(surebet) {
  workerState.ringBuffer.unshift({
    ...surebet,
    discovered_at: new Date().toISOString()
  });

  // Keep buffer size limited
  if (workerState.ringBuffer.length > workerState.ringBufferSize) {
    workerState.ringBuffer = workerState.ringBuffer.slice(0, workerState.ringBufferSize);
  }
}

/**
 * Add mock data to ring buffer for testing
 */
function addMockDataToBuffer() {
  const mockSurebets = [
    {
      matchKey: 'mock_match_1__mock_match_1_b',
      sport: 'football',
      league: 'Premier League',
      home: 'Manchester United',
      away: 'Liverpool',
      scope: 'live',
      line: 2.5,
      matchType: 'exact',
      matchScore: 1.0,
      combination: 'Over_A_Under_B',
      legs: [
        {
          book: 'lu88',
          side: 'Over',
          odds: 2.10,
          selectionId: 'mock_over_2.5',
          eventId: 'mock_match_1',
          stake_ratio: 0.476
        },
        {
          book: 'x1',
          side: 'Under',
          odds: 2.00,
          selectionId: 'mock_under_2.5',
          eventId: 'mock_match_1_b',
          stake_ratio: 0.524
        }
      ],
      implied: 0.976,
      profit_pct: 2.46,
      fetched_at: new Date().toISOString()
    },
    {
      matchKey: 'mock_match_2__mock_match_2_b',
      sport: 'football',
      league: 'La Liga',
      home: 'Real Madrid',
      away: 'Barcelona',
      scope: 'live',
      line: 3.0,
      matchType: 'exact',
      matchScore: 1.0,
      combination: 'Over_B_Under_A',
      legs: [
        {
          book: 'x1',
          side: 'Over',
          odds: 1.95,
          selectionId: 'mock_over_3.0_b',
          eventId: 'mock_match_2_b',
          stake_ratio: 0.513
        },
        {
          book: 'lu88',
          side: 'Under',
          odds: 1.90,
          selectionId: 'mock_under_3.0',
          eventId: 'mock_match_2',
          stake_ratio: 0.487
        }
      ],
      implied: 0.987,
      profit_pct: 1.31,
      fetched_at: new Date().toISOString()
    }
  ];

  for (const surebet of mockSurebets) {
    addToRingBuffer(surebet);
  }

  workerState.lastRunAt = new Date().toISOString();
  workerState.totalSurebetsFound = mockSurebets.length;
}

/**
 * Send notifications for new surebets
 */
async function sendNotifications(surebets) {
  const promises = [];

  // Webhook notification
  const webhookUrl = process.env.SUREBET_NOTIFY_WEBHOOK_URL;
  if (webhookUrl) {
    promises.push(sendWebhookNotification(webhookUrl, surebets));
  }

  // Telegram notification
  const telegramToken = process.env.SUREBET_TELEGRAM_BOT_TOKEN;
  const telegramChatId = process.env.SUREBET_TELEGRAM_CHAT_ID;
  if (telegramToken && telegramChatId) {
    promises.push(sendTelegramNotification(telegramToken, telegramChatId, surebets));
  }

  await Promise.allSettled(promises);
}

/**
 * Send webhook notification
 */
async function sendWebhookNotification(webhookUrl, surebets) {
  try {
    const payload = {
      type: 'surebet_discovery',
      timestamp: new Date().toISOString(),
      count: surebets.length,
      surebets
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'surebet-executor/1.0'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Webhook failed: ${response.status} ${response.statusText}`);
    }

    log.info({ webhookUrl, count: surebets.length }, 'Webhook notification sent');

  } catch (error) {
    log.warn({ webhookUrl, error: error.message }, 'Failed to send webhook notification');
  }
}

/**
 * Send Telegram notification
 */
async function sendTelegramNotification(botToken, chatId, surebets) {
  try {
    const format = process.env.SUREBET_NOTIFY_FORMAT || 'text';
    
    if (format === 'json') {
      const text = JSON.stringify({
        type: 'surebet_discovery',
        timestamp: new Date().toISOString(),
        count: surebets.length,
        surebets: surebets.slice(0, 5) // Limit to first 5 to avoid message size limits
      }, null, 2);

      await sendTelegramMessage(botToken, chatId, `🎯 New Surebets Found:\n\n${text}`);
    } else {
      // Text format
      const lines = surebets.slice(0, 5).map(s => 
        `• ${s.home} vs ${s.away}\n  Line: ${s.line} | Profit: ${s.profit_pct.toFixed(2)}%\n  ${s.legs[0].book}(${s.legs[0].side}) @ ${s.legs[0].odds} + ${s.legs[1].book}(${s.legs[1].side}) @ ${s.legs[1].odds}`
      );

      const text = `🎯 *${surebets.length} New Surebet${surebets.length > 1 ? 's' : ''} Found*\n\n${lines.join('\n\n')}${surebets.length > 5 ? '\n\n... and more' : ''}`;

      await sendTelegramMessage(botToken, chatId, text, true);
    }

    log.info({ chatId, count: surebets.length }, 'Telegram notification sent');

  } catch (error) {
    log.warn({ chatId, error: error.message }, 'Failed to send Telegram notification');
  }
}

/**
 * Send message via Telegram Bot API
 */
async function sendTelegramMessage(botToken, chatId, text, parseMode = null) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  
  const payload = {
    chat_id: chatId,
    text,
    disable_web_page_preview: true
  };

  if (parseMode) {
    payload.parse_mode = parseMode;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Telegram API failed: ${error.description || error.error_code}`);
  }
}

/**
 * Get latest surebets from ring buffer
 */
export async function getLatestSurebets(options = {}) {
  const { limit = 20, sport, minProfitPct } = options;
  
  let surebets = [...workerState.ringBuffer];
  
  // Apply filters
  if (sport) {
    surebets = surebets.filter(s => s.sport === sport);
  }
  
  if (minProfitPct !== undefined) {
    surebets = surebets.filter(s => s.profit_pct >= minProfitPct);
  }
  
  // Apply limit
  surebets = surebets.slice(0, limit);
  
  return {
    surebets,
    total_available: workerState.ringBuffer.length,
    filtered_count: surebets.length,
    last_updated: workerState.lastRunAt
  };
}

/**
 * Get worker health status
 */
export async function getSurebetHealth() {
  return {
    worker: {
      is_running: workerState.isRunning,
      enabled: process.env.SUREBET_WORKER_ENABLED === 'true',
      last_run_at: workerState.lastRunAt,
      last_error: workerState.lastError,
      run_count: workerState.runCount,
      total_surebets_found: workerState.totalSurebetsFound,
      scan_interval_ms: workerState.scanIntervalMs
    },
    cache: {
      ring_buffer_size: workerState.ringBuffer.length,
      ring_buffer_max_size: workerState.ringBufferSize,
      dedup_cache_size: workerState.dedupCache.size,
      dedup_ttl_seconds: workerState.dedupTtlSeconds
    },
    notifications: {
      webhook_enabled: !!process.env.SUREBET_NOTIFY_WEBHOOK_URL,
      telegram_enabled: !!(process.env.SUREBET_TELEGRAM_BOT_TOKEN && process.env.SUREBET_TELEGRAM_CHAT_ID)
    }
  };
}
