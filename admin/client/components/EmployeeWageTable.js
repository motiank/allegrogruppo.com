import React from "react";
import { useTheme } from "../context/ThemeContext";
import { formatWage } from "../../../shared/wage.js";

// Shared employee directory table, used by both the Employees page and the
// Shifts import step's "new employees" review. It is purely presentational:
// the parent owns the data + WageDialog and passes edit callbacks. Styling is
// derived from the theme here so both call sites render identically.
//
// Props:
//   rows: [{ emp, empIdx }]   employees to render + the index callbacks use
//   onEditEmpWage(empIdx)               open the employee-level wage dialog
//   onEditRoleWage(empIdx, roleIdx)     open the per-role wage dialog
//   onUpdateTravel(empIdx, val)
//   onUpdateMaxTravel(empIdx, val)
//   onToggleContractor(empIdx)
//   actions: {
//     keyOf(emp),            stable identity for the open-menu / removing state
//     menuOpenFor, setMenuOpenFor,
//     removingId,
//     onRemove(emp),
//     onDuplicate(emp) | null   when null the Duplicate item renders disabled
//   }
const EmployeeWageTable = ({
  rows,
  onEditEmpWage,
  onEditRoleWage,
  onUpdateTravel,
  onUpdateMaxTravel,
  onToggleContractor,
  actions,
}) => {
  const { theme } = useTheme();
  const styles = buildStyles(theme);

  // Employee-level wage cell text (same compound { new_wage_type, wage } shape
  // as role wages, via the shared formatter).
  const formatWageCell = (emp) =>
    formatWage({ new_wage_type: emp.new_wage_type, wage: emp.wage });

  return (
    <div style={styles.tableWrap}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>name</th>
            <th style={styles.th}>ID_nmbr</th>
            <th style={styles.th}>mic #</th>
            <th style={styles.th}>wage</th>
            <th style={styles.th}>travel</th>
            <th style={styles.th}>maxTravel</th>
            <th style={styles.th}>contractor</th>
            <th style={styles.th}>role</th>
            <th style={styles.th}>role wage</th>
            <th style={styles.th}></th>
          </tr>
        </thead>
        <tbody>
          {rows.flatMap(({ emp, empIdx }) => {
            const roles =
              emp.roles && emp.roles.length > 0
                ? emp.roles
                : [{ role: "", wage: "" }];
            const key = actions ? actions.keyOf(emp) : empIdx;
            return roles.map((r, roleIdx) => {
              const isFirst = roleIdx === 0;
              const isLast = roleIdx === roles.length - 1;
              const cellStyle = isLast ? styles.tdEmpBoundary : styles.td;
              return (
                <tr key={`${empIdx}-${roleIdx}`}>
                  {isFirst ? (
                    <>
                      <td rowSpan={roles.length} style={styles.tdEmpBoundary}>
                        {emp.name || "—"}
                      </td>
                      <td rowSpan={roles.length} style={styles.tdEmpBoundary}>
                        {emp.ID_nmbr || "—"}
                      </td>
                      <td rowSpan={roles.length} style={styles.tdEmpBoundary}>
                        {emp.empNumber != null && emp.empNumber !== ""
                          ? emp.empNumber
                          : "—"}
                      </td>
                      <td rowSpan={roles.length} style={styles.tdEmpBoundary}>
                        <button
                          type="button"
                          style={styles.toggleButton}
                          onClick={() => onEditEmpWage(empIdx)}
                          title="Set wage"
                        >
                          {formatWageCell(emp)}
                        </button>
                      </td>
                      <td rowSpan={roles.length} style={styles.tdEmpBoundary}>
                        <input
                          type="number"
                          step="any"
                          min="0"
                          placeholder="—"
                          style={styles.wageInput}
                          value={emp.travel ?? ""}
                          onChange={(ev) =>
                            onUpdateTravel(empIdx, ev.target.value)
                          }
                        />
                      </td>
                      <td rowSpan={roles.length} style={styles.tdEmpBoundary}>
                        <input
                          type="number"
                          step="any"
                          min="0"
                          placeholder="—"
                          style={styles.wageInput}
                          value={emp.maxTravel ?? ""}
                          onChange={(ev) =>
                            onUpdateMaxTravel(empIdx, ev.target.value)
                          }
                        />
                      </td>
                      <td rowSpan={roles.length} style={styles.tdEmpBoundary}>
                        <button
                          type="button"
                          aria-pressed={!!emp.contractor}
                          onClick={() => onToggleContractor(empIdx)}
                          style={
                            emp.contractor
                              ? styles.toggleButtonActive
                              : styles.toggleButton
                          }
                          title="Mark as contractor (קבלן)"
                        >
                          {emp.contractor ? "קבלן" : "שכיר"}
                        </button>
                      </td>
                    </>
                  ) : null}
                  <td style={cellStyle}>{r.role || "—"}</td>
                  <td style={cellStyle}>
                    {r.role ? (
                      <button
                        type="button"
                        style={styles.toggleButton}
                        onClick={() => onEditRoleWage(empIdx, roleIdx)}
                        title="Set role wage"
                      >
                        {formatWage(r)}
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                  {isFirst && actions ? (
                    <td rowSpan={roles.length} style={styles.actionsCell}>
                      <button
                        type="button"
                        aria-label="Row actions"
                        aria-haspopup="menu"
                        aria-expanded={actions.menuOpenFor === key}
                        disabled={actions.removingId === key}
                        style={styles.kebabButton}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          actions.setMenuOpenFor((cur) =>
                            cur === key ? null : key,
                          );
                        }}
                      >
                        ⋮
                      </button>
                      {actions.menuOpenFor === key && (
                        <div
                          role="menu"
                          style={styles.menu}
                          onClick={(ev) => ev.stopPropagation()}
                        >
                          <button
                            type="button"
                            role="menuitem"
                            style={styles.menuItemNeutral}
                            disabled={!actions.onDuplicate}
                            onClick={() =>
                              actions.onDuplicate && actions.onDuplicate(emp)
                            }
                            title={
                              actions.onDuplicate
                                ? undefined
                                : "Available after the employee is saved"
                            }
                          >
                            Duplicate with…
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            style={styles.menuItem}
                            disabled={actions.removingId === key}
                            onClick={() => actions.onRemove(emp)}
                          >
                            {actions.removingId === key ? "Removing…" : "Remove"}
                          </button>
                        </div>
                      )}
                    </td>
                  ) : isFirst ? (
                    <td rowSpan={roles.length} style={styles.actionsCell} />
                  ) : null}
                </tr>
              );
            });
          })}
        </tbody>
      </table>
    </div>
  );
};

const buildStyles = (theme) => ({
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
  toggleButton: {
    padding: "8px 14px",
    fontSize: "0.9rem",
    fontWeight: 600,
    border: `1px solid ${theme.border}`,
    borderRadius: "6px",
    backgroundColor: theme.surface,
    color: theme.text,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  toggleButtonActive: {
    padding: "8px 14px",
    fontSize: "0.9rem",
    fontWeight: 600,
    border: `1px solid ${theme.active || "#2196f3"}`,
    borderRadius: "6px",
    backgroundColor: theme.active || "#2196f3",
    color: "#ffffff",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  actionsCell: {
    padding: "8px 4px",
    borderBottom: `2px solid ${theme.border}`,
    color: theme.text,
    verticalAlign: "middle",
    textAlign: "center",
    width: "40px",
    position: "relative",
  },
  kebabButton: {
    width: "32px",
    height: "32px",
    padding: 0,
    border: "none",
    background: "transparent",
    color: theme.text,
    cursor: "pointer",
    fontSize: "1.4rem",
    fontWeight: 700,
    lineHeight: 1,
    borderRadius: "4px",
  },
  menu: {
    position: "absolute",
    top: "32px",
    right: "4px",
    minWidth: "120px",
    backgroundColor: theme.surface,
    border: `1px solid ${theme.border}`,
    borderRadius: "6px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
    zIndex: 10,
    overflow: "hidden",
  },
  menuItem: {
    display: "block",
    width: "100%",
    padding: "8px 12px",
    border: "none",
    background: "transparent",
    color: theme.error || "#e53935",
    textAlign: "left",
    fontSize: "0.9rem",
    cursor: "pointer",
  },
  menuItemNeutral: {
    display: "block",
    width: "100%",
    padding: "8px 12px",
    border: "none",
    background: "transparent",
    color: theme.text,
    textAlign: "left",
    fontSize: "0.9rem",
    cursor: "pointer",
    borderBottom: `1px solid ${theme.border}`,
  },
});

export default EmployeeWageTable;
