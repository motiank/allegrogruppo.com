// /accounting/bank-recon — the detailed bank reconciliation report (דוח התאמת בנק מפורט), chain admin only.
// The report itself is the admin's (admin/server/modules/bankRecon.js, Hebrew RTL HTML): Joya shows it in a frame
// through /api/joya/finance/bank-recon?format=html and offers the Excel file. Nothing is computed or stored here.
// Filters (owner 2026-11-13): "סוג תנועה" and "ספק / מוטב" pickers (the lists come from /finance/bank-recon/facets of
// the shown account and period); the admin server filters (shared/bankReconFilter.js). A text / amount / sections
// filter comes only from the chat's link (q, amount, sections in the URL) and can be cleared here.
import React, { useEffect, useMemo, useState } from 'react';
import { createUseStyles, useTheme } from 'react-jss';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useT } from '../i18n/index.js';
import { Page, Btn, Field, Input, Select, Loading, ErrorBox, useLoad } from '../ui.js';

const useStyles = createUseStyles((theme) => ({
  picker: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '0.6rem' },
  pickField: { width: 160 },
  wide: { width: 260 },
  hint: { fontSize: '0.76rem', color: theme.textSecondary, margin: '0.2rem 0 0.6rem' },
  chip: { display: 'inline-flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.8rem', padding: '0.15rem 0.5rem', borderRadius: 999, background: theme.surface2 || theme.surface, border: `1px solid ${theme.border}` },
  frame: { width: '100%', height: 'calc(100vh - 230px)', minHeight: 480, border: `1px solid ${theme.border}`, borderRadius: 8, background: '#fff' },
  links: { display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' },
}));

export default function BankRecon() {
  const theme = useTheme();
  const c = useStyles(theme);
  const { t } = useT();
  const [sp] = useSearchParams();
  const accounts = useLoad(() => api('/finance/bank-recon/accounts'), []);
  const [company, setCompany] = useState(sp.get('company') || '');
  const [account, setAccount] = useState(sp.get('account') || '');
  const [from, setFrom] = useState(sp.get('from') || '');
  const [to, setTo] = useState(sp.get('to') || '');
  const [kind, setKind] = useState(sp.get('kind') || '');
  const [party, setParty] = useState(sp.get('party') || '');
  // the chat's extra filters (text, amount, sections): shown as a chip, cleared with one click
  const [extra, setExtra] = useState({ q: sp.get('q') || '', amount: sp.get('amount') || '', sections: sp.get('sections') || '' });
  const [shown, setShown] = useState(null); // { company, account, from, to } of the report in the frame

  const companies = accounts.data?.companies || [];
  useEffect(() => {
    if (!accounts.data) return;
    const first = companies[0];
    if (!company && first) setCompany(first.code);
    const co = companies.find((x) => x.code === (company || first?.code));
    if (!account && co?.banks[0]) setAccount(co.banks[0].key);
    const today = accounts.data.today;
    if (!to && today) setTo(co?.banks[0]?.dataUpTo && co.banks[0].dataUpTo < today ? co.banks[0].dataUpTo : today);
    if (!from && today) setFrom(`${today.slice(0, 4)}-01-01`);
  }, [accounts.data]); // eslint-disable-line react-hooks/exhaustive-deps
  // a report asked for by a link (the chat's link) opens at once
  useEffect(() => {
    if (sp.get('account') && sp.get('from') && sp.get('to') && !shown) setShown({ company: sp.get('company'), account: sp.get('account'), from: sp.get('from'), to: sp.get('to') });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const banks = useMemo(() => companies.find((x) => x.code === company)?.banks || [], [companies, company]);
  const bank = banks.find((b) => b.key === account) || null;
  const ready = company && account && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;
  const filters = { kind, party, ...extra };
  const extraOn = Boolean(extra.q || extra.amount || extra.sections);
  const query = qs({ company, account, from, to, ...filters });
  const frameSrc = shown ? `/api/joya/finance/bank-recon${qs({ ...shown, ...filters, format: 'html' })}` : null;

  // the kinds and the parties of the shown report (the whole report, not the filtered one)
  const facets = useLoad(() => (shown ? api(`/finance/bank-recon/facets${qs(shown)}`) : Promise.resolve(null)), [shown]);
  const partyValue = (p) => p.key || p.name;

  return (
    <Page title={t('joya.bankRecon.title')} back="/accounting">
      {accounts.loading && <Loading />}
      {accounts.error && <ErrorBox error={accounts.error} />}
      {accounts.data && !accounts.data.available && <ErrorBox error={{ message: accounts.data.reason || t('joya.bankRecon.noBooks') }} />}
      {accounts.data?.available && !companies.length && <p className={c.hint}>{t('joya.bankRecon.noBooks')}</p>}
      {companies.length > 0 && (
        <>
          <div className={c.picker}>
            {companies.length > 1 && (
              <Field label={t('joya.company')}>
                <Select
                  className={c.pickField}
                  value={company}
                  onChange={(e) => {
                    setCompany(e.target.value);
                    setAccount(companies.find((x) => x.code === e.target.value)?.banks[0]?.key || '');
                  }}
                >
                  {companies.map((x) => (
                    <option key={x.code} value={x.code}>{x.name || x.code}</option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label={t('joya.bankRecon.account')}>
              <Select className={c.wide} value={account} onChange={(e) => setAccount(e.target.value)}>
                {banks.map((b) => (
                  <option key={b.key} value={b.key}>{b.name} ({b.key})</option>
                ))}
              </Select>
            </Field>
            <Field label={t('joya.bankRecon.from')}>
              <Input className={c.pickField} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label={t('joya.bankRecon.to')}>
              <Input className={c.pickField} type="date" value={to} max={bank?.dataUpTo || undefined} onChange={(e) => setTo(e.target.value)} />
            </Field>
            <Btn kind="primary" disabled={!ready} onClick={() => setShown({ company, account, from, to })}>
              {t('joya.bankRecon.show')}
            </Btn>
            <div className={c.links}>
              <a href={ready ? `/api/joya/finance/bank-recon${query}&format=xlsx` : undefined} aria-disabled={!ready}>
                <Btn small disabled={!ready}>{t('joya.bankRecon.excel')}</Btn>
              </a>
              <a href={ready ? `/api/joya/finance/bank-recon${query}&format=html` : undefined} target="_blank" rel="noreferrer">
                <Btn small disabled={!ready}>{t('joya.bankRecon.print')}</Btn>
              </a>
            </div>
          </div>
          {shown && (
            <div className={c.picker}>
              <Field label={t('joya.bankRecon.kind')}>
                <Select className={c.pickField} value={kind} onChange={(e) => setKind(e.target.value)} disabled={facets.loading}>
                  <option value="">{t('joya.bankRecon.all')}</option>
                  {(facets.data?.kinds || []).map((k) => (
                    <option key={k.kind} value={k.kind}>{k.label} ({k.count})</option>
                  ))}
                </Select>
              </Field>
              <Field label={t('joya.bankRecon.party')}>
                <Select className={c.wide} value={party} onChange={(e) => setParty(e.target.value)} disabled={facets.loading}>
                  <option value="">{t('joya.bankRecon.all')}</option>
                  {(facets.data?.parties || []).map((p) => (
                    <option key={partyValue(p)} value={partyValue(p)}>{p.name}{p.key ? ` (${p.key})` : ''} · {p.count}</option>
                  ))}
                </Select>
              </Field>
              {extraOn && (
                <span className={c.chip} dir="auto">
                  {t('joya.bankRecon.fromChat', { text: [extra.q && `${t('joya.bankRecon.text')}: ${extra.q}`, extra.amount && `${t('joya.bankRecon.amount')}: ${extra.amount}`, extra.sections && `${t('joya.bankRecon.sections')}: ${extra.sections}`].filter(Boolean).join(' · ') })}
                  <Btn small onClick={() => setExtra({ q: '', amount: '', sections: '' })}>{t('joya.bankRecon.clear')}</Btn>
                </span>
              )}
              {facets.error && <ErrorBox error={facets.error} />}
            </div>
          )}
          <p className={c.hint}>
            {bank ? t('joya.bankRecon.range', { from: bank.from, to: bank.dataUpTo, n: bank.lines }) : ''} {t('joya.bankRecon.hint')} {shown ? t('joya.bankRecon.filterHint') : ''}
          </p>
          {frameSrc ? (
            <iframe title={t('joya.bankRecon.title')} className={c.frame} src={frameSrc} />
          ) : (
            <p className={c.hint}>{t('joya.bankRecon.pick')}</p>
          )}
        </>
      )}
    </Page>
  );
}
