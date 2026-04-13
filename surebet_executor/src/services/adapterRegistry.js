// T009 - Adapter Registry: dynamic loading and routing to bookmaker adapters
import { childLogger } from '../config/logger.js';
import { config } from '../config/index.js';

const log = childLogger({ component: 'adapterRegistry' });

const registry = new Map();

/**
 * Register a bookmaker adapter instance manually.
 * @param {string} bookmakerKey
 * @param {import('../adapters/baseAdapter.js').BaseAdapter} adapter
 */
export function registerAdapter(bookmakerKey, adapter) {
  registry.set(bookmakerKey, adapter);
  log.info({ bookmakerKey }, 'Adapter registered');
}

/**
 * Retrieve a registered adapter by bookmaker key.
 * @param {string} bookmakerKey
 * @returns {import('../adapters/baseAdapter.js').BaseAdapter}
 */
export function getAdapter(bookmakerKey) {
  const adapter = registry.get(bookmakerKey);
  if (!adapter) {
    throw new Error(`No adapter registered for bookmaker: "${bookmakerKey}". Allowed: ${config.allowedBookmakers.join(', ')}`);
  }
  return adapter;
}

/**
 * Check whether an adapter is registered for a given key.
 * @param {string} bookmakerKey
 * @returns {boolean}
 */
export function hasAdapter(bookmakerKey) {
  return registry.has(bookmakerKey);
}

/**
 * Return all registered bookmaker keys.
 * @returns {string[]}
 */
export function listAdapters() {
  return Array.from(registry.keys());
}

/**
 * Dynamically load all built-in adapters from the adapters/ directory.
 * Adapters must export a default class extending BaseAdapter.
 * @returns {Promise<void>}
 */
export async function loadBuiltInAdapters() {
  const adapterModules = {
    saba: '../adapters/sabaAdapter.js',
    x1: '../adapters/x1Adapter.js',
  };

  for (const [key, modulePath] of Object.entries(adapterModules)) {
    try {
      const mod = await import(modulePath);
      const AdapterClass = mod.default;
      const instance = new AdapterClass(key, config.bookkies[key] || {});
      registerAdapter(key, instance);
    } catch (err) {
      log.error({ bookmakerKey: key, err: err.message }, 'Failed to load adapter — skipping');
    }
  }

  log.info({ adapters: listAdapters() }, 'Built-in adapters loaded');
}
