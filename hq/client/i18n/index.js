import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createUseStyles, useTheme } from 'react-jss';
import { joyaEn, joyaHe } from './dicts.js';

// Languages of the app: Hebrew and English (same design as the trade-hub phone app's
// client/i18n). The choice is kept in localStorage (`joya.lang`); with nothing saved,
// the browser language decides.
//
// Hebrew is right-to-left. `document.documentElement.dir` is set to `rtl`, so flex rows,
// text alignment and logical margins mirror by themselves; every Latin-script term
// (a code, money, a date) is wrapped in <Term>, a `bdi` that is left-to-right, isolated
// from the text around it and never broken across lines (`bdi.term` in index.html).
//
// Strings: t('key', vars). `{name}` placeholders come from `vars`. A key with a numeric
// `vars.count` first tries `key_one` (count === 1) or `key_other`, then `key`.

const DICTS = { en: joyaEn, he: joyaHe };
export const LANGS = [
  ['he', 'עברית'],
  ['en', 'English'],
];
const STORAGE_KEY = 'joya.lang';

let locale = 'he-IL';
/** The date/number locale of the chosen language (he-IL / en-US), for the formatters in ui.js. */
export function getLocale() {
  return locale;
}

function initialLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && DICTS[saved]) return saved;
  } catch {
    // storage blocked — fall through to the browser language
  }
  const nav = (typeof navigator !== 'undefined' && navigator.language) || 'he';
  return nav.toLowerCase().startsWith('en') ? 'en' : 'he';
}

function fill(str, vars) {
  return String(str).replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? String(vars[k]) : m));
}

export function translate(lang, key, vars) {
  const d = DICTS[lang] || DICTS.he;
  let s;
  if (vars && typeof vars.count === 'number') {
    const suffix = vars.count === 1 ? '_one' : '_other';
    s = d[key + suffix] ?? DICTS.en[key + suffix];
  }
  s = s ?? d[key] ?? DICTS.en[key];
  // A missing key renders the key itself: visible in dev, never a crash.
  return s == null ? key : fill(s, vars);
}

const localeOf = (lang) => (lang === 'he' ? 'he-IL' : 'en-US');

const Ctx = createContext({ lang: 'he', dir: 'rtl', isRtl: true, t: (k, v) => translate('he', k, v), setLang: () => {} });

export function LangProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    const l = initialLang();
    locale = localeOf(l); // before the first render, so the first dates are already in the right locale
    return l;
  });
  const dir = lang === 'he' ? 'rtl' : 'ltr';
  locale = localeOf(lang);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // private mode — the choice simply does not persist
    }
  }, [lang, dir]);

  const setLang = useCallback((l) => setLangState(DICTS[l] ? l : 'he'), []);
  const t = useCallback((key, vars) => translate(lang, key, vars), [lang]);
  const value = useMemo(() => ({ lang, dir, isRtl: dir === 'rtl', t, setLang }), [lang, dir, t, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useT() {
  return useContext(Ctx);
}

/** A Latin-script term inside a translated line: always left-to-right, isolated, never split. */
export function Term({ children, className, style, title }) {
  return (
    <bdi dir="ltr" className={className ? `term ${className}` : 'term'} style={style} title={title}>
      {children}
    </bdi>
  );
}

const useSelectStyles = createUseStyles((theme) => ({
  select: {
    padding: '0.3rem 0.5rem',
    border: `1px solid ${theme.border}`,
    borderRadius: 6,
    background: theme.surface,
    color: theme.text,
    fontSize: '0.8rem',
    fontFamily: 'inherit',
    cursor: 'pointer',
    '&:focus': { outline: 'none', borderColor: theme.primary },
  },
}));

/** Language dropdown (a native select — used on the login page). */
export function LangSelect({ className }) {
  const theme = useTheme();
  const classes = useSelectStyles(theme);
  const { lang, setLang, t } = useT();
  return (
    <select className={className ? `${classes.select} ${className}` : classes.select} value={lang} onChange={(e) => setLang(e.target.value)} aria-label={t('common.language')}>
      {LANGS.map(([code, label]) => (
        <option key={code} value={code} lang={code}>
          {label}
        </option>
      ))}
    </select>
  );
}
