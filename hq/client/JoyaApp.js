// Joya Headquarter — the app shell (its own service, hq/).
// Shell: a top bar (menu, title, location picker), the demo-data banner, and the
// routes of the four main areas plus the headquarters functions.
import React, { useEffect, useState } from 'react';
import { createUseStyles, useTheme } from 'react-jss';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useT, LANGS } from './i18n/index.js';
import { JoyaProvider, useJoya } from './context.js';
import { Loading, ErrorBox, DemoBanner, ShellDemoContext } from './ui.js';
import Overview from './pages/Overview.js';
import Workspace from './pages/Workspace.js';
import Orders from './pages/Orders.js';
import OrderList from './pages/OrderList.js';
import Shortages from './pages/Shortages.js';
import Learned from './pages/Learned.js';
import Staffing from './pages/Staffing.js';
import StaffPlan from './pages/StaffPlan.js';
import Rules from './pages/Rules.js';
import Labor from './pages/Labor.js';
import Payroll from './pages/Payroll.js';
import Sales from './pages/Sales.js';
import Tasks from './pages/Tasks.js';
import Inquiries from './pages/Inquiries.js';
import Inquiry from './pages/Inquiry.js';
import Ask from './pages/Ask.js';
import Data from './pages/Data.js';
import Import from './pages/Import.js';
import Settings from './pages/Settings.js';
import Menu from './pages/Menu.js';
import Employees from './pages/Employees.js';
import Area from './pages/Area.js';

const useStyles = createUseStyles((theme) => ({
  bar: { position: 'sticky', top: 0, zIndex: 20, display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.45rem 0.6rem', borderBottom: `1px solid ${theme.border}`, background: theme.surface },
  iconBtn: { flexShrink: 0, background: 'none', border: `1px solid ${theme.border}`, borderRadius: 6, color: theme.text, padding: '0.3rem 0.6rem', fontSize: '1.05rem', lineHeight: 1, cursor: 'pointer', fontFamily: 'inherit' },
  brand: { flex: 1, minWidth: 0, fontSize: '0.92rem', fontWeight: 700, letterSpacing: '0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  brandSub: { fontWeight: 400, color: theme.textSecondary, fontSize: '0.75rem', marginInlineStart: '0.4rem', '@media (max-width: 480px)': { display: 'none' } },
  pick: { display: 'flex', gap: '0.3rem', maxWidth: '60%', minWidth: 0 },
  loc: { minWidth: 0, maxWidth: '100%', padding: '0.3rem 0.4rem', border: `1px solid ${theme.border}`, borderRadius: 6, background: theme.background, color: theme.text, fontSize: '0.8rem', fontFamily: 'inherit' },
  backdrop: { position: 'fixed', inset: 0, zIndex: 30, background: 'rgba(0,0,0,0.35)' },
  drawer: { position: 'fixed', top: 0, bottom: 0, insetInlineStart: 0, zIndex: 31, width: 'min(300px, 86vw)', overflowY: 'auto', background: theme.surface, borderInlineEnd: `1px solid ${theme.border}`, padding: '0.5rem 0 1.5rem' },
  group: { padding: '0.7rem 1rem 0.25rem', fontSize: '0.68rem', color: theme.textSecondary, textTransform: 'uppercase', letterSpacing: '0.04em' },
  item: { display: 'block', width: '100%', padding: '0.55rem 1rem', background: 'none', border: 0, color: theme.text, fontSize: '0.9rem', textAlign: 'start', cursor: 'pointer', fontFamily: 'inherit', '&:hover': { background: 'rgba(255,255,255,0.05)' } },
  itemOn: { color: theme.primary, fontWeight: 650 },
  sep: { height: 1, margin: '0.6rem 0', background: theme.border },
  bannerWrap: { maxWidth: 1100, margin: '0 auto', padding: '0.6rem 1rem 0' },
}));

/** The menu: the four main areas first, then the headquarters functions. */
// The main menu: three areas, each a chat (pages/Area.js). The detailed pages (orders, staffing,
// payroll…) keep their routes, so links to them still work, but the menu does not list them.
function navGroups() {
  return [
    {
      key: 'joya.nav.main',
      items: [
        ['/stock', 'joya.nav.stock'],
        ['/people', 'joya.nav.manpower'],
        ['/performance', 'joya.nav.performance'],
      ],
    },
  ];
}

function Shell() {
  const theme = useTheme();
  const c = useStyles(theme);
  const { t, lang, setLang, dir } = useT();
  const j = useJoya();
  const navigate = useNavigate();
  const where = useLocation();
  const [open, setOpen] = useState(false);
  const signOut = () => fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }).then(() => window.location.assign('/'));

  useEffect(() => setOpen(false), [where.pathname]);

  if (j.loading) return <Loading />;
  if (j.error) {
    return (
      <div style={{ padding: '2rem 1rem', minHeight: '100vh', background: theme.background }}>
        <ErrorBox error={j.error} />
        <button className={c.item} onClick={signOut}>
          {t('account.signOut')}
        </button>
      </div>
    );
  }
  const me = j.me;
  const go = (path) => navigate(path);
  const showDemo = j.anyDemo(j.scope);

  return (
    <div style={{ minHeight: '100vh', background: theme.background, color: theme.text }}>
      <div className={c.bar}>
        <button className={c.iconBtn} onClick={() => setOpen(true)} aria-label={t('menu.open')} aria-expanded={open}>
          ☰
        </button>
        <div className={c.brand}>
          <bdi dir="ltr">Joya Headquarter</bdi>
          <span className={c.brandSub}>{t(`joya.role.${me.role}`)}</span>
        </div>
        <div className={c.pick}>
          {j.companies.length > 1 && (
            <select className={c.loc} value={j.companyKey ?? '*'} onChange={(e) => j.setCompanyKey(e.target.value === '*' ? null : e.target.value)} aria-label={t('joya.company')}>
              {me.isAdmin && <option value="*">{t('joya.allCompanies')}</option>}
              {j.companies.map((co) => (
                <option key={co.key} value={co.key}>
                  {co.label || t('joya.noCompany')}
                </option>
              ))}
            </select>
          )}
          <select className={c.loc} value={j.locationId ?? ''} onChange={(e) => j.setLocationId(e.target.value ? Number(e.target.value) : null)} aria-label={t('joya.location')}>
            {me.isAdmin && <option value="">{j.companyKey != null && j.companies.length > 1 ? t('joya.allCompanyLocations') : t('joya.allLocations')}</option>}
            {j.inCompany.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {open && <div className={c.backdrop} onClick={() => setOpen(false)} />}
      {open && (
        <nav className={c.drawer} dir={dir} aria-label={t('joya.nav.label')}>
          {navGroups().map((g) => (
            <div key={g.key}>
              <div className={c.group}>{t(g.key)}</div>
              {g.items.map(([path, key]) => (
                <button key={path} className={`${c.item} ${where.pathname.startsWith(path) ? c.itemOn : ''}`} onClick={() => go(path)}>
                  {t(key)}
                </button>
              ))}
            </div>
          ))}
          {me.isAdmin && (
            <>
              <div className={c.sep} />
              <button className={`${c.item} ${where.pathname.startsWith('/settings') ? c.itemOn : ''}`} onClick={() => go('/settings')}>
                {t('joya.nav.settings')}
              </button>
            </>
          )}
          <div className={c.group}>{t('common.language')}</div>
          {LANGS.map(([code, label]) => (
            <button key={code} className={`${c.item} ${code === lang ? c.itemOn : ''}`} onClick={() => setLang(code)}>
              <span lang={code}>{label}</span>
            </button>
          ))}
          <div className={c.sep} />
          <button className={c.item} onClick={signOut}>
            {t('account.signOut')}
          </button>
        </nav>
      )}

      {showDemo && (
        <div className={c.bannerWrap}>
          <DemoBanner />
        </div>
      )}

      <ShellDemoContext.Provider value={showDemo}>
      <Routes>
        <Route index element={<Navigate to="stock" replace />} />
        <Route path="stock" element={<Area area="stock" />} />
        <Route path="people" element={<Area area="people" />} />
        <Route path="performance" element={<Area area="performance" />} />
        <Route path="overview" element={me.isAdmin ? <Overview /> : <Navigate to="/workspace" replace />} />
        <Route path="workspace" element={<Workspace />} />
        <Route path="orders" element={<Orders />} />
        <Route path="orders/:id" element={<OrderList />} />
        <Route path="shortages" element={<Shortages />} />
        <Route path="learned" element={<Learned />} />
        <Route path="staffing" element={<Staffing />} />
        <Route path="staffing/:id" element={<StaffPlan />} />
        <Route path="rules" element={<Rules />} />
        <Route path="labor" element={<Labor />} />
        <Route path="payroll" element={<Payroll />} />
        <Route path="employees" element={<Employees />} />
        <Route path="sales" element={<Sales />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="inquiries" element={<Inquiries />} />
        <Route path="inquiries/:id" element={<Inquiry />} />
        <Route path="ask" element={<Ask />} />
        <Route path="data" element={<Data />} />
        <Route path="import" element={<Import />} />
        <Route path="menu" element={<Menu />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </ShellDemoContext.Provider>
    </div>
  );
}

export default function JoyaApp() {
  return (
    <JoyaProvider>
      <Shell />
    </JoyaProvider>
  );
}
