/**
 * Tiny i18n layer.
 *
 * Static markup uses:
 *   data-i18n="path.to.key"         -> textContent
 *   data-i18n-html="path.to.key"    -> innerHTML (trusted locale strings only)
 *   data-i18n-attr="attr:path,..."  -> attributes (aria-label, placeholder, ...)
 *
 * Locale values may be strings or functions (for plurals / parameters).
 */
import en from './locales/en.js';
import fa from './locales/fa.js';

export const LOCALES = {
  en: { dir: 'ltr', numberLocale: 'en-US', strings: en },
  fa: { dir: 'rtl', numberLocale: 'fa-IR', strings: fa },
};
export const DEFAULT_LANG = 'en';
const STORAGE_KEY = 'lottie2avd.lang';

let lang = DEFAULT_LANG;
const listeners = new Set();

function lookup(strings, key) {
  return key.split('.').reduce((o, k) => (o == null ? o : o[k]), strings);
}

/** Translates `key`; extra args are passed to function values. */
export function t(key, ...args) {
  let v = lookup(LOCALES[lang].strings, key);
  if (v == null) v = lookup(LOCALES[DEFAULT_LANG].strings, key);
  if (typeof v === 'function') return v(...args);
  return v == null ? key : v;
}

/** Formats a number using the current language's digits. */
export function num(n, opts) {
  return Number(n).toLocaleString(LOCALES[lang].numberLocale, opts);
}

export const getLang = () => lang;

/** Language from ?lang=, then localStorage, then the default (English). */
export function detectLang() {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (q && LOCALES[q]) return q;
  } catch (e) { /* ignore */ }
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s && LOCALES[s]) return s;
  } catch (e) { /* storage may be unavailable */ }
  return DEFAULT_LANG;
}

/** Applies translations to all annotated elements under `root`. */
export function translateDom(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });
  root.querySelectorAll('[data-i18n-attr]').forEach(el => {
    el.dataset.i18nAttr.split(',').forEach(pair => {
      const [attr, key] = pair.split(':').map(s => s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    });
  });
}

/** Switches language, updates <html lang/dir>, and notifies listeners. */
export function setLang(next, { persist = true } = {}) {
  if (!LOCALES[next]) next = DEFAULT_LANG;
  lang = next;
  const html = document.documentElement;
  html.lang = next;
  html.dir = LOCALES[next].dir;
  document.title = t('meta.title');
  const description = document.querySelector('meta[name="description"]');
  if (description) description.content = t('meta.description');
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) canonical.href = canonical.href.split('?')[0] + (next === DEFAULT_LANG ? '' : `?lang=${next}`);
  if (persist) {
    try { localStorage.setItem(STORAGE_KEY, next); } catch (e) { /* ignore */ }
  }
  translateDom();
  listeners.forEach(fn => fn(next));
}

export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
