// Bank reconciliation (דוח התאמת בנק מפורט) — admin only. Pick the company's bank account and a date range; the
// server builds the report (GET /admin/bank-recon/report) and this page shows the Hebrew HTML from
// shared/bankReconHtml.js, with buttons for Excel and for the report in its own tab (printing).
// Filters (owner 2026-11-13): "סוג תנועה" (cheques / transfers / cards …) and "ספק / מוטב" — the server filters
// (shared/bankReconFilter.js, `kind` and `party`); the lists come from the report's own facets, so they appear after
// the first report. A free text (`q`) is for the chat only, by the owner's choice.
import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useTheme } from "../context/ThemeContext";
import { renderBankReconBody, bankReconBehavior, CSS } from "../../../shared/bankReconHtml.js";

const errText = (err, fallback) => err.response?.data?.error?.message || err.response?.data?.error || err.message || fallback;

const partyValue = (p) => p.key || p.name;
const partyText = (p) => `${p.name}${p.key ? ` (${p.key})` : ""}`;

// The supplier / payee picker: a searchable list (a native dropdown cannot show a coloured number). Each party shows
// its rows in the whole report and, in red brackets, its bank moves with no match in the books (section 1).
const PartyPicker = ({ parties, value, onChange, theme, inputStyle }) => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const current = parties.find((p) => partyValue(p) === value) || null;
  const needle = q.trim();
  const list = parties.filter((p) => !needle || `${p.name} ${p.key || ""}`.includes(needle)).slice(0, 200);
  const red = { color: "#b00020", fontWeight: 700 };
  const counts = (p) => (
    <span style={{ color: theme.textSecondary, marginRight: 6, whiteSpace: "nowrap" }} title={`${p.count} שורות בדוח${p.bankOpen ? ` · ${p.bankOpen} תנועות בנק ללא רישום בספרים` : ""}`}>
      {p.count}
      {p.bankOpen ? <span style={red}> ({p.bankOpen})</span> : null}
    </span>
  );
  const item = { padding: "5px 8px", cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 8, borderBottom: `1px solid ${theme.border}` };
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button type="button" style={{ ...inputStyle, minWidth: 280, maxWidth: 360, textAlign: "right", cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 8 }} onClick={() => setOpen((o) => !o)}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{current ? partyText(current) : "הכל"}</span>
        <span>{current ? counts(current) : null} ▾</span>
      </button>
      {open && (
        <div style={{ position: "absolute", top: "100%", right: 0, zIndex: 30, width: 380, background: theme.surface, color: theme.text, border: `1px solid ${theme.border}`, borderRadius: 6, boxShadow: "0 4px 16px rgba(0,0,0,.18)", padding: 6 }}>
          <input autoFocus style={{ ...inputStyle, width: "100%", boxSizing: "border-box", marginBottom: 4 }} placeholder="חיפוש ספק / מוטב…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            <div style={{ ...item, fontWeight: 700 }} onClick={() => { onChange(""); setOpen(false); setQ(""); }}>הכל</div>
            {list.map((p) => (
              <div key={partyValue(p)} style={{ ...item, background: partyValue(p) === value ? theme.background : undefined }} onClick={() => { onChange(partyValue(p)); setOpen(false); setQ(""); }}>
                <span>{partyText(p)}</span>
                {counts(p)}
              </div>
            ))}
            {!list.length && <div style={{ ...item, color: theme.textSecondary, cursor: "default" }}>אין ספק כזה בדוח</div>}
          </div>
          <div style={{ fontSize: "0.75rem", color: theme.textSecondary, padding: "6px 4px 2px" }}>המספר = שורות של הספק בדוח; <span style={red}>(באדום)</span> = תנועות בנק שאין להן רישום בספרים (סעיף 1).</div>
        </div>
      )}
    </div>
  );
};

const BankRecon = () => {
  const { theme } = useTheme();
  const [companies, setCompanies] = useState([]);
  const [company, setCompany] = useState("");
  const [account, setAccount] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [kind, setKind] = useState("");
  const [party, setParty] = useState("");
  const [facets, setFacets] = useState(null); // { kinds, parties } of the whole report (not of the filtered one)
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const reportRef = useRef(null); // the rendered HTML; bankReconBehavior adds the filters and the collapsing after each render
  useEffect(() => {
    if (report && reportRef.current) bankReconBehavior(reportRef.current.querySelector(".bank-recon"));
  }, [report]);

  useEffect(() => {
    axios
      .get("/admin/bank-recon/accounts", { withCredentials: true })
      .then((res) => {
        const list = (res.data.companies || []).filter((c) => c.banks.length);
        setCompanies(list);
        const first = list[0];
        if (first) {
          setCompany(first.code);
          setAccount(first.banks[0].key);
        }
        setFrom(res.data.defaults?.from || "");
        setTo(res.data.defaults?.to || "");
      })
      .catch((err) => setError(errText(err, "could not load the bank accounts")));
  }, []);

  const banks = useMemo(() => companies.find((c) => c.code === company)?.banks || [], [companies, company]);
  const bank = banks.find((b) => b.key === account) || null;
  const params = { company, account, from, to, ...(kind ? { kind } : {}), ...(party ? { party } : {}) };
  const query = new URLSearchParams(params).toString();
  const base = `${company}|${account}|${from}|${to}`; // the facets belong to one account and period

  const run = async (next = {}) => {
    setLoading(true);
    setError(null);
    const p = { ...params, ...next, facets: 1 };
    for (const k of ["kind", "party"]) if (!p[k]) delete p[k];
    try {
      const res = await axios.get("/admin/bank-recon/report", { params: p, withCredentials: true });
      setReport(res.data);
      if (res.data?.facets) setFacets({ base, ...res.data.facets });
    } catch (err) {
      setReport(null);
      setError(errText(err, "the report failed"));
    } finally {
      setLoading(false);
    }
  };

  const styles = {
    page: { direction: "rtl", padding: "16px", color: theme.text },
    bar: {
      display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "flex-end", padding: "12px 16px", marginBottom: "16px",
      background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: "8px",
    },
    field: { display: "flex", flexDirection: "column", gap: "4px", fontSize: "0.85rem", color: theme.textSecondary },
    input: { padding: "6px 8px", border: `1px solid ${theme.border}`, borderRadius: "4px", background: theme.background, color: theme.text, minWidth: "150px" },
    button: { padding: "8px 16px", border: "none", borderRadius: "4px", background: theme.active, color: "#fff", cursor: "pointer", fontWeight: 600 },
    secondary: { padding: "8px 16px", border: `1px solid ${theme.border}`, borderRadius: "4px", background: theme.surface, color: theme.text, cursor: "pointer", textDecoration: "none", display: "inline-block" },
    error: { background: theme.errorBg, color: theme.error, border: `1px solid ${theme.errorBorder}`, padding: "10px 14px", borderRadius: "6px", marginBottom: "12px" },
    report: { background: "#fff", color: "#222", padding: "16px 20px", borderRadius: "8px", border: `1px solid ${theme.border}`, overflowX: "auto" },
    hint: { color: theme.textSecondary, fontSize: "0.85rem" },
  };

  const canRun = company && account && from && to && !loading;
  const facetsHere = facets && facets.base === base ? facets : null; // another account or period: pick again after "הצג דוח"
  const changeFilter = (next) => {
    if ("kind" in next) setKind(next.kind);
    if ("party" in next) setParty(next.party);
    if (report) run(next);
  };

  return (
    <div style={styles.page}>
      <style>{CSS}</style>
      <h2 style={{ marginTop: 0 }}>דוח התאמת בנק מפורט</h2>
      <div style={styles.bar}>
        {companies.length > 1 && (
          <label style={styles.field}>
            חברה
            <select
              style={styles.input}
              value={company}
              onChange={(e) => {
                setCompany(e.target.value);
                const c = companies.find((x) => x.code === e.target.value);
                setAccount(c?.banks[0]?.key || "");
              }}
            >
              {companies.map((c) => (
                <option key={c.code} value={c.code}>{c.name || c.code}</option>
              ))}
            </select>
          </label>
        )}
        <label style={styles.field}>
          חשבון בנק
          <select style={styles.input} value={account} onChange={(e) => setAccount(e.target.value)}>
            {banks.map((b) => (
              <option key={b.key} value={b.key}>{b.name} ({b.key})</option>
            ))}
          </select>
        </label>
        <label style={styles.field}>
          מתאריך
          <input style={styles.input} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label style={styles.field}>
          עד תאריך
          <input style={styles.input} type="date" value={to} max={bank?.dataUpTo || undefined} onChange={(e) => setTo(e.target.value)} />
        </label>
        {facetsHere && (
          <>
            <label style={styles.field}>
              סוג תנועה
              <select style={styles.input} value={kind} onChange={(e) => changeFilter({ kind: e.target.value })}>
                <option value="">הכל</option>
                {facetsHere.kinds.map((k) => (
                  <option key={k.kind} value={k.kind}>{k.label} ({k.count})</option>
                ))}
              </select>
            </label>
            <div style={styles.field}>
              ספק / מוטב
              <PartyPicker parties={facetsHere.parties || []} value={party} onChange={(v) => changeFilter({ party: v })} theme={theme} inputStyle={styles.input} />
            </div>
          </>
        )}
        <button style={{ ...styles.button, opacity: canRun ? 1 : 0.6 }} disabled={!canRun} onClick={() => run()}>
          {loading ? "מכין…" : "הצג דוח"}
        </button>
        <a style={styles.secondary} href={`/admin/bank-recon/report?${query}&format=xlsx`}>הורד Excel</a>
        <a style={styles.secondary} href={`/admin/bank-recon/report?${query}&format=html`} target="_blank" rel="noreferrer">פתח להדפסה</a>
        {bank && <span style={styles.hint}>נתוני הבנק בחשבשבת: {bank.from} עד {bank.dataUpTo} ({bank.lines} תנועות)</span>}
      </div>
      {error && <div style={styles.error}>{String(error)}</div>}
      {report && <div ref={reportRef} style={styles.report} dangerouslySetInnerHTML={{ __html: renderBankReconBody(report) }} />}
      {!report && !error && !loading && <p style={styles.hint}>בחר חשבון ותקופה ולחץ "הצג דוח". הדוח נבנה מספרי חשבשבת (allegro_finance) לקריאה בלבד.</p>}
    </div>
  );
};

export default BankRecon;
