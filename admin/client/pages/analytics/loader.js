import React, { useState } from "react";
import { createUseStyles } from "react-jss";

/**
 * LoadingContainer
 * ---------------------------------------------------
 * Generic wrapper that shows a rolling spinner + “×” cancel button
 * whenever the `loading` prop is true. All mouse/keyboard actions are
 * blocked while loading.
 *
 * Props:
 *   loading   – boolean
 *   onCancel  – function invoked when the user clicks ×
 *   children  – regular React children rendered underneath
 *
 *
 */

const useLoadingStyles = createUseStyles({
  wrapper: { position: "relative" },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    background: "rgba(0,0,0,0.6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2000,
  },
  close: {
    position: "absolute",
    top: 16,
    right: 16,
    background: "transparent",
    border: "none",
    color: "#fff",
    fontSize: 28,
    lineHeight: 1,
    cursor: "pointer",
    "&:hover": { opacity: 0.8 },
  },
  spinner: {
    width: 64,
    height: 64,
    borderRadius: "50%",
    border: "6px solid rgba(255,255,255,0.3)",
    borderTopColor: "#4caf50",
    animation: "$spin 1s linear infinite",
  },
  "@keyframes spin": {
    from: { transform: "rotate(0deg)" },
    to: { transform: "rotate(360deg)" },
  },
});

export default ({ loading = false, onCancel, children }) => {
  const classes = useLoadingStyles();
  return (
    <div className={classes.wrapper}>
      {children}
      {loading && (
        <div className={classes.overlay}>
          <button className={classes.close} onClick={onCancel} aria-label="Cancel loading">
            ×
          </button>
          <div className={classes.spinner} />
        </div>
      )}
    </div>
  );
};
