import React from "react";
import { createUseStyles } from "react-jss";
import alg_style from "./dlgstyle.js";
import TopBar from "./topbar.js";

const useStyles = createUseStyles({
  ...alg_style,
  modal: {
    ...alg_style.modal,
    overflowY: "visible",
    maxHeight: "none",
    padding: 20,
  },
  settingsContainer: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    marginBottom: 16,
  },
  title: {
    marginTop: 0,
    marginBottom: 16,
    fontSize: 20,
    fontWeight: 600,
  },
});

export default ({ handleSubmit, setOpen, tbarData }) => {
  const classes = useStyles();

  const handleSettingsChange = (barData) => {
    handleSubmit(barData);
    return barData;
  };

  return (
    <div className={classes.modalOverlay} onClick={() => setOpen(false)}>
      <div className={classes.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={classes.title}>Chart Settings</h2>
        <div className={classes.settingsContainer}>
          <TopBar barDataChange={handleSettingsChange} tbarData={tbarData} vertical={true} />
        </div>
        <button className={classes.submit} onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
    </div>
  );
};
