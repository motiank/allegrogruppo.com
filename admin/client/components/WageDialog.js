import React, { useState } from "react";
import { useTheme } from "../context/ThemeContext";
import { WAGE_TYPE_OPTIONS } from "../../../shared/wage.js";

// Reusable wage editor used for BOTH the employee-level wage and the per-role
// wage. Edits a compound { new_wage_type, wage } value.
//
// Props:
//   title    - header text (e.g. "Set wage for דני" or "Role wage · מלצר")
//   value    - { new_wage_type, wage } initial value
//   onSave   - (next) => void, called with the edited { new_wage_type, wage }
//   onClose  - () => void
//   allowClear - when true, shows a "Clear" button that saves an empty wage
const WageDialog = ({ title, value, onSave, onClose, allowClear = false }) => {
  const { theme } = useTheme();
  const [newWageType, setNewWageType] = useState(value?.new_wage_type || "");
  const [wage, setWage] = useState(
    value?.wage === 0 ? "0" : value?.wage || "",
  );

  const styles = {
    backdrop: {
      position: "fixed",
      inset: 0,
      backgroundColor: "rgba(0,0,0,0.5)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 1000,
    },
    modal: {
      width: "min(480px, 92vw)",
      maxHeight: "80vh",
      backgroundColor: theme.surface,
      color: theme.text,
      border: `1px solid ${theme.border}`,
      borderRadius: "8px",
      boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    },
    header: {
      padding: "14px 16px",
      borderBottom: `1px solid ${theme.border}`,
      fontWeight: 600,
      fontSize: "1rem",
    },
    body: {
      padding: "12px 16px",
      display: "flex",
      flexDirection: "column",
      gap: "10px",
    },
    label: {
      fontSize: "0.875rem",
      color: theme.textSecondary,
      fontWeight: 500,
    },
    select: {
      width: "100%",
      padding: "10px 12px",
      fontSize: "1rem",
      border: `1px solid ${theme.border}`,
      borderRadius: "6px",
      backgroundColor: theme.surface,
      color: theme.text,
      cursor: "pointer",
      outline: "none",
    },
    input: {
      width: "100%",
      padding: "10px 12px",
      fontSize: "1rem",
      border: `1px solid ${theme.border}`,
      borderRadius: "6px",
      backgroundColor: theme.surface,
      color: theme.text,
      outline: "none",
      boxSizing: "border-box",
    },
    footer: {
      padding: "10px 16px",
      borderTop: `1px solid ${theme.border}`,
      display: "flex",
      justifyContent: "flex-end",
      gap: "8px",
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
    secondaryButton: {
      padding: "8px 14px",
      fontSize: "0.9rem",
      fontWeight: 600,
      border: `1px solid ${theme.border}`,
      borderRadius: "6px",
      backgroundColor: theme.surface,
      color: theme.text,
      cursor: "pointer",
    },
  };

  // Min-wage types carry no editable amount.
  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div style={styles.modal} onClick={(ev) => ev.stopPropagation()}>
        <div style={styles.header}>{title}</div>
        <div style={styles.body}>
          <label style={styles.label}>Wage type</label>
          <select
            style={styles.select}
            value={newWageType}
            onChange={(ev) => setNewWageType(ev.target.value)}
            autoFocus
          >
            <option value="">-- choose --</option>
            {WAGE_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <label style={styles.label}>Wage</label>
          <input
            type="number"
            step="any"
            placeholder="—"
            style={styles.input}
            value={wage}
            onChange={(ev) => setWage(ev.target.value)}
          />
        </div>
        <div style={styles.footer}>
          {allowClear && (
            <button
              type="button"
              style={styles.secondaryButton}
              onClick={() => {
                onSave({ new_wage_type: "", wage: "" });
                onClose();
              }}
            >
              Clear
            </button>
          )}
          <button type="button" style={styles.secondaryButton} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            style={{
              ...styles.primaryButton,
              opacity: newWageType ? 1 : 0.6,
              cursor: newWageType ? "pointer" : "default",
            }}
            disabled={!newWageType}
            onClick={() => {
              onSave({ new_wage_type: newWageType, wage });
              onClose();
            }}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
};

export default WageDialog;
