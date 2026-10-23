// Joya session context: who I am (role, locations, payroll), the chosen company and location
// (company → restaurant, as the Allegro branches are grouped), and helpers to name roles and shifts in the current language.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { useT } from './i18n/index.js';

const Ctx = createContext(null);
const LOC_KEY = 'joya.location';
const CO_KEY = 'joya.company';
const store = (key, v) => {
  try {
    if (v == null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(v));
  } catch {
    // storage blocked — the choice lasts for this visit only
  }
};
/** the company a location belongs to ('' = Allegro gave none) */
export const companyOf = (l) => l?.company?.key ?? '';
/** the companies of these locations, in the order the locations come */
export function companiesOf(locations) {
  const out = [];
  for (const l of locations) {
    const key = companyOf(l);
    if (!out.some((x) => x.key === key)) out.push({ key, label: l.company?.label ?? '' });
  }
  return out;
}
// a location switched off (Settings → Locations, e.g. a closed branch) is left out of the picker and of "all"
const usable = (me) => (me?.locations || []).filter((l) => l.active);

export function JoyaProvider({ children }) {
  const [state, setState] = useState({ me: null, error: null, loading: true });
  const [locationId, setLoc] = useState(() => {
    try {
      const v = localStorage.getItem(LOC_KEY);
      return v ? Number(v) : null;
    } catch {
      return null;
    }
  });

  const [companyKey, setCo] = useState(() => {
    try {
      return localStorage.getItem(CO_KEY);
    } catch {
      return null;
    }
  });

  const reload = useCallback(
    () =>
      api('/me')
        .then((me) => setState({ me, error: null, loading: false }))
        .catch((error) => setState({ me: null, error, loading: false })),
    [],
  );
  useEffect(() => {
    reload();
  }, [reload]);

  const me = state.me;
  // a manager always works on one of their locations; the admin may choose "all" (null),
  // either all of one company or all companies
  let validCo = null;
  let validLoc = null;
  if (me) {
    const locs = usable(me);
    if (companyKey != null && locs.some((l) => companyOf(l) === companyKey)) validCo = companyKey;
    const inCo = locs.filter((l) => validCo == null || companyOf(l) === validCo);
    if (locationId != null && inCo.some((l) => l.id === locationId)) validLoc = locationId;
    else if (!me.isAdmin) validLoc = inCo[0]?.id ?? null;
    if (validLoc != null) validCo = companyOf(locs.find((l) => l.id === validLoc));
  }
  const setLocationId = useCallback((id) => {
    setLoc(id);
    store(LOC_KEY, id);
  }, []);
  // choosing a company clears the restaurant choice (the first one of it, for a manager)
  const setCompanyKey = useCallback((key) => {
    setCo(key);
    store(CO_KEY, key);
    setLoc(null);
    store(LOC_KEY, null);
  }, []);

  const value = useMemo(
    () => ({ ...state, reload, locationId: validLoc, setLocationId, companyKey: validCo, setCompanyKey }),
    [state, reload, validLoc, setLocationId, validCo, setCompanyKey],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useJoya() {
  const c = useContext(Ctx);
  const { lang } = useT();
  const me = c?.me;
  return useMemo(() => {
    const allLocations = me?.locations || [];
    const locations = usable(me);
    const location = locations.find((l) => l.id === c?.locationId) || null;
    const companies = companiesOf(locations);
    const inCompany = c?.companyKey != null ? locations.filter((l) => companyOf(l) === c.companyKey) : locations;
    return {
      ...c,
      /** the user's locations that are switched on */
      locations,
      /** all the user's locations, also the switched-off ones (Settings → Locations) */
      allLocations,
      location,
      companies,
      /** the locations of the chosen company (all the user's when none is chosen) */
      inCompany,
      /** the location ids a page should show: the chosen one, else all of the chosen company, else all the user's */
      scope: c?.locationId != null ? [c.locationId] : inCompany.map((l) => l.id),
      /** a location must be chosen (manager pages) — the first one when "all" is selected */
      oneLocationId: c?.locationId ?? inCompany[0]?.id ?? null,
      isDemo: (id) => !!me?.demo?.[id],
      anyDemo: (ids) => (ids || locations.map((l) => l.id)).some((id) => me?.demo?.[id]),
      locName: (id) => allLocations.find((l) => l.id === id)?.name ?? (id == null ? '' : `#${id}`),
      roleName: (code) => {
        const r = me?.roles?.find((x) => x.code === code);
        return r ? (lang === 'he' ? r.nameHe : r.nameEn) : code;
      },
      shiftName: (locationId, code) => me?.shifts?.find((s) => s.locationId === locationId && s.code === code)?.name ?? code,
    };
  }, [c, me, lang]);
}
