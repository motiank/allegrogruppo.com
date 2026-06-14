import React, {
  useState,
  useMemo,
  useCallback,
  useRef,
  forwardRef,
  useImperativeHandle,
} from "react";
import axios from "axios";
import { useTheme } from "../context/ThemeContext";
import { RESTAURANT_GROUPS } from "../constants/restaurants";

// Standalone, company-level shift-employee roster loader. Headless: it renders
// only a hidden file input + a single modal, and is driven imperatively from the
// "Employee" dropdown on the Employees page via ref.openPicker().
//
// Flow: openPicker() → file dialog → POST /shift-employees/preview → modal shows
// new / name-update / conflict counts and a per-conflict resolver → Save commits
// via /shift-employees/commit. Nothing is written until Save.
const companyOf = (branchId) => {
  for (const g of RESTAURANT_GROUPS) {
    if ((g.items || []).some((i) => i.value === branchId)) return g;
  }
  return null;
};

// The roster fields we send to /commit. Extra preview-only fields are ignored.
const ROW_FIELDS = ["username", "first_name", "family_name", "clock_id", "phone"];
const pickRow = (r) => {
  const out = {};
  for (const f of ROW_FIELDS) out[f] = r[f];
  return out;
};

const fullName = (r) =>
  [r.first_name, r.family_name].filter(Boolean).join(" ").trim() ||
  r.username ||
  "—";

const ShiftEmployeeLoader = forwardRef(({ selectedRestaurant }, ref) => {
  const { theme } = useTheme();
  const fileInputRef = useRef(null);

  const group = useMemo(() => companyOf(selectedRestaurant), [selectedRestaurant]);

  // idle | processing | ready | saving | done | error
  const [status, setStatus] = useState("idle");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [resolutions, setResolutions] = useState([]);
  const [commitResult, setCommitResult] = useState(null);

  const close = () => {
    setOpen(false);
    setStatus("idle");
    setPreview(null);
    setResolutions([]);
    setError(null);
    setCommitResult(null);
  };

  useImperativeHandle(ref, () => ({
    openPicker() {
      if (!selectedRestaurant) return;
      setError(null);
      setCommitResult(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
        fileInputRef.current.click();
      }
    },
  }));

  const handleFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setOpen(true);
    setStatus("processing");
    setError(null);
    setPreview(null);
    setCommitResult(null);
    try {
      const fd = new FormData();
      fd.append("rest", selectedRestaurant);
      fd.append("file", file, file.name);
      const res = await axios.post(
        "/admin/payroll/shift-employees/preview",
        fd,
        {
          withCredentials: true,
          headers: { "Content-Type": "multipart/form-data" },
        },
      );
      setPreview(res.data);
      setResolutions(
        (res.data.conflicts || []).map((c) => ({
          action: c.suggested || "update",
          targetId: c.matches[0] ? c.matches[0].id : null,
        })),
      );
      setStatus("ready");
    } catch (err) {
      setError(err.response?.data?.error || err.message || "preview failed");
      setStatus("error");
    }
  };

  const conflicts = preview?.conflicts || [];
  const counts = preview?.counts;

  const buildPayload = useCallback(() => {
    const inserts = [];
    const updates = [];
    for (const r of preview?.news || []) inserts.push(pickRow(r));
    for (const u of preview?.updates || [])
      updates.push({ id: u.id, row: pickRow(u.incoming) });
    conflicts.forEach((c, i) => {
      const r = resolutions[i] || {};
      if (r.action === "create") inserts.push(pickRow(c.incoming));
      else if (r.action === "update" && r.targetId)
        updates.push({ id: r.targetId, row: pickRow(c.incoming) });
      // "skip" → nothing
    });
    return { rest: selectedRestaurant, inserts, updates };
  }, [preview, conflicts, resolutions, selectedRestaurant]);

  const handleCommit = async () => {
    if (!preview) return;
    setStatus("saving");
    setError(null);
    try {
      const res = await axios.post(
        "/admin/payroll/shift-employees/commit",
        buildPayload(),
        { withCredentials: true },
      );
      setCommitResult(res.data);
      setStatus("done");
    } catch (err) {
      setError(err.response?.data?.error || err.message || "commit failed");
      setStatus("error");
    }
  };

  const setResolution = (idx, patch) =>
    setResolutions((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    );

  const s = makeStyles(theme);
  const keyLabel = { clock_id: "מזהה שעון", phone: "טלפון", username: "שם משתמש" };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        style={{ display: "none" }}
        onChange={handleFile}
      />

      {open && (
        <div style={s.modalBackdrop} onClick={close}>
          <div style={s.modal} dir="rtl" onClick={(e) => e.stopPropagation()}>
            <div style={s.modalHeader}>
              טעינת עובדי משמרת
              {group ? ` · ${group.label}` : ""}
            </div>

            <div style={s.modalBody}>
              {status === "processing" && (
                <div style={s.centerMsg}>מעבד קובץ…</div>
              )}

              {status === "error" && (
                <div style={s.errorBox}>
                  <strong>שגיאה:</strong> {error}
                </div>
              )}

              {status === "done" && commitResult && (
                <div style={s.successBox}>
                  נשמר: <strong>{commitResult.inserted}</strong> חדשים ·{" "}
                  <strong>{commitResult.updated}</strong> עודכנו
                  {commitResult.errors && commitResult.errors.length > 0
                    ? ` · ${commitResult.errors.length} שגיאות`
                    : ""}
                </div>
              )}

              {(status === "ready" || status === "saving") && counts && (
                <>
                  <div style={s.countsRow}>
                    <Chip theme={theme} tone="new" label="חדשים" n={counts.news} />
                    <Chip theme={theme} tone="upd" label="עדכון שם" n={counts.updates} />
                    <Chip theme={theme} tone="same" label="ללא שינוי" n={counts.unchanged} />
                    <Chip theme={theme} tone="conf" label="התנגשויות" n={counts.conflicts} />
                    <span style={s.fileName}>{preview.file}</span>
                  </div>

                  {conflicts.length > 0 ? (
                    <>
                      <p style={s.modalHint}>
                        בשורות הבאות אחד משדות המפתח (מזהה שעון / טלפון / שם משתמש)
                        השתנה, או שיש התאמה ליותר מרשומה אחת. בחר כיצד לפתור:
                      </p>
                      {conflicts.map((c, i) => {
                        const r = resolutions[i] || {};
                        const inc = c.incoming;
                        return (
                          <div key={i} style={s.conflictCard}>
                            <div style={s.conflictName}>{fullName(inc)}</div>
                            <div style={s.conflictGrid}>
                              <div style={s.conflictCol}>
                                <div style={s.colTitle}>בקובץ (נכנס)</div>
                                <KeyVals row={inc} theme={theme} />
                              </div>
                              <div style={s.conflictCol}>
                                <div style={s.colTitle}>
                                  קיים
                                  {c.matches.length > 1 ? ` (${c.matches.length})` : ""}
                                </div>
                                {c.matches.map((m) => (
                                  <label key={m.id} style={s.matchRow}>
                                    {(r.action === "update" ||
                                      c.matches.length > 1) && (
                                      <input
                                        type="radio"
                                        name={`conflict-${i}`}
                                        checked={r.targetId === m.id}
                                        onChange={() =>
                                          setResolution(i, {
                                            action: "update",
                                            targetId: m.id,
                                          })
                                        }
                                      />
                                    )}
                                    <span>
                                      <KeyVals row={m.row} theme={theme} />
                                      {m.differingKeys.length > 0 && (
                                        <span style={s.diffTag}>
                                          שינוי:{" "}
                                          {m.differingKeys
                                            .map((k) => keyLabel[k] || k)
                                            .join(", ")}
                                        </span>
                                      )}
                                    </span>
                                  </label>
                                ))}
                              </div>
                            </div>
                            <div style={s.actionPicker}>
                              {[
                                { v: "update", t: "עדכן קיים" },
                                { v: "create", t: "צור חדש" },
                                { v: "skip", t: "דלג" },
                              ].map((opt) => (
                                <label key={opt.v} style={s.actionOpt}>
                                  <input
                                    type="radio"
                                    name={`action-${i}`}
                                    checked={r.action === opt.v}
                                    onChange={() =>
                                      setResolution(i, {
                                        action: opt.v,
                                        targetId:
                                          opt.v === "update"
                                            ? r.targetId ||
                                              (c.matches[0] && c.matches[0].id)
                                            : r.targetId,
                                      })
                                    }
                                  />
                                  {opt.t}
                                </label>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </>
                  ) : (
                    <p style={s.modalHint}>
                      אין התנגשויות. לחץ "שמור" כדי לעדכן את רשימת העובדים.
                    </p>
                  )}
                </>
              )}
            </div>

            <div style={s.modalFooter}>
              {status === "ready" || status === "saving" ? (
                <>
                  <button
                    type="button"
                    style={s.secondaryButton}
                    onClick={close}
                    disabled={status === "saving"}
                  >
                    ביטול
                  </button>
                  <button
                    type="button"
                    style={{
                      ...s.primaryButton,
                      opacity: status === "saving" ? 0.6 : 1,
                      cursor: status === "saving" ? "wait" : "pointer",
                    }}
                    onClick={handleCommit}
                    disabled={status === "saving"}
                  >
                    {status === "saving" ? "שומר…" : "שמור"}
                  </button>
                </>
              ) : (
                <button type="button" style={s.primaryButton} onClick={close}>
                  סגור
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
});

ShiftEmployeeLoader.displayName = "ShiftEmployeeLoader";

const Chip = ({ theme, tone, label, n }) => {
  const tones = {
    new: { bg: theme.successBg || "#e6f4ea", fg: theme.success || "#1e7e34" },
    upd: { bg: theme.activeBg || "#e7f1ff", fg: theme.active || "#2563eb" },
    same: {
      bg: theme.surfaceSecondary || "#f1f1f1",
      fg: theme.textSecondary || "#666",
    },
    conf: { bg: theme.errorBg || "#fdecea", fg: theme.error || "#c0392b" },
  };
  const t = tones[tone] || tones.same;
  return (
    <span
      style={{
        display: "inline-flex",
        gap: 6,
        alignItems: "center",
        padding: "4px 10px",
        borderRadius: 14,
        backgroundColor: t.bg,
        color: t.fg,
        fontWeight: 600,
        fontSize: "0.85rem",
      }}
    >
      <strong>{n}</strong>
      {label}
    </span>
  );
};

const KeyVals = ({ row, theme }) => (
  <div style={{ fontSize: "0.85rem", color: theme.text, lineHeight: 1.5 }}>
    <div>מזהה שעון: {row.clock_id || "—"}</div>
    <div>טלפון: {row.phone || "—"}</div>
    <div>שם משתמש: {row.username || "—"}</div>
  </div>
);

const makeStyles = (theme) => ({
  primaryButton: {
    padding: "9px 16px",
    fontSize: "0.9rem",
    fontWeight: 600,
    border: "none",
    borderRadius: "6px",
    backgroundColor: theme.active || "#2196f3",
    color: "#fff",
    cursor: "pointer",
  },
  secondaryButton: {
    padding: "9px 14px",
    fontSize: "0.9rem",
    fontWeight: 600,
    border: `1px solid ${theme.border}`,
    borderRadius: "6px",
    backgroundColor: theme.surface,
    color: theme.text,
    cursor: "pointer",
  },
  centerMsg: { padding: "24px 0", textAlign: "center", color: theme.textSecondary },
  errorBox: {
    padding: "10px 12px",
    borderRadius: 6,
    backgroundColor: theme.errorBg || "#fdecea",
    color: theme.error || "#c0392b",
    border: `1px solid ${theme.errorBorder || "#f5c6cb"}`,
  },
  successBox: {
    padding: "10px 12px",
    borderRadius: 6,
    backgroundColor: theme.successBg || "#e6f4ea",
    color: theme.success || "#1e7e34",
    border: `1px solid ${theme.successBorder || "#c3e6cb"}`,
  },
  countsRow: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap",
    marginBottom: 12,
  },
  fileName: {
    color: theme.textTertiary || theme.textSecondary,
    fontSize: "0.8rem",
  },
  modalBackdrop: {
    position: "fixed",
    inset: 0,
    backgroundColor: "rgba(0,0,0,0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  modal: {
    width: "min(820px, 94vw)",
    maxHeight: "88vh",
    display: "flex",
    flexDirection: "column",
    backgroundColor: theme.surface,
    border: `1px solid ${theme.border}`,
    borderRadius: 10,
    overflow: "hidden",
  },
  modalHeader: {
    padding: "12px 16px",
    fontWeight: 700,
    fontSize: "1rem",
    color: theme.text,
    borderBottom: `1px solid ${theme.border}`,
  },
  modalBody: { padding: "12px 16px", overflowY: "auto" },
  modalHint: { fontSize: "0.85rem", color: theme.textSecondary, marginTop: 0 },
  modalFooter: {
    padding: "10px 16px",
    borderTop: `1px solid ${theme.border}`,
    display: "flex",
    justifyContent: "flex-end",
    gap: 8,
  },
  conflictCard: {
    border: `1px solid ${theme.border}`,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    backgroundColor: theme.surfaceSecondary || theme.surface,
  },
  conflictName: { fontWeight: 700, color: theme.text, marginBottom: 8 },
  conflictGrid: { display: "flex", gap: 16, flexWrap: "wrap" },
  conflictCol: { flex: "1 1 280px", minWidth: 240 },
  colTitle: {
    fontSize: "0.8rem",
    fontWeight: 700,
    color: theme.textSecondary,
    marginBottom: 4,
  },
  matchRow: {
    display: "flex",
    gap: 8,
    alignItems: "flex-start",
    padding: "6px 0",
    cursor: "pointer",
  },
  diffTag: {
    display: "block",
    marginTop: 4,
    fontSize: "0.78rem",
    fontWeight: 600,
    color: theme.error || "#c0392b",
  },
  actionPicker: {
    display: "flex",
    gap: 16,
    marginTop: 10,
    paddingTop: 10,
    borderTop: `1px dashed ${theme.border}`,
  },
  actionOpt: {
    display: "flex",
    gap: 6,
    alignItems: "center",
    fontSize: "0.9rem",
    color: theme.text,
    cursor: "pointer",
  },
});

export default ShiftEmployeeLoader;
