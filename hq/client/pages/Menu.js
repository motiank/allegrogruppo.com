// /menu — the dishes of a location (matched to POS sales by their code) and the
// ingredients each dish uses. Ingredient quantities are optional: an ingredient without a
// quantity still links the dish to the item, but never yields an "exact" consumption figure.
import React, { useEffect, useState } from 'react';
import { createUseStyles, useTheme } from 'react-jss';
import { api, qs } from '../api.js';
import { Page, Card, Grid, Row, Btn, Badge, Field, Input, Modal, Tabs, Loading, Empty, ErrorBox, useLoad, useAction, Term } from '../ui.js';
import { useJoya } from '../context.js';
import { useT } from '../i18n/index.js';

const useStyles = createUseStyles((theme) => ({
  note: { fontSize: '0.8rem', color: theme.textSecondary, margin: '0 0 0.6rem', lineHeight: 1.5 },
  sub: { fontSize: '0.76rem', color: theme.textSecondary, marginTop: '0.2rem' },
  check: { display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.86rem', padding: '0.2rem 0', cursor: 'pointer' },
  line: { borderTop: `1px solid ${theme.border}`, padding: '0.45rem 0' },
  lineHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', fontSize: '0.86rem', fontWeight: 600 },
  lineInputs: { display: 'flex', gap: '0.5rem', marginTop: '0.3rem', '& > *': { flex: 1, minWidth: 0 } },
  picks: { maxHeight: 200, overflowY: 'auto', border: `1px solid ${theme.border}`, borderRadius: 6, marginTop: '0.3rem' },
  pick: { display: 'block', width: '100%', textAlign: 'start', background: 'none', border: 0, borderBottom: `1px solid ${theme.border}`, color: theme.text, padding: '0.4rem 0.55rem', fontSize: '0.84rem', cursor: 'pointer', fontFamily: 'inherit', '&:hover': { background: 'rgba(255,255,255,0.05)' } },
  actions: { display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.5rem' },
  warn: { fontSize: '0.78rem', color: '#d29922', marginTop: '0.2rem' },
  box: { border: `1px dashed ${theme.border}`, borderRadius: 8, padding: '0.5rem 0.6rem', marginTop: '0.5rem' },
}));

function Check({ checked, onChange, children, c }) {
  return (
    <label className={c.check}>
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

/** Search the ingredient catalog; pick one, or create a new one by name. */
function IngredientPicker({ onPick, exclude = [], c }) {
  const { t } = useT();
  const [search, setSearch] = useState('');
  const [list, setList] = useState([]);
  const [creating, setCreating] = useState(null);
  const act = useAction();
  useEffect(() => {
    const h = setTimeout(() => {
      api(`/ingredients${qs({ search })}`)
        .then((d) => setList(d.ingredients.filter((i) => i.active && !exclude.includes(i.id)).slice(0, 30)))
        .catch(() => setList([]));
    }, 250);
    return () => clearTimeout(h);
  }, [search, exclude.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={c.box}>
      <Input dir="auto" placeholder={t('joya.menu.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className={c.picks}>
        {list.map((i) => (
          <button key={i.id} type="button" className={c.pick} onClick={() => onPick(i)}>
            <bdi dir="auto">{i.name}</bdi>
            {i.unit ? (
              <>
                {' '}
                · <bdi dir="auto">{i.unit}</bdi>
              </>
            ) : null}
          </button>
        ))}
        {!list.length ? <div className={c.sub} style={{ padding: '0.4rem 0.55rem' }}>{t('joya.menu.noIngredients')}</div> : null}
      </div>
      {creating ? (
        <div className={c.lineInputs}>
          <Input dir="auto" placeholder={t('joya.menu.name')} value={creating.name} onChange={(e) => setCreating({ ...creating, name: e.target.value })} />
          <Input dir="auto" placeholder={t('joya.menu.orderUnit')} value={creating.unit} onChange={(e) => setCreating({ ...creating, unit: e.target.value })} />
          <Btn
            kind="primary"
            disabled={act.busy || !creating.name.trim()}
            onClick={() =>
              act.run(async () => {
                const { ingredient } = await api('/ingredients', { method: 'POST', body: { name: creating.name.trim(), unit: creating.unit.trim() || null } });
                setCreating(null);
                onPick(ingredient);
              })
            }
          >
            {t('joya.add')}
          </Btn>
        </div>
      ) : (
        <div className={c.actions}>
          <Btn small onClick={() => setCreating({ name: search, unit: '' })}>
            {t('joya.menu.newIngredient')}
          </Btn>
        </div>
      )}
      <ErrorBox error={act.error} />
    </div>
  );
}

function RecipeEditor({ itemId, onClose, onSaved, c }) {
  const { t } = useT();
  const r = useLoad(() => api(`/menu/${itemId}/recipe`), [itemId]);
  const [lines, setLines] = useState(null);
  const [adding, setAdding] = useState(false);
  const act = useAction();
  useEffect(() => {
    if (r.data) setLines(r.data.lines.map((l) => ({ ingredientId: l.ingredientId, name: l.name, qty: l.qty == null ? '' : String(l.qty), unit: l.unit || '', ingredientUnit: l.ingredientUnit })));
  }, [r.data]);
  const badQty = (q) => String(q).trim() !== '' && !(Number(q) > 0);
  const anyBad = (lines || []).some((l) => badQty(l.qty));
  const save = () =>
    act.run(async () => {
      await api(`/menu/${itemId}/recipe`, {
        method: 'PUT',
        body: { lines: lines.map((l) => ({ ingredientId: l.ingredientId, qty: String(l.qty).trim() === '' ? null : Number(l.qty), unit: l.unit.trim() || null })) },
      });
      onSaved();
    });
  return (
    <Modal
      title={r.data ? <bdi dir="auto">{r.data.item.name}</bdi> : t('joya.menu.recipe')}
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>{t('joya.cancel')}</Btn>
          <Btn kind="primary" disabled={act.busy || !lines || anyBad} onClick={save}>
            {t('joya.save')}
          </Btn>
        </>
      }
    >
      <ErrorBox error={r.error} />
      {!lines ? <Loading /> : null}
      {lines ? (
        <>
          <p className={c.note}>{t('joya.menu.qtyOptional')}</p>
          {!lines.length ? <div className={c.sub}>{t('joya.menu.noLines')}</div> : null}
          {lines.map((l, i) => (
            <div key={l.ingredientId} className={c.line}>
              <div className={c.lineHead}>
                <bdi dir="auto">{l.name}</bdi>
                <Btn small kind="ghost" onClick={() => setLines(lines.filter((_, k) => k !== i))}>
                  {t('joya.delete')}
                </Btn>
              </div>
              <div className={c.lineInputs}>
                <Field label={t('joya.menu.qty')} hint={t('joya.menu.qtyEmpty')}>
                  <Input dir="ltr" inputMode="decimal" value={l.qty} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, qty: e.target.value } : x)))} />
                </Field>
                <Field label={t('joya.menu.unit')}>
                  <Input dir="auto" placeholder={l.ingredientUnit || ''} value={l.unit} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, unit: e.target.value } : x)))} />
                </Field>
              </div>
              {badQty(l.qty) ? <div className={c.warn}>{t('joya.menu.badQty')}</div> : null}
            </div>
          ))}
          {adding ? (
            <IngredientPicker
              c={c}
              exclude={lines.map((l) => l.ingredientId)}
              onPick={(ing) => {
                setLines([...lines, { ingredientId: ing.id, name: ing.name, qty: '', unit: '', ingredientUnit: ing.unit }]);
                setAdding(false);
              }}
            />
          ) : (
            <div className={c.actions}>
              <Btn onClick={() => setAdding(true)}>{t('joya.menu.addLine')}</Btn>
            </div>
          )}
        </>
      ) : null}
      <ErrorBox error={act.error} />
    </Modal>
  );
}

function MenuTab({ c }) {
  const { t } = useT();
  const j = useJoya();
  const loc = j.oneLocationId;
  const r = useLoad(() => (loc ? api(`/menu?locationId=${loc}`) : Promise.resolve({ items: [] })), [loc]);
  const [edit, setEdit] = useState(null);
  const [recipe, setRecipe] = useState(null);
  const act = useAction();
  if (!loc) return <Empty>{t('joya.chooseLocation')}</Empty>;
  const save = () =>
    act.run(async () => {
      await api('/menu', { method: 'POST', body: { id: edit.id || undefined, locationId: loc, code: edit.code.trim(), name: edit.name.trim(), category: edit.category.trim() || null, active: edit.active } });
      setEdit(null);
      r.reload();
    });
  return (
    <>
      <Card>
        <p className={c.note}>
          <bdi dir="auto">{j.locName(loc)}</bdi> · {t('joya.menu.qtyOptional')}
        </p>
        <div className={c.sub}>{t('joya.menu.posItemsHint')}</div>
        <div className={c.actions}>
          <Btn kind="primary" onClick={() => setEdit({ code: '', name: '', category: '', active: true })}>
            {t('joya.menu.addItem')}
          </Btn>
        </div>
      </Card>
      <ErrorBox error={r.error} />
      {r.loading && !r.data ? <Loading /> : null}
      {r.data && !r.data.items.length ? <Empty>{t('joya.menu.noItems')}</Empty> : null}
      <Grid>
        {(r.data?.items || []).map((m) => (
          <Card
            key={m.id}
            onClick={() => setRecipe(m.id)}
            title={<bdi dir="auto">{m.name}</bdi>}
            right={
              <span style={{ display: 'flex', gap: '0.3rem' }}>
                {m.isDemo ? <Badge tone="warn">{t('joya.demo')}</Badge> : null}
                {!m.active ? <Badge>{t('joya.menu.inactive')}</Badge> : null}
              </span>
            }
          >
            <Row label={t('joya.menu.code')}>
              <Term>{m.code}</Term>
            </Row>
            {m.category ? (
              <Row label={t('joya.menu.category')}>
                <bdi dir="auto">{m.category}</bdi>
              </Row>
            ) : null}
            <div className={c.sub}>{m.ingredients ? t('joya.menu.ingCount', { count: m.ingredients, noQty: m.ingredientsWithoutQty }) : t('joya.menu.noIngList')}</div>
            <div className={c.actions}>
              <Btn small onClick={(e) => (e.stopPropagation(), setRecipe(m.id))}>
                {t('joya.menu.recipe')}
              </Btn>
              <Btn small onClick={(e) => (e.stopPropagation(), setEdit({ ...m, category: m.category || '' }))}>
                {t('joya.edit')}
              </Btn>
            </div>
          </Card>
        ))}
      </Grid>
      {edit && (
        <Modal
          title={edit.id ? t('joya.menu.editItem') : t('joya.menu.addItem')}
          onClose={() => setEdit(null)}
          footer={
            <>
              <Btn onClick={() => setEdit(null)}>{t('joya.cancel')}</Btn>
              <Btn kind="primary" disabled={act.busy || !edit.code.trim() || !edit.name.trim()} onClick={save}>
                {t('joya.save')}
              </Btn>
            </>
          }
        >
          <Field label={t('joya.menu.code')} hint={t('joya.menu.codeHint')}>
            <Input dir="ltr" value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value })} />
          </Field>
          <Field label={t('joya.menu.name')}>
            <Input dir="auto" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          </Field>
          <Field label={t('joya.menu.category')}>
            <Input dir="auto" value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })} />
          </Field>
          <Check c={c} checked={edit.active} onChange={(on) => setEdit({ ...edit, active: on })}>
            {t('joya.menu.active')}
          </Check>
          <ErrorBox error={act.error} />
        </Modal>
      )}
      {recipe && (
        <RecipeEditor
          c={c}
          itemId={recipe}
          onClose={() => setRecipe(null)}
          onSaved={() => {
            setRecipe(null);
            r.reload();
          }}
        />
      )}
    </>
  );
}

function IngredientsTab({ c }) {
  const { t } = useT();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const h = setTimeout(() => setQ(search), 300);
    return () => clearTimeout(h);
  }, [search]);
  const r = useLoad(() => api(`/ingredients${qs({ search: q })}`), [q]);
  const [edit, setEdit] = useState(null);
  const act = useAction();
  const save = () =>
    act.run(async () => {
      await api('/ingredients', {
        method: 'POST',
        body: { id: edit.id || undefined, code: edit.code.trim() || null, name: edit.name.trim(), unit: edit.unit.trim() || null, category: edit.category.trim() || null, active: edit.active },
      });
      setEdit(null);
      r.reload();
    });
  return (
    <>
      <Card>
        <Input dir="auto" placeholder={t('joya.menu.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className={c.actions}>
          <Btn kind="primary" onClick={() => setEdit({ code: '', name: '', unit: '', category: '', active: true })}>
            {t('joya.menu.addIngredient')}
          </Btn>
        </div>
      </Card>
      <ErrorBox error={r.error} />
      {r.loading && !r.data ? <Loading /> : null}
      {r.data && !r.data.ingredients.length ? <Empty>{t('joya.menu.noIngredients')}</Empty> : null}
      <Grid>
        {(r.data?.ingredients || []).map((i) => (
          <Card
            key={i.id}
            onClick={() => setEdit({ ...i, code: i.code || '', unit: i.unit || '', category: i.category || '' })}
            title={<bdi dir="auto">{i.name}</bdi>}
            right={
              <span style={{ display: 'flex', gap: '0.3rem' }}>
                {i.isDemo ? <Badge tone="warn">{t('joya.demo')}</Badge> : null}
                {!i.active ? <Badge>{t('joya.menu.inactive')}</Badge> : null}
              </span>
            }
          >
            {i.code ? (
              <Row label={t('joya.menu.code')}>
                <Term>{i.code}</Term>
              </Row>
            ) : null}
            <Row label={t('joya.menu.orderUnit')}>{i.unit ? <bdi dir="auto">{i.unit}</bdi> : '—'}</Row>
            {i.category ? (
              <Row label={t('joya.menu.category')}>
                <bdi dir="auto">{i.category}</bdi>
              </Row>
            ) : null}
            <div className={c.sub}>{t('joya.menu.dishes', { n: i.dishes ?? 0 })}</div>
          </Card>
        ))}
      </Grid>
      {edit && (
        <Modal
          title={edit.id ? t('joya.menu.editIngredient') : t('joya.menu.addIngredient')}
          onClose={() => setEdit(null)}
          footer={
            <>
              <Btn onClick={() => setEdit(null)}>{t('joya.cancel')}</Btn>
              <Btn kind="primary" disabled={act.busy || !edit.name.trim()} onClick={save}>
                {t('joya.save')}
              </Btn>
            </>
          }
        >
          <Field label={t('joya.menu.name')}>
            <Input dir="auto" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          </Field>
          <Field label={t('joya.menu.ingCode')}>
            <Input dir="ltr" value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value })} />
          </Field>
          <Field label={t('joya.menu.orderUnit')}>
            <Input dir="auto" value={edit.unit} onChange={(e) => setEdit({ ...edit, unit: e.target.value })} />
          </Field>
          <Field label={t('joya.menu.category')}>
            <Input dir="auto" value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })} />
          </Field>
          <Check c={c} checked={edit.active} onChange={(on) => setEdit({ ...edit, active: on })}>
            {t('joya.menu.active')}
          </Check>
          <ErrorBox error={act.error} />
        </Modal>
      )}
    </>
  );
}

export default function Menu() {
  const theme = useTheme();
  const c = useStyles(theme);
  const { t } = useT();
  const [tab, setTab] = useState('menu');
  return (
    <Page
      title={t('joya.menu.title')}
      tabs={
        <Tabs
          tabs={[
            ['menu', t('joya.menu.tabMenu')],
            ['ingredients', t('joya.menu.tabIngredients')],
          ]}
          value={tab}
          onChange={setTab}
        />
      }
    >
      {tab === 'menu' ? <MenuTab c={c} /> : <IngredientsTab c={c} />}
    </Page>
  );
}
