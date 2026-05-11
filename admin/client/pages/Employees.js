import React, { useState, useEffect, useMemo, useCallback } from "react";
import axios from "axios";
import { useTheme } from "../context/ThemeContext";
import {
  RESTAURANT_GROUPS,
  findRestaurantLabel,
} from "../constants/restaurants";

const Employees = () => {
  const { theme } = useTheme();
  const [selectedRestaurant, setSelectedRestaurant] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState(null);
  const [saveError, setSaveError] = useState(null);

  const selectedLabel = useMemo(
    () => findRestaurantLabel(selectedRestaurant),
    [selectedRestaurant],
  );

  const loadEmployees = useCallback(async (rest) => {
    if (!rest) {
      setEmployees([]);
      return;
    }
    setLoading(true);
    setError(null);
    setSaveResult(null);
    setSaveError(null);
    setDirty(false);
    try {
      const res = await axios.post(
        "/admin/payroll/wages",
        { rest },
        { withCredentials: true },
      );
      const list = (res.data?.employees || [])
        .slice()
        .sort((a, b) => (a.name || "").localeCompare(b.name || "", "he"));
      const shaped = list.map((e) => ({
        employee_id: e.employee_id,
        mic_nmbr: e.mic_nmbr,
        ID_nmbr: e.ID_nmbr,
        name: e.name,
        global: e.global == null ? "" : String(e.global),
        hourly_wage: e.hourly_wage == null ? "" : String(e.hourly_wage),
        wage_type: e.wage_type || "",
        travel: e.travel == null ? "" : String(e.travel),
        roles:
          e.roles && e.roles.length > 0
            ? e.roles.map((r) => ({
                role: r.role,
                wage: r.wage == null ? "" : String(r.wage),
              }))
            : [],
      }));
      setEmployees(shaped);
    } catch (err) {
      setError(
        err.response?.data?.error || err.message || "Failed to load employees",
      );
      setEmployees([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEmployees(selectedRestaurant);
  }, [selectedRestaurant, loadEmployees]);

  const updateWage = (empIdx, roleIdx, wage) => {
    setEmployees((prev) => {
      const next = prev.slice();
      const emp = { ...next[empIdx] };
      emp.roles = emp.roles.slice();
      emp.roles[roleIdx] = { ...emp.roles[roleIdx], wage };
      next[empIdx] = emp;
      return next;
    });
    setDirty(true);
    setSaveResult(null);
  };

  const updateGlobal = (empIdx, val) => {
    setEmployees((prev) => {
      const next = prev.slice();
      next[empIdx] = { ...next[empIdx], global: val };
      return next;
    });
    setDirty(true);
    setSaveResult(null);
  };

  const updateHourlyWage = (empIdx, val) => {
    setEmployees((prev) => {
      const next = prev.slice();
      next[empIdx] = { ...next[empIdx], hourly_wage: val };
      return next;
    });
    setDirty(true);
    setSaveResult(null);
  };

  const updateWageType = (empIdx, val) => {
    setEmployees((prev) => {
      const next = prev.slice();
      next[empIdx] = { ...next[empIdx], wage_type: val };
      return next;
    });
    setDirty(true);
    setSaveResult(null);
  };

  const updateTravel = (empIdx, val) => {
    setEmployees((prev) => {
      const next = prev.slice();
      next[empIdx] = { ...next[empIdx], travel: val };
      return next;
    });
    setDirty(true);
    setSaveResult(null);
  };

  const handleUpdate = async () => {
    if (saving || employees.length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        employees: employees.map((e) => ({
          employee_id: e.employee_id,
          name: e.name,
          roles: e.roles,
          global: e.global,
          hourly_wage: e.hourly_wage,
          wage_type: e.wage_type,
          travel: e.travel,
        })),
      };
      const res = await axios.post("/admin/payroll/employees/update", payload, {
        withCredentials: true,
      });
      setSaveResult(res.data);
      setDirty(false);
    } catch (err) {
      setSaveError(err.response?.data?.error || err.message || "Update failed");
    } finally {
      setSaving(false);
    }
  };

  const styles = {
    container: {
      width: "100%",
      minHeight: "calc(100vh - 100px)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      padding: "16px 12px",
    },
    header: {
      width: "100%",
      maxWidth: "1100px",
      display: "flex",
      justifyContent: "center",
      padding: "16px 0 24px",
    },
    selectWrapper: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: "8px",
    },
    label: {
      fontSize: "0.875rem",
      color: theme.textSecondary,
      fontWeight: 500,
    },
    select: {
      minWidth: "320px",
      padding: "10px 12px",
      fontSize: "1rem",
      border: `1px solid ${theme.border}`,
      borderRadius: "6px",
      backgroundColor: theme.surface,
      color: theme.text,
      cursor: "pointer",
      outline: "none",
    },
    body: {
      width: "100%",
      maxWidth: "1100px",
      display: "flex",
      flexDirection: "column",
      gap: "12px",
    },
    summary: { fontSize: "0.9rem", color: theme.textSecondary },
    errorBox: {
      padding: "10px 12px",
      borderRadius: "6px",
      backgroundColor: theme.errorBg || "rgba(229,57,53,0.1)",
      color: theme.error || "#e53935",
      border: `1px solid ${theme.errorBorder || "#e53935"}`,
      fontSize: "0.9rem",
    },
    successBox: {
      padding: "10px 12px",
      borderRadius: "6px",
      backgroundColor: theme.successBg || "rgba(76,175,80,0.1)",
      color: theme.success || "#43a047",
      border: `1px solid ${theme.successBorder || "#43a047"}`,
      fontSize: "0.9rem",
    },
    tableWrap: { overflowX: "auto" },
    table: {
      width: "100%",
      borderCollapse: "collapse",
      fontSize: "0.9rem",
      backgroundColor: theme.surface,
      border: `1px solid ${theme.border}`,
      borderRadius: "6px",
      overflow: "hidden",
    },
    th: {
      padding: "10px 12px",
      textAlign: "left",
      borderBottom: `1px solid ${theme.border}`,
      color: theme.text,
      fontWeight: 600,
      backgroundColor: theme.surfaceSecondary || theme.surface,
      whiteSpace: "nowrap",
    },
    td: {
      padding: "8px 12px",
      borderBottom: `1px solid ${theme.border}`,
      color: theme.text,
      verticalAlign: "top",
    },
    tdEmpBoundary: {
      padding: "8px 12px",
      borderBottom: `2px solid ${theme.border}`,
      color: theme.text,
      verticalAlign: "top",
    },
    wageInput: {
      width: "120px",
      padding: "6px 8px",
      fontSize: "0.9rem",
      border: `1px solid ${theme.border}`,
      borderRadius: "4px",
      backgroundColor: theme.surface,
      color: theme.text,
      outline: "none",
    },
    actions: {
      display: "flex",
      justifyContent: "flex-end",
      marginTop: "8px",
    },
    primaryButton: {
      padding: "10px 20px",
      fontSize: "0.95rem",
      fontWeight: 600,
      border: "none",
      borderRadius: "6px",
      backgroundColor: theme.active || "#2196f3",
      color: "#ffffff",
      cursor: "pointer",
    },
    placeholder: {
      textAlign: "center",
      color: theme.textSecondary,
      fontSize: "0.95rem",
      padding: "32px 0",
    },
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.selectWrapper}>
          <label htmlFor="employees-restaurant-select" style={styles.label}>
            Select Restaurant
          </label>
          <select
            id="employees-restaurant-select"
            style={styles.select}
            value={selectedRestaurant}
            onChange={(e) => setSelectedRestaurant(e.target.value)}
          >
            <option value="">-- Choose a restaurant --</option>
            {RESTAURANT_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.items.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      </div>

      <div style={styles.body}>
        {!selectedRestaurant && (
          <div style={styles.placeholder}>
            Select a restaurant to view its employees.
          </div>
        )}

        {selectedRestaurant && loading && (
          <div style={styles.placeholder}>Loading employees…</div>
        )}

        {selectedRestaurant && error && (
          <div style={styles.errorBox}>
            <strong>Error:</strong> {error}
          </div>
        )}

        {selectedRestaurant && !loading && !error && employees.length === 0 && (
          <div style={styles.placeholder}>
            No employees yet for{" "}
            <strong style={{ color: theme.text }}>{selectedLabel}</strong>.
          </div>
        )}

        {selectedRestaurant && !loading && !error && employees.length > 0 && (
          <>
            <div style={styles.summary}>
              <strong style={{ color: theme.text }}>{employees.length}</strong>{" "}
              employee{employees.length === 1 ? "" : "s"} for{" "}
              <strong style={{ color: theme.text }}>{selectedLabel}</strong>
            </div>
            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>mic_nmbr</th>
                    <th style={styles.th}>name</th>
                    <th style={styles.th}>ID_nmbr</th>
                    <th style={styles.th}>global wage</th>
                    <th style={styles.th}>hourly_wage</th>
                    <th style={styles.th}>wage_type</th>
                    <th style={styles.th}>travel</th>
                    <th style={styles.th}>role</th>
                    <th style={styles.th}>hourly wage (per role)</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.flatMap((emp, empIdx) => {
                    const roles =
                      emp.roles && emp.roles.length > 0
                        ? emp.roles
                        : [{ role: "", wage: "" }];
                    return roles.map((r, roleIdx) => {
                      const isFirst = roleIdx === 0;
                      const isLast = roleIdx === roles.length - 1;
                      const cellStyle = isLast
                        ? styles.tdEmpBoundary
                        : styles.td;
                      return (
                        <tr key={`${emp.employee_id}-${roleIdx}`}>
                          {isFirst ? (
                            <>
                              <td
                                rowSpan={roles.length}
                                style={styles.tdEmpBoundary}
                              >
                                {emp.mic_nmbr || "—"}
                              </td>
                              <td
                                rowSpan={roles.length}
                                style={styles.tdEmpBoundary}
                              >
                                {emp.name || "—"}
                              </td>
                              <td
                                rowSpan={roles.length}
                                style={styles.tdEmpBoundary}
                              >
                                {emp.ID_nmbr || "—"}
                              </td>
                              <td
                                rowSpan={roles.length}
                                style={styles.tdEmpBoundary}
                              >
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  placeholder="—"
                                  style={styles.wageInput}
                                  value={emp.global}
                                  onChange={(ev) =>
                                    updateGlobal(empIdx, ev.target.value)
                                  }
                                />
                              </td>
                              <td
                                rowSpan={roles.length}
                                style={styles.tdEmpBoundary}
                              >
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  placeholder="—"
                                  style={styles.wageInput}
                                  value={emp.hourly_wage}
                                  onChange={(ev) =>
                                    updateHourlyWage(empIdx, ev.target.value)
                                  }
                                />
                              </td>
                              <td
                                rowSpan={roles.length}
                                style={styles.tdEmpBoundary}
                              >
                                <select
                                  style={styles.wageInput}
                                  value={emp.wage_type}
                                  onChange={(ev) =>
                                    updateWageType(empIdx, ev.target.value)
                                  }
                                >
                                  <option value="">—</option>
                                  <option value="gross">gross</option>
                                  <option value="net">net</option>
                                </select>
                              </td>
                              <td
                                rowSpan={roles.length}
                                style={styles.tdEmpBoundary}
                              >
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  placeholder="—"
                                  style={styles.wageInput}
                                  value={emp.travel}
                                  onChange={(ev) =>
                                    updateTravel(empIdx, ev.target.value)
                                  }
                                />
                              </td>
                            </>
                          ) : null}
                          <td style={cellStyle}>{r.role || "—"}</td>
                          <td style={cellStyle}>
                            {r.role ? (
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder="—"
                                style={styles.wageInput}
                                value={r.wage}
                                onChange={(ev) =>
                                  updateWage(empIdx, roleIdx, ev.target.value)
                                }
                              />
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      );
                    });
                  })}
                </tbody>
              </table>
            </div>
            <div style={styles.actions}>
              <button
                type="button"
                style={{
                  ...styles.primaryButton,
                  opacity: saving ? 0.7 : !dirty ? 0.7 : 1,
                  cursor: saving ? "wait" : !dirty ? "default" : "pointer",
                }}
                onClick={handleUpdate}
                disabled={saving || !dirty}
              >
                {saving ? "Saving…" : "Update"}
              </button>
            </div>
            {saveError && (
              <div style={styles.errorBox}>
                <strong>Error:</strong> {saveError}
              </div>
            )}
            {saveResult && (
              <div style={styles.successBox}>
                Updated <strong>{saveResult.updated}</strong> of{" "}
                {saveResult.attempted} employee
                {saveResult.attempted === 1 ? "" : "s"}
                {saveResult.errors && saveResult.errors.length > 0 && (
                  <ul style={{ margin: "8px 0 0", paddingLeft: "20px" }}>
                    {saveResult.errors.map((e, i) => (
                      <li key={i}>
                        {e.name || "(no name)"}: {e.issue}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default Employees;
