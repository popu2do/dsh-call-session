/**
 * Localization Registry and Dynamic Locale Resolver for dsh-call-session
 */

import zh from './zh.mjs';
import en from './en.mjs';

export const SUPPORTED_LOCALES = Object.freeze(['zh', 'en']);
export const DEFAULT_LOCALE = 'en';

export const CATALOGS = Object.freeze({
  zh,
  en
});

export function normalizeLocaleTag(val) {
  if (typeof val !== 'string') return null;
  const lower = val.toLowerCase().trim();
  if (lower.startsWith('zh')) return 'zh';
  if (lower.startsWith('en')) return 'en';
  return null;
}

/**
 * Resolves the effective locale string ('zh' | 'en') based on the decision hierarchy:
 * 1. Host settings preference (ctx.get('settings').get('locale'))
 * 2. Explicit plugin config (config.locale === 'zh' | 'en')
 * 3. System environment auto-detection (Intl / process.env.LANG / LC_ALL)
 *
 * @param {object} [ctx] Cordis / DSH host context
 * @param {object} [config] Plugin configuration
 * @returns {'zh' | 'en'}
 */
export function resolveLocale(ctx, config) {
  // 1. Host settings preference
  try {
    const settings = typeof ctx?.get === 'function' ? ctx.get('settings') : (ctx?.settings || null);
    if (settings && typeof settings.get === 'function') {
      const raw = settings.get('locale');
      const pref = typeof raw === 'string' ? raw : (raw?.preference || settings.get('locale.preference'));
      const tag = normalizeLocaleTag(pref);
      if (tag) return tag;
    }
  } catch {
    // Ignore settings access errors and fall through
  }

  // 2. Explicit plugin configuration
  const cfgTag = normalizeLocaleTag(config?.locale);
  if (cfgTag) return cfgTag;

  // 3. Process environment variables and system Intl detection
  try {
    const candidates = [
      process.env.LC_ALL,
      process.env.LANG,
      typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function'
        ? Intl.DateTimeFormat().resolvedOptions().locale
        : ''
    ].filter(Boolean).map(s => s.toLowerCase());

    for (const item of candidates) {
      if (item.includes('zh') || item.includes('chinese')) {
        return 'zh';
      }
    }
  } catch {
    // Ignore environment detection errors
  }

  return DEFAULT_LOCALE;
}

/**
 * Returns the localization catalog for the specified or resolved locale.
 *
 * @param {'zh' | 'en' | string} [locale] Target locale
 * @returns {typeof zh}
 */
export function getCatalog(locale) {
  return normalizeLocaleTag(locale) === 'zh' ? zh : en;
}

export function resolveMessages(ctx, config) {
  return getCatalog(resolveLocale(ctx, config)).messages;
}

export { zh, en };
