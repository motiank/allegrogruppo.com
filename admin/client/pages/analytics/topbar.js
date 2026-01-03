import React, { useState, useEffect } from "react";
import { createUseStyles } from "react-jss";
import alg_style from "./dlgstyle.js";
import moment from "moment";
import { get } from "lodash";

const useStyles = createUseStyles(alg_style);
export default ({ barDataChange, tbarData: externalTbarData, vertical = false }) => {
  const [tbarData, settbarData] = useState({
    period: "last7",
    start: "",
    end: "",
    gb: "day",
    ma: "none",
  });

  // Sync internal state with external prop when it changes
  useEffect(() => {
    if (externalTbarData) {
      settbarData(externalTbarData);
    }
  }, [externalTbarData]);

  const periods = [
    { value: "today", label: "Today" },
    { value: "last7", label: "Last 7 Days" },
    { value: "last30", label: "Last 30 Days" },
    { value: "last90", label: "Last 90 Days" },
    { value: "range", label: "Select Dates…" },
  ];

  const mas = ["none", "7", "14", "28", "56"];
  const groups = ["day", "week", "month"];

  const classes = useStyles();
  const getPeriod = (name, value) => {
    if (name === "start" || name === "end") {
      return { [name]: value };
    } else if (name === "period") {
      const today = new moment();
      let end = today.clone();
      let start = today.clone();
      switch (value) {
        case "today":
          start = today;
          break;
        case "last7":
          start = today.subtract(7, "days");
          break;
        case "last30":
          start = today.subtract(30, "days");
          break;
        case "last90":
          start = today.subtract(90, "days");
          break;
        case "range":
          if (!tbarData.start || !tbarData.end) {
            alert("Please select a date range.");
            return false;
          }
          break;
        default:
          return {};
      }
      return { start: start.format("YYYY-MM-DD"), end: end.format("YYYY-MM-DD") };
    }
    return {};
  };
  const handleChange = (e) => {
    const { name, value, type, checked, options } = e.target;
    if (type === "checkbox") {
      settbarData((f) => {
        return barDataChange({ ...f, [name]: checked });
      });
    } else {
      settbarData((f) => {
        return barDataChange({ ...f, ...getPeriod(name, value), [name]: value });
      });
    }
  };

  return (
    <div className={vertical ? classes.tfContainerVertical : classes.tfContainer}>
      <div className={classes.field}>
        <label className={classes.label}>Period</label>
        <select name="period" className={classes.select} value={tbarData.period} onChange={handleChange}>
          {periods.map((p) => (
            <option value={p.value} key={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      <>
        <div className={classes.field}>
          <label className={classes.label}>Start</label>
          <input type="date" name="start" className={classes.select} value={tbarData.start} onChange={handleChange} />
        </div>
        <div className={classes.field}>
          <label className={classes.label}>End</label>
          <input type="date" name="end" className={classes.select} value={tbarData.end} onChange={handleChange} />
        </div>
      </>
      <div className={classes.field}>
        <label className={classes.label}>Group By</label>
        <select name="gb" className={classes.select} value={tbarData.gb} onChange={handleChange}>
          {groups.map((m) => (
            <option value={m} key={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
      <div className={classes.field}>
        <label className={classes.label}>Moving Average</label>
        <select name="ma" className={classes.select} value={tbarData.ma || "none"} onChange={handleChange}>
          {mas.map((m) => (
            <option value={m} key={m}>
              {m === "none" ? "None" : `${m} days`}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};
