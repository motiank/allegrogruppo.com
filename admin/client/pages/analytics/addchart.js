import React, { useState } from "react";
import { createUseStyles } from "react-jss";
import alg_style from "./dlgstyle.js";
import moment from "moment";

const useStyles = createUseStyles(alg_style);
export default ({ handleSubmit, setOpen }) => {
  const [form, setForm] = useState({
    entities: [],
    period: "last7",
    start: "",
    end: "",
    metric: "income",
    ma: "none",
    gb: "day",
    compare: false,
    weekly: false,
  });

  const periods = [
    { value: "today", label: "Today" },
    { value: "last7", label: "Last 7 Days" },
    { value: "last30", label: "Last 30 Days" },
    { value: "last90", label: "Last 90 Days" },
    { value: "last400", label: "Last 400 Days" },
    { value: "range", label: "Select Dates…" },
  ];

  const companies = [
    {
      value: "64251a17042cbcc5928813fd",
      label: "פרימיום איטליה",
      items: [
        { value: "64be1926335ee46a739a1ba2", label: "ג'ויה" },
        { value: "65cda80518611cc1cab248ca", label: "לה בראצ׳ה" },
        { value: "64251a9f37dc3d5093d7ab53", label: "פיאמונטה" },
        { value: "64ddcfdc674a1d497fe49bf8", label: "פסקרה" },
      ],
    },
    {
      value: "5fd7022862f93c0cf1df8b63,c:601261162dd7db3f39ca2049,c:655eeb44d541bee19f59e444,c:5ff41825105007954144ed8d",
      label: "פסטה לינה",
      items: [
        { value: "5fd7030f4f421bfe0e2e13bd", label: "הרצליה" },
        { value: "5ff419934676f0fddabaef3a", label: "רעננה" },
        { value: "6012624f0d491ef6429e127c", label: "רמת החיל" },
        { value: "655ef6eb9df0c279bbfb7482", label: "ראש פינה" },
      ],
    },
    {
      value: "60335c8306f5f03947387bd0,c:6322b7febdafdceae5b84cf9",
      label: "ורדה אונו",
      items: [
        { value: "60335d23cac0e25c17fe0544", label: "תל אביב" },
        { value: "6322b93aaf5f6e3b92830433", label: "פתח תקווה" },
      ],
    },
    {
      value: "60b46a83a62b1748e7b3d8a1,c:62f48c2a7f9095f113a7add3",
      label: "שי",
      items: [
        { value: "60b46ca4e8418d9c860b2b2f", label: "נתניה" },
        { value: "62f48ec8ab47895a757e1c76", label: "מודיעין" },
      ],
    },
    {
      value: "65bb3fe41ed2912aa9034a18",
      label: "אור ים",
      items: [{ value: "65bb40ae6729db482e2ed6f2", label: "אור ים" }],
    },
  ];

  const metrics = ["income", "orders", "diners", "ontopo-diners", "astrateg", "adsCost"];

  const classes = useStyles();
  const handleChange = (e) => {
    const { name, value, type, checked, options } = e.target;
    if (type === "select-multiple") {
      const selected = Array.from(options)
        .filter((o) => o.selected)
        .map((o) => o.value);
      setForm((f) => ({ ...f, [name]: selected }));
    } else if (type === "checkbox") {
      setForm((f) => ({ ...f, [name]: checked }));
    } else {
      setForm((f) => ({ ...f, [name]: value }));
    }
  };
  const getDescription = (form_) => {
    const { metric, period, start, end } = form_;
    return ` ${metric}-${period != "range" ? period : `${start}-${end}`}`;
  };
  const internalHandleSubmit = (form, e) => {
    e.preventDefault();
    try {
      const today = new moment();
      let end = today.clone();
      let start = today.clone();

      if (form.entities.length === 0) {
        alert("Please select at least one restaurant or company.");
        return false;
      }

      switch (form.period) {
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
        case "last400":
          start = today.subtract(400, "days");
          break;
        case "range":
          if (!form.start || !form.end) {
            alert("Please select a date range.");
            return false;
          }
          break;
        default:
          return false;
      }
      form.start = form.start || start.format("YYYY-MM-DD");
      form.end = form.end || end.format("YYYY-MM-DD");
      // Always use day resolution and no moving average
      form.ma = "none";
      form.gb = "day";
      form.description = getDescription(form);
      return handleSubmit(form, e);
    } catch (error) {
      console.error("Error in handleSubmit:", error);
      alert("An error occurred while submitting the form. Please try again.");
      return false;
    }
  };

  return (
    <div className={classes.modalOverlay} onClick={() => setOpen(false)}>
      <div className={classes.modal} onClick={(e) => e.stopPropagation()}>
        <form
          onSubmit={(e) => {
            return internalHandleSubmit(form, e);
          }}
        >
          <div className={classes.field} style={{ minHeight: "140px" }}>
            <label className={classes.label}>Restaurant / Companies</label>
            <select
              multiple
              name="entities"
              className={classes.select}
              value={form.map}
              onChange={handleChange}
              size={6}
              style={{ direction: "rtl", minHeight: "140px" }}
            >
              <option value={`allegro`}>{`Allegro`}</option>
              {companies.map((c) => (
                <React.Fragment key={c.value}>
                  <option key={c.value} label={c.label} value={`c:${c.value}`}></option>
                  {c.items.map((r) => (
                    <option className={classes.selectItem} key={r.value} value={`r:${r.value}`}>
                      {r.label}
                    </option>
                  ))}
                </React.Fragment>
              ))}
            </select>
          </div>

          <div className={classes.field}>
            <label className={classes.label}>Period</label>
            <select name="period" className={classes.select} value={form.period} onChange={handleChange}>
              {periods.map((p) => (
                <option value={p.value} key={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          {form.period === "range" && (
            <>
              <div className={classes.field}>
                <label className={classes.label}>Start</label>
                <input type="date" name="start" className={classes.select} value={form.start} onChange={handleChange} />
              </div>
              <div className={classes.field}>
                <label className={classes.label}>End</label>
                <input type="date" name="end" className={classes.select} value={form.end} onChange={handleChange} />
              </div>
            </>
          )}

          <div className={classes.field}>
            <label className={classes.label}>Metric</label>
            <select name="metric" className={classes.select} value={form.metric} onChange={handleChange}>
              {metrics.map((m) => (
                <option value={m} key={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div className={classes.checkboxRow}>
            <input type="checkbox" id="compare" name="compare" checked={form.compare} onChange={handleChange} />
            <label htmlFor="compare">Compare with last year</label>
          </div>

          <button type="submit" className={classes.submit}>
            Generate
          </button>
        </form>
      </div>
    </div>
  );
};
