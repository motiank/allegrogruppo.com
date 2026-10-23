// /rules — the explicit staffing rules, the shifts of a location, the staffing
// baseline (what was staffed before) and the role list. Managers' plan edits never
// change anything here; only an explicit save on this page does.
import React, { useState } from 'react';
import { createUseStyles, useTheme } from 'react-jss';
import { api, qs } from '../api.js';
import { useT } from '../i18n/index.js';
import { useJoya } from '../context.js';
import { Page, Card, Grid, Row, Btn, Badge, Field, Input, Select, TextArea, Modal, Tabs, Loading, Empty, ErrorBox, useLoad, useAction, hhmm, Term } from '../ui.js';

const TYPES = ['FIXED', 'MIN', 'MAX', 'RATIO', 'STEPS', 'PEAK_EXTRA'];
const UNITS = ['DINERS_PER_SHIFT', 'DINERS_PEAK_HOUR', 'CONCURRENT_DINERS_PEAK', 'ORDERS_PER_SHIFT', 'ORDERS_PEAK_HOUR'];
const DAYS = [0, 1, 2, 3, 4, 5, 6];

const useStyles = createUseStyles((theme) => ({
  intro: { fontSize: '0.8rem', lineHeight: 1.55, marginBottom: '0.7rem', color: theme.textSecondary },
  ruleBox: { borderTop: `1px solid ${theme.border}`, padding: '0.4rem 0', fontSize: '0.84rem' },
  small: { fontSize: '0.72rem', color: theme.textSecondary, marginTop: '0.15rem' },
  badges: { display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginTop: '0.2rem' },
  days: { display: 'flex', gap: '0.25rem', flexWrap: 'wrap' },
  day: { padding: '0.25rem 0.5rem', border: `1px solid ${theme.border}`, borderRadius: 999, background: 'none', color: theme.textSecondary, fontSize: '0.76rem', cursor: 'pointer', fontFamily: 'inherit' },
  dayOn: { borderColor: theme.primary, color: theme.primary, background: 'rgba(74,125,255,0.1)' },
  two: { display: 'flex', gap: '0.5rem', '& > *': { flex: 1, minWidth: 0 } },
  check: { display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.84rem', marginBottom: '0.5rem' },
}));

/** A rule in plain words, e.g. "1 per 30 diners per shift". */
export function ruleSentence(t, type, unit, p = {}) {
  const u = unit ? t(`joya.unit.${unit}`) : '';
  if (type === 'FIXED') return t('joya.rules.s.FIXED', { count: p.count });
  if (type === 'MIN') return t('joya.rules.s.MIN', { count: p.count });
  if (type === 'MAX') return t('joya.rules.s.MAX', { count: p.count });
  if (type === 'RATIO') return t('joya.rules.s.RATIO', { per: p.per, unit: u });
  if (type === 'STEPS') {
    const steps = [...(p.steps || [])].sort((a, b) => a.above - b.above).map((s) => t('joya.rules.s.step', { above: s.above, count: s.count }));
    return t('joya.rules.s.STEPS', { unit: u, steps: steps.join('; ') });
  }
  if (type === 'PEAK_EXTRA') return t('joya.rules.s.PEAK_EXTRA', { count: p.count, above: p.above, unit: u, start: p.start || '—', end: p.end || '—' });
  return type;
}

/** "this location · morning · Sun, Thu" — loc / shift are display names or null (= all). */
export function scopeText(t, { loc, shift, days }) {
  const parts = [loc || t('joya.rules.allLocations'), shift || t('joya.rules.allShifts')];
  parts.push(Array.isArray(days) && days.length ? days.map((d) => t(`joya.wd.${d}`)).join(', ') : t('joya.rules.allDays'));
  return parts.join(' · ');
}

function DaysPicker({ value, onChange }) {
  const { t } = useT();
  const theme = useTheme();
  const c = useStyles(theme);
  const toggle = (d) => onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d].sort());
  return (
    <div className={c.days}>
      {DAYS.map((d) => (
        <button key={d} type="button" className={`${c.day} ${value.includes(d) ? c.dayOn : ''}`} onClick={() => toggle(d)}>
          {t(`joya.wd.${d}`)}
        </button>
      ))}
    </div>
  );
}

function RuleForm({ rule, locationId, shifts, onClose, onDone }) {
  const { t } = useT();
  const j = useJoya();
  const theme = useTheme();
  const c = useStyles(theme);
  const p = rule?.params || {};
  const [f, setF] = useState({
    roleCode: rule?.roleCode || j.me.roles[0]?.code || '',
    type: rule?.type || 'RATIO',
    unit: rule?.unit || 'DINERS_PER_SHIFT',
    count: p.count ?? 1,
    per: p.per ?? 30,
    steps: p.steps?.length ? p.steps.map((s) => ({ ...s })) : [{ above: 0, count: 1 }],
    above: p.above ?? 40,
    start: p.start || '',
    end: p.end || '',
    scopeLoc: rule ? (rule.locationId == null ? 'all' : 'this') : 'this',
    shiftCode: rule?.shiftCode || '',
    days: rule?.days || [],
    roleStart: hhmm(rule?.roleStart) === '—' ? '' : hhmm(rule?.roleStart),
    roleEnd: hhmm(rule?.roleEnd) === '—' ? '' : hhmm(rule?.roleEnd),
    mandatory: !!rule?.mandatory,
    active: rule ? rule.active : true,
    note: rule?.note || '',
  });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const act = useAction();
  const needsUnit = ['RATIO', 'STEPS', 'PEAK_EXTRA'].includes(f.type);

  const params = () => {
    if (['FIXED', 'MIN', 'MAX'].includes(f.type)) return { count: Number(f.count) };
    if (f.type === 'RATIO') return { per: Number(f.per) };
    if (f.type === 'STEPS') return { steps: f.steps.map((s) => ({ above: Number(s.above), count: Number(s.count) })) };
    return { above: Number(f.above), count: Number(f.count), ...(f.start ? { start: f.start } : {}), ...(f.end ? { end: f.end } : {}) };
  };
  const save = () =>
    act.run(async () => {
      await api('/staffing/rules', {
        method: 'POST',
        body: {
          id: rule?.id,
          locationId: f.scopeLoc === 'all' ? null : locationId,
          shiftCode: f.shiftCode || null,
          days: f.days.length ? f.days : null,
          roleCode: f.roleCode,
          type: f.type,
          unit: needsUnit ? f.unit : null,
          params: params(),
          roleStart: f.roleStart || null,
          roleEnd: f.roleEnd || null,
          mandatory: f.mandatory,
          active: f.active,
          note: f.note || null,
        },
      });
      onDone();
    });

  return (
    <Modal
      title={rule ? t('joya.rules.editRule') : t('joya.rules.newRule')}
      onClose={onClose}
      footer={
        <Btn kind="primary" disabled={act.busy} onClick={save}>
          {t('joya.save')}
        </Btn>
      }
    >
      <Field label={t('joya.staff.role')}>
        <Select value={f.roleCode} onChange={(e) => set('roleCode', e.target.value)}>
          {j.me.roles.map((r) => (
            <option key={r.code} value={r.code}>
              {j.roleName(r.code)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('joya.rules.type')} hint={t(`joya.rules.typeHelp.${f.type}`)}>
        <Select value={f.type} onChange={(e) => set('type', e.target.value)}>
          {TYPES.map((x) => (
            <option key={x} value={x}>
              {t(`joya.rules.type.${x}`)}
            </option>
          ))}
        </Select>
      </Field>
      {needsUnit ? (
        <Field label={t('joya.rules.unit')} hint={t(`joya.unitHelp.${f.unit}`)}>
          <Select value={f.unit} onChange={(e) => set('unit', e.target.value)}>
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {t(`joya.unit.${u}`)}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      {['FIXED', 'MIN', 'MAX', 'PEAK_EXTRA'].includes(f.type) ? (
        <Field label={f.type === 'PEAK_EXTRA' ? t('joya.rules.extraCount') : t('joya.staff.headcount')}>
          <Input type="number" min="0" step="1" value={f.count} onChange={(e) => set('count', e.target.value)} />
        </Field>
      ) : null}
      {f.type === 'RATIO' ? (
        <Field label={t('joya.rules.per')} hint={t('joya.rules.perHint')}>
          <Input type="number" min="1" step="any" value={f.per} onChange={(e) => set('per', e.target.value)} />
        </Field>
      ) : null}
      {f.type === 'STEPS' ? (
        <Field label={t('joya.rules.steps')} hint={t('joya.rules.stepsHint')}>
          {f.steps.map((s, i) => (
            <div key={i} className={c.two} style={{ marginBottom: '0.3rem', alignItems: 'center' }}>
              <Input type="number" min="0" step="any" value={s.above} aria-label={t('joya.rules.above')} placeholder={t('joya.rules.above')} onChange={(e) => set('steps', f.steps.map((x, k) => (k === i ? { ...x, above: e.target.value } : x)))} />
              <Input type="number" min="0" step="1" value={s.count} aria-label={t('joya.staff.headcount')} placeholder={t('joya.staff.headcount')} onChange={(e) => set('steps', f.steps.map((x, k) => (k === i ? { ...x, count: e.target.value } : x)))} />
              <Btn small onClick={() => set('steps', f.steps.filter((_, k) => k !== i))} disabled={f.steps.length < 2}>
                ✕
              </Btn>
            </div>
          ))}
          <Btn small onClick={() => set('steps', [...f.steps, { above: 0, count: 1 }])}>
            + {t('joya.rules.addStep')}
          </Btn>
        </Field>
      ) : null}
      {f.type === 'PEAK_EXTRA' ? (
        <>
          <Field label={t('joya.rules.above')}>
            <Input type="number" min="0" step="any" value={f.above} onChange={(e) => set('above', e.target.value)} />
          </Field>
          <div className={c.two}>
            <Field label={t('joya.staff.start')}>
              <Input type="time" value={f.start} onChange={(e) => set('start', e.target.value)} />
            </Field>
            <Field label={t('joya.staff.end')}>
              <Input type="time" value={f.end} onChange={(e) => set('end', e.target.value)} />
            </Field>
          </div>
        </>
      ) : null}
      <Field label={t('joya.rules.scopeLocation')}>
        <Select value={f.scopeLoc} onChange={(e) => set('scopeLoc', e.target.value)}>
          <option value="this">{j.locName(locationId)}</option>
          {j.me.isAdmin ? <option value="all">{t('joya.rules.allLocations')}</option> : null}
        </Select>
      </Field>
      <Field label={t('joya.rules.scopeShift')}>
        <Select value={f.shiftCode} onChange={(e) => set('shiftCode', e.target.value)}>
          <option value="">{t('joya.rules.allShifts')}</option>
          {[...new Set(shifts.map((s) => s.code))].map((code) => (
            <option key={code} value={code}>
              {shifts.find((s) => s.code === code)?.name || code}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('joya.rules.scopeDays')} hint={t('joya.rules.daysHint')}>
        <DaysPicker value={f.days} onChange={(v) => set('days', v)} />
      </Field>
      <div className={c.two}>
        <Field label={t('joya.rules.roleStart')}>
          <Input type="time" value={f.roleStart} onChange={(e) => set('roleStart', e.target.value)} />
        </Field>
        <Field label={t('joya.rules.roleEnd')}>
          <Input type="time" value={f.roleEnd} onChange={(e) => set('roleEnd', e.target.value)} />
        </Field>
      </div>
      {j.me.isAdmin ? (
        <label className={c.check}>
          <input type="checkbox" checked={f.mandatory} onChange={(e) => set('mandatory', e.target.checked)} /> {t('joya.rules.mandatoryLabel')}
        </label>
      ) : null}
      <label className={c.check}>
        <input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} /> {t('joya.rules.active')}
      </label>
      <Field label={t('joya.noteOptional')}>
        <TextArea value={f.note} onChange={(e) => set('note', e.target.value)} />
      </Field>
      <ErrorBox error={act.error} />
    </Modal>
  );
}

function RulesTab({ locationId, shifts }) {
  const { t } = useT();
  const j = useJoya();
  const theme = useTheme();
  const c = useStyles(theme);
  const [edit, setEdit] = useState(null); // rule | 'new'
  const act = useAction();
  const { data, error, loading, reload } = useLoad(() => api(`/staffing/rules${qs({ locationId })}`), [locationId]);
  const canEdit = (r) => j.me.isAdmin || (r.locationId != null && !r.mandatory);
  const byRole = {};
  for (const r of data?.rules || []) (byRole[r.roleCode] ||= []).push(r);
  return (
    <>
      <div className={c.intro}>{t('joya.rules.intro')}</div>
      <Btn kind="primary" onClick={() => setEdit('new')}>
        + {t('joya.rules.newRule')}
      </Btn>
      <div style={{ height: '0.6rem' }} />
      <ErrorBox error={error || act.error} />
      {loading && !data ? <Loading /> : null}
      {data && !data.rules.length ? <Empty>{t('joya.rules.none')}</Empty> : null}
      <Grid>
        {Object.entries(byRole).map(([role, rules]) => (
          <Card key={role} title={j.roleName(role)}>
            {rules.map((r) => (
              <div key={r.id} className={c.ruleBox} style={{ opacity: r.active ? 1 : 0.55 }}>
                <div>
                  {ruleSentence(t, r.type, r.unit, r.params)}
                  {r.roleStart || r.roleEnd ? (
                    <>
                      {' '}
                      <Term>
                        ({hhmm(r.roleStart)}–{hhmm(r.roleEnd)})
                      </Term>
                    </>
                  ) : null}
                </div>
                <div className={c.small}>
                  {scopeText(t, { loc: r.locationId == null ? null : j.locName(r.locationId), shift: r.shiftCode ? j.shiftName(r.locationId ?? locationId, r.shiftCode) : null, days: r.days })}
                </div>
                {r.note ? (
                  <div className={c.small} dir="auto">
                    {r.note}
                  </div>
                ) : null}
                <div className={c.badges}>
                  {r.mandatory ? <Badge tone="bad">{t('joya.rules.mandatory')}</Badge> : null}
                  <Badge tone={r.locationId == null ? 'info' : 'muted'}>{r.locationId == null ? t('joya.rules.chainWide') : t('joya.rules.locationRule')}</Badge>
                  {!r.active ? <Badge>{t('joya.rules.inactive')}</Badge> : null}
                  {canEdit(r) ? (
                    <>
                      <Btn kind="ghost" small onClick={() => setEdit(r)}>
                        {t('joya.edit')}
                      </Btn>
                      <Btn
                        kind="ghost"
                        small
                        disabled={act.busy}
                        onClick={() =>
                          window.confirm(t('joya.rules.confirmDelete')) &&
                          act.run(async () => {
                            await api(`/staffing/rules/${r.id}`, { method: 'DELETE' });
                            reload();
                          })
                        }
                      >
                        {t('joya.delete')}
                      </Btn>
                    </>
                  ) : (
                    <span className={c.small}>{t('joya.rules.adminOnly')}</span>
                  )}
                </div>
              </div>
            ))}
          </Card>
        ))}
      </Grid>
      {edit ? (
        <RuleForm
          rule={edit === 'new' ? null : edit}
          locationId={locationId}
          shifts={shifts}
          onClose={() => setEdit(null)}
          onDone={() => {
            setEdit(null);
            reload();
          }}
        />
      ) : null}
    </>
  );
}

function ShiftForm({ shift, locationId, onClose, onDone }) {
  const { t } = useT();
  const theme = useTheme();
  const c = useStyles(theme);
  const [f, setF] = useState({ code: shift?.code || '', name: shift?.name || '', days: shift?.days || [0, 1, 2, 3, 4], start: hhmm(shift?.start) === '—' ? '08:00' : hhmm(shift?.start), end: hhmm(shift?.end) === '—' ? '16:00' : hhmm(shift?.end), active: shift ? shift.active : true });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const act = useAction();
  return (
    <Modal
      title={shift ? t('joya.rules.editShift') : t('joya.rules.newShift')}
      onClose={onClose}
      footer={
        <Btn
          kind="primary"
          disabled={act.busy}
          onClick={() =>
            act.run(async () => {
              await api('/shifts', { method: 'POST', body: { id: shift?.id, locationId, ...f } });
              onDone();
            })
          }
        >
          {t('joya.save')}
        </Btn>
      }
    >
      <Field label={t('joya.rules.shiftCode')} hint={t('joya.rules.codeHint')}>
        <Input value={f.code} dir="ltr" onChange={(e) => set('code', e.target.value)} />
      </Field>
      <Field label={t('joya.rules.shiftName')}>
        <Input value={f.name} dir="auto" onChange={(e) => set('name', e.target.value)} />
      </Field>
      <Field label={t('joya.rules.shiftDays')}>
        <DaysPicker value={f.days} onChange={(v) => set('days', v)} />
      </Field>
      <div className={c.two}>
        <Field label={t('joya.staff.start')}>
          <Input type="time" value={f.start} onChange={(e) => set('start', e.target.value)} />
        </Field>
        <Field label={t('joya.staff.end')} hint={t('joya.rules.pastMidnight')}>
          <Input type="time" value={f.end} onChange={(e) => set('end', e.target.value)} />
        </Field>
      </div>
      <label className={c.check}>
        <input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} /> {t('joya.rules.active')}
      </label>
      <ErrorBox error={act.error} />
    </Modal>
  );
}

function ShiftsTab({ locationId, shifts, reload }) {
  const { t } = useT();
  const [edit, setEdit] = useState(null);
  return (
    <>
      <Btn kind="primary" onClick={() => setEdit('new')}>
        + {t('joya.rules.newShift')}
      </Btn>
      <div style={{ height: '0.6rem' }} />
      {!shifts.length ? <Empty>{t('joya.staff.noShifts')}</Empty> : null}
      <Grid>
        {shifts.map((s) => (
          <Card
            key={s.id}
            title={<bdi dir="auto">{s.name}</bdi>}
            right={
              <Btn kind="ghost" small onClick={() => setEdit(s)}>
                {t('joya.edit')}
              </Btn>
            }
          >
            <Row label={t('joya.rules.shiftCode')}>
              <Term>{s.code}</Term>
            </Row>
            <Row label={t('joya.rules.hours')}>
              <Term>
                {hhmm(s.start)}–{hhmm(s.end)}
              </Term>
            </Row>
            <Row label={t('joya.rules.shiftDays')}>{s.days.map((d) => t(`joya.wd.${d}`)).join(', ')}</Row>
            {!s.active ? <Badge>{t('joya.rules.inactive')}</Badge> : null}
          </Card>
        ))}
      </Grid>
      {edit ? (
        <ShiftForm
          shift={edit === 'new' ? null : edit}
          locationId={locationId}
          onClose={() => setEdit(null)}
          onDone={() => {
            setEdit(null);
            reload();
          }}
        />
      ) : null}
    </>
  );
}

function BaselineTab({ locationId, shifts }) {
  const { t } = useT();
  const j = useJoya();
  const theme = useTheme();
  const c = useStyles(theme);
  const act = useAction();
  const { data, error, loading, setData } = useLoad(() => api(`/staffing/baseline${qs({ locationId })}`), [locationId]);
  const [draft, setDraft] = useState({});
  const roles = j.me.roles.filter((r) => r.active);
  const val = (s, wd, role) => {
    const k = `${s}|${wd}|${role}`;
    if (k in draft) return draft[k];
    const b = data?.baseline.find((x) => x.shiftCode === s && x.weekday === wd && x.roleCode === role);
    return b ? String(b.headcount) : '';
  };
  const save = (s, wd, role) => {
    const k = `${s}|${wd}|${role}`;
    if (!(k in draft) || draft[k] === '') return;
    act.run(async () => {
      const r = await api('/staffing/baseline', { method: 'POST', body: { locationId, shiftCode: s, weekday: wd, roleCode: role, headcount: Number(draft[k]) } });
      setData(r);
      setDraft((d) => {
        const n = { ...d };
        delete n[k];
        return n;
      });
    });
  };
  if (loading && !data) return <Loading />;
  return (
    <>
      <div className={c.intro}>{t('joya.rules.baselineIntro')}</div>
      <ErrorBox error={error || act.error} />
      {!shifts.length ? <Empty>{t('joya.staff.noShifts')}</Empty> : null}
      <Grid>
        {shifts.flatMap((s) =>
          s.days.map((wd) => (
            <Card
              key={`${s.code}-${wd}`}
              title={
                <>
                  {t(`joya.wd.${wd}`)} · <bdi dir="auto">{s.name}</bdi>
                </>
              }
            >
              {roles.map((r) => (
                <Row key={r.code} label={j.roleName(r.code)}>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={val(s.code, wd, r.code)}
                    placeholder="—"
                    aria-label={j.roleName(r.code)}
                    style={{ width: '4.5rem', background: theme.background, color: theme.text, border: `1px solid ${theme.border}`, borderRadius: 5, padding: '0.2rem 0.35rem', fontFamily: 'inherit' }}
                    onChange={(e) => setDraft((d) => ({ ...d, [`${s.code}|${wd}|${r.code}`]: e.target.value }))}
                    onBlur={() => save(s.code, wd, r.code)}
                  />
                </Row>
              ))}
            </Card>
          )),
        )}
      </Grid>
    </>
  );
}

function RolesTab() {
  const { t } = useT();
  const j = useJoya();
  const [f, setF] = useState({ code: '', nameHe: '', nameEn: '', sort: 100 });
  const act = useAction();
  return (
    <>
      <Grid>
        {j.me.roles.map((r) => (
          <Card key={r.code} title={j.roleName(r.code)} right={!r.active ? <Badge>{t('joya.rules.inactive')}</Badge> : null}>
            <Row label={t('joya.rules.code')}>
              <Term>{r.code}</Term>
            </Row>
            <Row label="עברית / English">
              <bdi dir="auto">{r.nameHe}</bdi> / <Term>{r.nameEn}</Term>
            </Row>
          </Card>
        ))}
      </Grid>
      {j.me.isAdmin ? (
        <Card title={t('joya.rules.newRole')}>
          <Field label={t('joya.rules.code')} hint={t('joya.rules.codeHint')}>
            <Input dir="ltr" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
          </Field>
          <Field label={t('joya.rules.nameHe')}>
            <Input dir="rtl" value={f.nameHe} onChange={(e) => setF({ ...f, nameHe: e.target.value })} />
          </Field>
          <Field label={t('joya.rules.nameEn')}>
            <Input dir="ltr" value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} />
          </Field>
          <Field label={t('joya.rules.sort')}>
            <Input type="number" value={f.sort} onChange={(e) => setF({ ...f, sort: Number(e.target.value) })} />
          </Field>
          <ErrorBox error={act.error} />
          <Btn
            kind="primary"
            disabled={act.busy}
            onClick={() =>
              act.run(async () => {
                await api('/roles', { method: 'POST', body: f });
                setF({ code: '', nameHe: '', nameEn: '', sort: 100 });
                await j.reload();
              })
            }
          >
            {t('joya.add')}
          </Btn>
        </Card>
      ) : null}
    </>
  );
}

export default function Rules() {
  const { t } = useT();
  const j = useJoya();
  const [tab, setTab] = useState('rules');
  const loc = j.oneLocationId;
  const shiftsQ = useLoad(() => (loc ? api(`/shifts${qs({ locationIds: loc })}`) : Promise.resolve({ shifts: [] })), [loc]);
  const shifts = shiftsQ.data?.shifts || [];
  return (
    <Page
      title={t('joya.nav.rules')}
      sub={loc ? <bdi dir="auto">{j.locName(loc)}</bdi> : null}
      tabs={
        <Tabs
          tabs={[
            ['rules', t('joya.rules.tabRules')],
            ['shifts', t('joya.rules.tabShifts')],
            ['baseline', t('joya.rules.tabBaseline')],
            ['roles', t('joya.rules.tabRoles')],
          ]}
          value={tab}
          onChange={setTab}
        />
      }
    >
      {!loc ? <Empty>{t('joya.chooseLocation')}</Empty> : null}
      {loc && j.locationId == null && j.locations.length > 1 ? <div style={{ fontSize: '0.78rem', marginBottom: '0.5rem' }}>{t('joya.rules.showingFirst')}</div> : null}
      <ErrorBox error={shiftsQ.error} />
      {loc && tab === 'rules' ? <RulesTab locationId={loc} shifts={shifts} /> : null}
      {loc && tab === 'shifts' ? (
        <ShiftsTab
          locationId={loc}
          shifts={shifts}
          reload={() => {
            shiftsQ.reload();
            j.reload();
          }}
        />
      ) : null}
      {loc && tab === 'baseline' ? <BaselineTab locationId={loc} shifts={shifts.filter((s) => s.active)} /> : null}
      {tab === 'roles' ? <RolesTab /> : null}
    </Page>
  );
}
