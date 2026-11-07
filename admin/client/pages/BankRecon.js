// Bank reconciliation (דוח התאמת בנק מפורט) — admin only. Pick the company's bank account and a date range; the
// server builds the report (GET /admin/bank-recon/report) and this page shows the Hebrew HTML from
// shared/bankReconHtml.js, with buttons for Excel and for the report in its own tab (printing).
import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useTheme } from "../context/ThemeContext";
import { renderBankReconBody, bankReconBehavior, CSS } from "../../../shared/bankReconHtml.js";

const errText = (err, fallback) => err.response?.data?.error?.message || err.response?.data?.error || err.message || fallback;

const BankRecon = () => {
  const { theme } = useTheme();
  const [companies, setCompanies] = useState([]);
  const [company, setCompany] = useState("");
  const [account, setAccount] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
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
  const params = { company, account, from, to };
  const query = new URLSearchParams(params).toString();

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get("/admin/bank-recon/report", { params, withCredentials: true });
      setReport(res.data);
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
        <button style={{ ...styles.button, opacity: canRun ? 1 : 0.6 }} disabled={!canRun} onClick={run}>
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
