// The app's build id and the update check (owner 2026-11-18: "every 1 hour the app should check for a new version — a new
// build of the app — and suggest a reload dialog; and an app update button in the System page").
// vite.config.js puts the build id of THIS bundle in __JOYA_BUILD__ and writes prod/version.json with the same id; the
// server answers GET /api/version with that file (no cache). When the two differ, a new build was deployed.
import { useCallback, useEffect, useRef, useState } from 'react';

export const CHECK_EVERY_MS = 60 * 60 * 1000; // one hour

/* global __JOYA_BUILD__ */
export const BUILD = typeof __JOYA_BUILD__ !== 'undefined' ? __JOYA_BUILD__ : 'dev';

/** What the server runs now: { build, builtAt, commit } (build "unknown" when prod/version.json is missing). */
export async function fetchVersion() {
  const res = await fetch('/api/version', { cache: 'no-store', credentials: 'same-origin', headers: { 'cache-control': 'no-cache' } });
  if (!res.ok) throw new Error(`version check failed (${res.status})`);
  return res.json();
}

/** { current, latest, builtAt, isNew } — isNew only when the server names a build and it is not ours. */
export async function checkForUpdate() {
  const v = await fetchVersion();
  const latest = v?.build || null;
  return { current: BUILD, latest, builtAt: v?.builtAt || null, commit: v?.commit || null, isNew: Boolean(latest && latest !== 'unknown' && BUILD !== 'dev' && latest !== BUILD) };
}

/** Loads the new build: refreshes the service worker (it keeps no cache) and reloads the page from the server. */
export async function reloadApp() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.update().catch(() => {})));
    }
    if (window.caches?.keys) {
      const keys = await window.caches.keys();
      await Promise.all(keys.map((k) => window.caches.delete(k)));
    }
  } catch {
    // nothing to clean: the reload below is what matters
  }
  window.location.reload();
}

/**
 * Checks for a new build every hour (and when the tab comes back after an hour away). Returns
 * { available, latest, builtAt, checkedAt, checkNow, dismiss } — `dismiss` hides the suggestion until the next check.
 */
export function useUpdateCheck({ every = CHECK_EVERY_MS } = {}) {
  const [state, setState] = useState({ available: false, latest: null, builtAt: null, checkedAt: null });
  const [dismissedBuild, setDismissedBuild] = useState(null);
  const lastCheck = useRef(0);
  const check = useCallback(async () => {
    lastCheck.current = Date.now();
    try {
      const r = await checkForUpdate();
      setState({ available: r.isNew, latest: r.latest, builtAt: r.builtAt, checkedAt: new Date().toISOString() });
      return r;
    } catch {
      return null; // offline or the server is restarting: try again next time
    }
  }, []);
  useEffect(() => {
    if (BUILD === 'dev') return undefined;
    const timer = setInterval(check, every);
    const onVisible = () => { if (document.visibilityState === 'visible' && Date.now() - lastCheck.current >= every) check(); };
    document.addEventListener('visibilitychange', onVisible);
    lastCheck.current = Date.now(); // the page was just loaded: it is the current build
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [check, every]);
  const dismiss = useCallback(() => setDismissedBuild(state.latest), [state.latest]);
  return { ...state, available: state.available && dismissedBuild !== state.latest, checkNow: check, dismiss };
}
