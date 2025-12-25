import React, { useState } from "react";
import { createUseStyles } from "react-jss";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import Loader from "./loader.js";
import AddChartDialog from "./addchart.js";
import TopBar from "./topbar.js";
import moment from "moment";

const useStyles = createUseStyles({
  container: {
    position: "relative",
    margin: 16,
    padding: 16,
    background: "#23272f",
    borderRadius: 8,
    color: "#e0e0e0",
  },
  fab: {
    position: "fixed",
    right: 24,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: "50%",
    background: "#4caf50",
    color: "#fff",
    fontSize: 32,
    border: "none",
    cursor: "pointer",
    boxShadow: "0 4px 8px rgba(0,0,0,0.3)",
    "&:hover": { opacity: 0.85 },
  },
});

function CustomLegend({ payload, lines, onClick }) {
  const lineMap = Object.fromEntries(lines.map((l) => [l.key, l]));

  return (
    <ul
      style={{
        display: "flex", // <-- this makes it horizontal
        listStyle: "none",
        margin: 0,
        padding: 0,
        gap: "1rem", // spacing between items (optional)
        flexWrap: "wrap", // allows wrapping if it overflows
        justifyContent: "center",
      }}
    >
      {payload.map((entry) => {
        const meta = lineMap[entry.dataKey];
        return (
          <li key={entry.dataKey} style={{ marginBottom: 4 }} onClick={() => onClick(entry)}>
            <span style={{ color: entry.color, fontWeight: "bold" }} title={meta.description}>
              {entry.value}
            </span>
            {/* {meta?.description && <span style={{ marginLeft: 8, fontSize: 12, color: "#aaa" }}>- {meta.description}</span>} */}
          </li>
        );
      })}
    </ul>
  );
}

function ChartWidget() {
  const classes = useStyles();
  const [tbarData, settbarData] = useState({
    period: "last7",
    start: "",
    end: "",
    gb: "day",
    compare: false,
  });

  const [open, setOpen] = useState(false);

  const [run, setRun] = useState(0);
  const [loading, setLoading] = useState(false);
  const [rawData, setRawData] = useState([]);
  const [data, setData] = useState([]);
  const [lines, setLines] = useState([]);
  const [dataKeys, setDataKey] = useState([]);
  const [hidden, setHidden] = useState([]);

  const fetchData = async (form, run) => {
    setLoading(true);

    const { entities, start, end, metric, ma, compare, gb } = form;
    try {
      const url_ = `/admin/allegro/getData/${run}/${entities.join(",")}/${start}/${end}/${metric}/${ma}/${compare ? 1 : 0}/${gb}`;
      console.log("Fetching data from:", url_);
      const response = await fetch(url_);
      return await response.json();
    } catch (error) {
      setError(error);
    } finally {
      setLoading(false);
    }
    return [];
  };

  const getDateMap = ({ start, end, gb }) => {
    const result = new Map();
    const start_ = moment(start);
    const end_ = moment(end);

    if (!start_.isValid() || !end_.isValid() || end_.isBefore(start_)) return result;

    let current;

    if (gb === "week" || gb === "month") {
      // Align to the Sunday before or equal to the startDate
      current = start_.clone().day(0); // 0 = Sunday
      if (current.isAfter(start_)) current.subtract(7, "days"); // go back if overshot
    } else {
      current = start_.clone();
    }

    const step = gb === "day" ? 1 : gb === "week" ? 7 : 28;

    while (current.isSameOrBefore(end_)) {
      const date = current.format("YYYY-MM-DD");
      result.set(date, { date });
      current.add(step, "days");
    }

    return result;
  };

  function groupIntoDateMap(map, arr) {
    if (map.size === 0) return map;

    // Sorted group dates as moment objects
    const groupDates = Array.from(map.keys())
      .map((d) => moment(d))
      .filter((m) => m.isValid())
      .sort((a, b) => a - b);

    // Sort input array by date
    const sortedArr = [...arr].sort((a, b) => a.fullDate.localeCompare(b.fullDate));

    for (const item of sortedArr) {
      const itemDate = moment(item.fullDate);
      if (!itemDate.isValid()) continue;

      // Find the latest groupDate ≤ item.date
      let matchedGroup = null;
      for (let i = groupDates.length - 1; i >= 0; i--) {
        if (groupDates[i].isSameOrBefore(itemDate)) {
          matchedGroup = groupDates[i].format("YYYY-MM-DD");
          break;
        }
      }

      if (matchedGroup && map.has(matchedGroup)) {
        const target = map.get(matchedGroup);
        for (const [key, value] of Object.entries(item)) {
          if (key === "date" || key == "fullDate") continue;
          const num = Number(value);
          if (!isNaN(num)) {
            target[key] = (target[key] || 0) + num;
          }
        }
      }
    }

    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  const handleChange = (barData) => {
    settbarData(barData);
    let new_data = groupIntoDateMap(getDateMap(barData), rawData);
    setData(new_data);
    return barData;
  };
  const handleSubmit = async (form, e) => {
    setLoading(true);
    try {
      setOpen(false);
      // const new_data = await mockFetch(form);
      const [new_data, names] = await fetchData(form, run);
      setDataKey((prev) => [...prev, ...names]);
      setHidden([...hidden, ...new Array(names.length).fill(false)]);
      setLines((prev) => [
        ...prev,
        ...names.map((n) => ({
          key: n,
          label: n,
          color: `#${Math.floor(Math.random() * 16777215).toString(16)}`, // Random color
          description: `Data for ${n} -${form.description || ""}`,
        })),
      ]);
      setRawData((prev) => [...prev, ...new_data]); // setData([...mergeArraysByDate(data, new_data)]);
      setRun((prev) => prev + 1);
    } finally {
      setTimeout(() => {
        setLoading(false);
      }, 1000);
    }
  };

  const toggleLine = (o) => {
    if (!o || !o.dataKey) return;
    const ix_ = dataKeys.findIndex((h) => h === o.dataKey);
    if (ix_ == -1) return;
    let new_hidden = [...hidden];
    new_hidden[ix_] = !new_hidden[ix_];
    setHidden(new_hidden);
  };

  return (
    <div className={classes.container}>
      <Loader loading={loading} onCancel={() => setLoading(false)}>
        <TopBar barDataChange={handleChange} />
        {data ? (
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Legend content={(props) => <CustomLegend {...props} lines={lines} onClick={toggleLine} />} />
              {dataKeys.map((dk, i) => (
                <Line key={i} type="monotone" dataKey={dk} name={`${dk}`} stroke={`${lines[i].color}`} strokeWidth={2} hide={hidden[i]} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p>No data yet. Click + to add a chart.</p>
        )}
        <button className={classes.fab} onClick={() => setOpen(true)}>
          +
        </button>
      </Loader>
      {open && <AddChartDialog handleSubmit={handleSubmit} setOpen={setOpen} />}
    </div>
  );
}

// *** Sample mock API ***
async function mockFetch({ metric, compare, name }) {
  const today = new Date();
  return Array.from({ length: 30 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (29 - i));
    const dateLabel = d.toLocaleDateString("en-GB", {
      month: "2-digit",
      day: "2-digit",
    });
    const currentValue = Math.round(1000 + Math.random() * 500);
    const previousValue = Math.round(currentValue * (0.8 + Math.random() * 0.4));
    return {
      date: dateLabel,
      [name]: currentValue,
      ...(compare ? { [`${name}previous`]: previousValue } : {}),
    };
  });
}

function mergeArraysByDate(arr1, arr2) {
  const map = new Map();

  for (const obj of [...arr1, ...arr2]) {
    const { date, ...rest } = obj;
    if (!map.has(date)) map.set(date, { date });
    Object.assign(map.get(date), rest);
  }

  return Array.from(map.values()).sort((a, b) => a.fullDate.localeCompare(b.fullDate));
}

export default ChartWidget;
