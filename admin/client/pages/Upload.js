// Upload files — one page for every data file. Drop all the files at once; the server
// recognizes each one (POST /admin/files/recognize) and the page lists what will be
// imported and what will not. Nothing is written until the user approves.
//   Tabit detailed report, bank → POST /admin/files/import (Beecomm data comes from its API, not files)
//   Tabit employee list → existing /admin/payroll/shift-employees/preview + commit (+ attach-phones)
//   Micpal / Shiklulit employee index → existing /admin/payroll/micpal/sync
import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useTheme } from "../context/ThemeContext";
import useCurrentUser from "../hooks/useCurrentUser";
import { filterRestaurantGroups, findRestaurantLabel } from "../constants/restaurants";

const ROW_FIELDS = ["username", "first_name", "family_name", "clock_id", "phone"];
const pickRow = (r) => Object.fromEntries(ROW_FIELDS.map((f) => [f, r[f]]));

const fmtSize = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const fmtDate = (s) => {
  if (!s) return "";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? String(s) : d.toLocaleString("he-IL");
};
const fmtPeriod = (p) => {
  if (!p) return "";
  if (p.month) return p.month;
  return p.from === p.to ? p.from : `${p.from} → ${p.to}`;
};
const errText = (err, fallback) => err.response?.data?.error || err.message || fallback;

// One-line description of an importer's answer.
const resultText = (kind, r) => {
  if (!r) return "";
  switch (kind) {
    case "TABIT_DETAILED":
      return `${r.shifts} shifts of ${r.employees} employees saved for ${r.month}${r.replacedOldRows ? ` (replaced ${r.replacedOldRows} older rows)` : ""}${
        r.shiftsWithoutClockOut ? ` · ${r.shiftsWithoutClockOut} without clock-out` : ""
      }`;
    case "BANK_HAPOALIM":
      return `${r.newRows} new transactions, ${r.alreadyStored} were already stored (account ${r.account})`;
    case "TABIT_ROSTER":
      return `${r.inserted} new, ${r.updated} updated${r.conflicts ? ` · ${r.conflicts} need a decision — open Shift-tabit → Employees → Shift loader` : ""}${
        r.phonesUpdated ? ` · ${r.phonesUpdated} phones updated` : ""
      }`;
    case "MICPAL_INDEX":
    case "SHIKLULIT_INDEX":
      return `${r.upserted ?? 0} employee numbers saved${r.skipped ? `, ${r.skipped} rows skipped` : ""}`;
    default:
      return "";
  }
};

const Upload = () => {
  const { theme } = useTheme();
  const { user } = useCurrentUser();
  const groups = useMemo(() => filterRestaurantGroups(Array.isArray(user?.restaurants) ? user.restaurants : null), [user]);
  const inputRef = useRef(null);

  const [files, setFiles] = useState([]); // File objects, same order as `checked`
  const [checked, setChecked] = useState(null); // server answers
  const [choice, setChoice] = useState({}); // index → { on, rest }
  const [stage, setStage] = useState("pick"); // pick | checking | review | importing | done
  const [error, setError] = useState(null);
  const [results, setResults] = useState([]);
  const [history, setHistory] = useState([]);
  const [dragOver, setDragOver] = useState(false);

  const loadHistory = () =>
    axios
      .get("/admin/files/history", { withCredentials: true })
      .then((res) => setHistory(res.data.rows || []))
      .catch(() => setHistory([]));
  useEffect(() => {
    loadHistory();
  }, []);

  const addFiles = (list) => {
    const incoming = Array.from(list || []);
    if (!incoming.length) return;
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}|${f.size}`));
      return [...prev, ...incoming.filter((f) => !seen.has(`${f.name}|${f.size}`))];
    });
    setChecked(null);
    setResults([]);
    setStage("pick");
  };

  const reset = () => {
    setFiles([]);
    setChecked(null);
    setChoice({});
    setResults([]);
    setError(null);
    setStage("pick");
    if (inputRef.current) inputRef.current.value = "";
  };

  const runCheck = async () => {
    if (!files.length) return;
    setStage("checking");
    setError(null);
    try {
      const fd = new FormData();
      for (const f of files) fd.append("files", f, f.name);
      const res = await axios.post("/admin/files/recognize", fd, { withCredentials: true });
      const list = res.data.files || [];
      setChecked(list);
      setChoice(Object.fromEntries(list.map((r, i) => [i, { on: !!r.importable, rest: r.rest || "" }])));
      setStage("review");
    } catch (err) {
      setError(errText(err, "check failed"));
      setStage("pick");
    }
  };

  const ready = checked ? checked.map((r, i) => ({ r, i })).filter(({ r }) => r.importable) : [];
  const notImported = checked ? checked.map((r, i) => ({ r, i })).filter(({ r }) => !r.importable) : [];
  const selected = ready.filter(({ i }) => choice[i]?.on);
  const missingBranch = selected.filter(({ r, i }) => r.needsBranch && !choice[i]?.rest);

  const log = (r, rest, status, result) =>
    axios.post("/admin/files/log", { name: r.name, hash: r.hash, size: r.size, kind: r.kind, rest, company: r.company || null, status, result }, { withCredentials: true }).catch(() => {});

  const importRoster = async (file, r, rest) => {
    const fd = new FormData();
    fd.append("rest", rest);
    fd.append("file", file, file.name);
    const pv = await axios.post("/admin/payroll/shift-employees/preview", fd, { withCredentials: true });
    const inserts = (pv.data.news || []).map(pickRow);
    const updates = (pv.data.updates || []).map((u) => ({ id: u.id, row: pickRow(u.incoming) }));
    const cm = await axios.post("/admin/payroll/shift-employees/commit", { rest, inserts, updates }, { withCredentials: true });
    let phonesUpdated = 0;
    try {
      const fd2 = new FormData();
      fd2.append("rest", rest);
      fd2.append("file", file, file.name);
      const ph = await axios.post("/admin/payroll/employees/attach-phones", fd2, { withCredentials: true });
      phonesUpdated = ph.data?.updated || 0;
    } catch {
      // non-fatal, as in the Shift loader: the roster is saved either way
    }
    const conflicts = (pv.data.conflicts || []).length;
    return { status: conflicts || (cm.data.errors || []).length ? "PARTIAL" : "OK", result: { ...cm.data, conflicts, phonesUpdated } };
  };

  const importPayrollIndex = async (file, r, rest) => {
    const send = (force) => {
      const fd = new FormData();
      fd.append("file", file, file.name);
      fd.append("rest", rest);
      if (force) fd.append("force", "1");
      return axios.post("/admin/payroll/micpal/sync", fd, { withCredentials: true });
    };
    let res;
    try {
      res = await send(false);
    } catch (err) {
      const d = err.response?.data;
      if (err.response?.status !== 409 || !d?.needsConfirm) throw err;
      const samples = (d.samples || []).map((s) => `#${s.keyName}: ${s.from} → ${s.to}`).join("\n");
      if (!window.confirm(`⚠️ ${r.name}\n${d.error}\n\n${samples}\n\nלהמשיך ולדרוס בכל זאת?`)) throw new Error(`cancelled — ${d.error}`);
      res = await send(true);
    }
    return { status: (res.data.errors || []).length ? "PARTIAL" : "OK", result: res.data };
  };

  const runImport = async () => {
    if (!selected.length || missingBranch.length) return;
    setStage("importing");
    setError(null);
    const out = [];
    // 1. the kinds this page's server module imports — one request
    const serverItems = selected.filter(({ r }) => r.handler === "server");
    if (serverItems.length) {
      try {
        const fd = new FormData();
        for (const { i } of serverItems) fd.append("files", files[i], files[i].name);
        fd.append("plan", JSON.stringify(serverItems.map(({ r, i }) => ({ hash: r.hash, rest: choice[i]?.rest || null }))));
        const res = await axios.post("/admin/files/import", fd, { withCredentials: true });
        for (const x of res.data.results || []) out.push(x);
      } catch (err) {
        for (const { r } of serverItems) out.push({ name: r.name, kind: r.kind, status: "FAILED", error: errText(err, "import failed") });
      }
    }
    // 2. the kinds that existing loaders import — one file at a time
    for (const { r, i } of selected.filter(({ r }) => r.handler !== "server")) {
      const rest = choice[i]?.rest || r.rest;
      try {
        const done = r.handler === "roster" ? await importRoster(files[i], r, rest) : await importPayrollIndex(files[i], r, rest);
        out.push({ name: r.name, kind: r.kind, rest, ...done });
        await log(r, rest, done.status, done.result);
      } catch (err) {
        const msg = errText(err, "import failed");
        out.push({ name: r.name, kind: r.kind, rest, status: "FAILED", error: msg });
        await log(r, rest, "FAILED", { error: msg });
      }
    }
    setResults(out);
    setStage("done");
    loadHistory();
  };

  const s = makeStyles(theme);
  const kindLabel = (k) => checked?.find((r) => r.kind === k)?.label || k;

  return (
    <div style={s.container}>
      <h2 style={s.title}>Upload files</h2>
      <p style={s.hint}>
        Drop all your files here — Tabit reports and employee lists, Micpal / Shiklulit employee files, bank transactions. The system recognizes each
        file and asks you to approve before anything is saved. Beecomm sales and cash details are loaded every day from the Beecomm API.
      </p>

      <div
        style={{ ...s.drop, ...(dragOver ? s.dropOver : {}) }}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          addFiles(e.dataTransfer.files);
        }}
      >
        <input ref={inputRef} type="file" multiple style={{ display: "none" }} onChange={(e) => addFiles(e.target.files)} />
        <div style={{ fontSize: "1.05rem", fontWeight: 600 }}>Drag & drop files here, or click to choose</div>
        <div style={s.muted}>Any number of files, up to 25 MB each</div>
      </div>

      {files.length > 0 && stage !== "done" && (
        <div style={s.bar}>
          <span>
            {files.length} file{files.length === 1 ? "" : "s"} chosen
          </span>
          <span style={{ flex: 1 }} />
          <button style={s.btnGhost} onClick={reset} disabled={stage === "checking" || stage === "importing"}>
            Clear
          </button>
          {stage !== "review" && (
            <button style={s.btn} onClick={runCheck} disabled={stage === "checking"}>
              {stage === "checking" ? "Checking…" : "Check files"}
            </button>
          )}
        </div>
      )}

      {error && <div style={s.error}>{error}</div>}

      {checked && stage !== "done" && (
        <>
          <h3 style={s.section}>
            Ready to import ({ready.length}){selected.length !== ready.length ? ` — ${selected.length} selected` : ""}
          </h3>
          {ready.length === 0 && <div style={s.muted}>None of the files can be imported.</div>}
          {ready.map(({ r, i }) => {
            const c = choice[i] || {};
            const setC = (patch) => setChoice((prev) => ({ ...prev, [i]: { ...prev[i], ...patch } }));
            return (
              <div key={i} style={{ ...s.card, opacity: c.on ? 1 : 0.6 }}>
                <label style={s.cardHead}>
                  <input type="checkbox" checked={!!c.on} onChange={(e) => setC({ on: e.target.checked })} disabled={stage === "importing"} />
                  <span style={s.kind}>{r.label}</span>
                </label>
                <div style={s.file} dir="auto">
                  {r.name} <span style={s.muted}>· {fmtSize(r.size)}</span>
                </div>
                <div>
                  {r.summary}
                  {r.period ? <span style={s.muted}> · {fmtPeriod(r.period)}</span> : null}
                </div>
                {r.needsBranch ? (
                  <div style={s.row}>
                    <span style={s.muted}>Branch:</span>
                    <select style={{ ...s.select, ...(c.on && !c.rest ? s.selectMissing : {}) }} value={c.rest || ""} onChange={(e) => setC({ rest: e.target.value })} disabled={stage === "importing"}>
                      <option value="">-- choose the branch --</option>
                      {groups.map((g) => (
                        <optgroup key={g.label} label={g.label}>
                          {g.items.map((b) => (
                            <option key={b.value} value={b.value}>
                              {b.label}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    {r.suggestion && c.rest === r.suggestion.rest && (
                      <span style={s.muted}>
                        suggested: {r.suggestion.matched} of {r.suggestion.total} names are employees of this branch
                      </span>
                    )}
                  </div>
                ) : r.group ? (
                  <div style={s.muted}>Company: {r.group}</div>
                ) : null}
                {r.kind === "TABIT_ROSTER" && <div style={s.muted}>New and changed employees are saved. People who need a decision are skipped and listed after the import.</div>}
                {r.previous && (
                  <div style={s.warn}>
                    This exact file was already uploaded {r.previous.times > 1 ? `${r.previous.times} times` : ""} (last on {fmtDate(r.previous.at)}). Importing it again
                    is safe — it replaces the same rows.
                  </div>
                )}
                {(r.warnings || []).map((w, k) => (
                  <div key={k} style={s.warn}>
                    {w}
                  </div>
                ))}
              </div>
            );
          })}

          <h3 style={s.section}>Not imported ({notImported.length})</h3>
          {notImported.length === 0 && <div style={s.muted}>Every file was recognized.</div>}
          {notImported.map(({ r, i }) => (
            <div key={i} style={{ ...s.card, borderInlineStart: `4px solid ${r.recognized ? theme.warning : theme.error}` }}>
              <div style={s.kind}>{r.recognized ? r.label : "Not recognized"}</div>
              <div style={s.file} dir="auto">
                {r.name} <span style={s.muted}>· {fmtSize(r.size || 0)}</span>
              </div>
              <div>{r.reason}</div>
            </div>
          ))}

          <div style={s.bar}>
            {missingBranch.length > 0 && <span style={{ color: theme.error }}>Choose the branch for {missingBranch.length} file(s).</span>}
            <span style={{ flex: 1 }} />
            <button style={s.btn} onClick={runImport} disabled={!selected.length || missingBranch.length > 0 || stage === "importing"}>
              {stage === "importing" ? "Importing…" : `Approve and import ${selected.length} file${selected.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </>
      )}

      {stage === "done" && (
        <>
          <h3 style={s.section}>Import results</h3>
          {results.map((x, k) => (
            <div key={k} style={{ ...s.card, borderInlineStart: `4px solid ${x.status === "OK" ? theme.success : x.status === "PARTIAL" ? theme.warning : theme.error}` }}>
              <div style={s.kind}>
                {x.status === "OK" ? "✓ Imported" : x.status === "PARTIAL" ? "⚠ Imported with notes" : "✗ Failed"} — {kindLabel(x.kind)}
              </div>
              <div style={s.file} dir="auto">
                {x.name}
                {x.rest ? <span style={s.muted}> · {findRestaurantLabel(x.rest)}</span> : null}
              </div>
              <div>{x.error || resultText(x.kind, x.result)}</div>
            </div>
          ))}
          <div style={s.bar}>
            <span style={{ flex: 1 }} />
            <button style={s.btn} onClick={reset}>
              Upload more files
            </button>
          </div>
        </>
      )}

      <h3 style={s.section}>Recent uploads</h3>
      {history.length === 0 && <div style={s.muted}>No uploads yet.</div>}
      {history.map((h) => (
        <div key={h.id} style={s.histRow}>
          <span style={{ color: h.status === "OK" ? theme.success : h.status === "PARTIAL" ? theme.warningText || theme.warning : theme.error, fontWeight: 600 }}>{h.status}</span>
          <span dir="auto" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {h.file_name}
          </span>
          <span style={s.muted}>{h.label || h.kind}</span>
          {h.rest && <span style={s.muted}>{findRestaurantLabel(h.rest)}</span>}
          <span style={s.muted}>{fmtDate(h.created_at)}</span>
          {h.user_email && <span style={s.muted}>{h.user_email}</span>}
        </div>
      ))}
    </div>
  );
};

const makeStyles = (theme) => ({
  container: { padding: "1rem", maxWidth: 900, margin: "0 auto", color: theme.text },
  title: { margin: "0 0 0.25rem" },
  hint: { color: theme.textSecondary, marginTop: 0 },
  drop: {
    border: `2px dashed ${theme.border}`,
    borderRadius: 10,
    padding: "2rem 1rem",
    textAlign: "center",
    cursor: "pointer",
    background: theme.surface,
  },
  dropOver: { borderColor: theme.primary, background: theme.activeBg || theme.surfaceSecondary },
  bar: { display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", margin: "0.9rem 0" },
  btn: { padding: "0.5rem 1rem", border: 0, borderRadius: 6, background: theme.primary, color: "#fff", fontWeight: 600, cursor: "pointer" },
  btnGhost: { padding: "0.5rem 1rem", border: `1px solid ${theme.border}`, borderRadius: 6, background: "transparent", color: theme.text, cursor: "pointer" },
  section: { margin: "1.4rem 0 0.5rem" },
  card: {
    background: theme.surface,
    border: `1px solid ${theme.border}`,
    borderRadius: 8,
    padding: "0.7rem 0.9rem",
    marginBottom: "0.55rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.3rem",
  },
  cardHead: { display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" },
  kind: { fontWeight: 600 },
  file: { fontSize: "0.9rem", wordBreak: "break-all" },
  row: { display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" },
  select: { padding: "0.35rem", borderRadius: 6, border: `1px solid ${theme.border}`, background: theme.surface, color: theme.text, maxWidth: "100%" },
  selectMissing: { borderColor: theme.error },
  muted: { color: theme.textSecondary, fontSize: "0.85rem" },
  warn: {
    background: theme.warningBg,
    color: theme.warningText || theme.text,
    border: `1px solid ${theme.warningBorder || theme.warning}`,
    borderRadius: 6,
    padding: "0.3rem 0.5rem",
    fontSize: "0.85rem",
  },
  error: { background: theme.errorBg, color: theme.error, border: `1px solid ${theme.errorBorder}`, borderRadius: 6, padding: "0.5rem 0.75rem", margin: "0.75rem 0" },
  histRow: {
    display: "flex",
    gap: "0.6rem",
    alignItems: "baseline",
    flexWrap: "wrap",
    padding: "0.4rem 0",
    borderBottom: `1px solid ${theme.borderLight || theme.border}`,
    fontSize: "0.88rem",
  },
});

export default Upload;
