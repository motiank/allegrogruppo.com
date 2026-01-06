import React, { useState, useEffect, useMemo } from "react";
import { createUseStyles } from "react-jss";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
} from "@tanstack/react-table";
import Loader from "./loader.js";
import AddChartDialog from "./addchart.js";
import TopBar from "./topbar.js";
import SettingsDialog from "./settingsdialog.js";
import moment from "moment";

const useStyles = createUseStyles({
  container: {
    position: "relative",
    margin: 16,
    padding: 16,
    background: "#23272f",
    borderRadius: 8,
    color: "#e0e0e0",
    "@media (max-width: 768px)": {
      margin: 0,
      padding: 8,
      borderRadius: 0,
      minHeight: "100vh",
    },
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
    "@media (max-width: 768px)": {
      right: 16,
      bottom: 16,
    },
  },
  settingsFab: {
    position: "fixed",
    left: 24,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: "50%",
    background: "#2196f3",
    color: "#fff",
    fontSize: 24,
    border: "none",
    cursor: "pointer",
    boxShadow: "0 4px 8px rgba(0,0,0,0.3)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    "&:hover": { opacity: 0.85 },
    "@media (min-width: 769px)": {
      display: "none",
    },
    "@media (max-width: 768px)": {
      left: 16,
      bottom: 16,
    },
  },
  topBarContainer: {
    "@media (max-width: 768px)": {
      display: "none",
    },
  },
  chartContainer: {
    width: "100%",
    "@media (max-width: 768px)": {
      height: "calc(100vh - 80px)",
      minHeight: 300,
    },
  },
  tableContainer: {
    marginTop: 24,
    backgroundColor: "#1a1d24",
    borderRadius: 8,
    overflow: "hidden",
    border: "1px solid #444",
    "@media (max-width: 768px)": {
      marginTop: 16,
      overflowX: "auto",
    },
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    color: "#e0e0e0",
  },
  tableHeader: {
    backgroundColor: "#2a2d34",
    padding: "12px 16px",
    textAlign: "left",
    fontWeight: "600",
    fontSize: "14px",
    color: "#e0e0e0",
    borderBottom: "2px solid #444",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    position: "sticky",
    top: 0,
    zIndex: 10,
  },
  tableCell: {
    padding: "12px 16px",
    fontSize: "14px",
    color: "#b0b0b0",
    borderBottom: "1px solid #333",
  },
  tableRow: {
    "&:hover": {
      backgroundColor: "#2a2d34",
    },
  },
  tableRowOdd: {
    backgroundColor: "#1f2228",
    "&:hover": {
      backgroundColor: "#2a2d34",
    },
  },
  tableRowEven: {
    backgroundColor: "#1a1d24",
    "&:hover": {
      backgroundColor: "#2a2d34",
    },
  },
  tableFooter: {
    backgroundColor: "#2a2d34",
    borderTop: "2px solid #444",
    fontWeight: "600",
  },
  tableFooterCell: {
    padding: "12px 16px",
    fontSize: "14px",
    color: "#e0e0e0",
    borderTop: "2px solid #444",
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
            <span style={{ color: entry.color, fontWeight: "bold" }} title={meta?.description || entry.value}>
              {entry.value}
            </span>
            {/* {meta?.description && <span style={{ marginLeft: 8, fontSize: 12, color: "#aaa" }}>- {meta.description}</span>} */}
          </li>
        );
      })}
    </ul>
  );
}

function CustomTooltip({ active, payload, label }) {
  if (active && payload && payload.length) {
    const date = payload[0]?.payload?.date || label;
    const dayOfWeek = moment(date).format('dd'); // 2-letter day abbreviation (Mo, Tu, We, etc.)
    const dateWithDay = `${date} (${dayOfWeek})`;
    
    return (
      <div
        style={{
          backgroundColor: "#23272f",
          border: "1px solid #444",
          borderRadius: "4px",
          padding: "10px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
        }}
      >
        <p style={{ margin: "0 0 8px 0", fontWeight: "bold", color: "#e0e0e0" }}>
          {dateWithDay}
        </p>
        {payload.map((entry, index) => (
          <p
            key={index}
            style={{
              margin: "4px 0",
              color: entry.color || "#e0e0e0",
            }}
          >
            {`${entry.name}: ${entry.value}`}
          </p>
        ))}
      </div>
    );
  }
  return null;
}

function ChartTable({ data, dataKeys, lines, hidden, classes }) {
  // Calculate visible data keys (excluding hidden lines)
  const visibleDataKeys = useMemo(() => {
    const visible = [];
    dataKeys.forEach((dataKey, index) => {
      if (!hidden || !hidden[index]) {
        visible.push(dataKey);
      }
    });
    return visible;
  }, [dataKeys, hidden]);

  // Create columns: date column + one column for each line (excluding hidden ones)
  const columns = useMemo(() => {
    const cols = [
      {
        accessorKey: 'date',
        header: 'Date',
        cell: (info) => {
          const date = info.getValue();
          const dayOfWeek = moment(date).format('dd');
          return `${date} (${dayOfWeek})`;
        },
      },
    ];

    // Add a column for each line, but only if it's not hidden
    dataKeys.forEach((dataKey, index) => {
      // Skip if this line is hidden
      if (hidden && hidden[index]) return;
      
      const line = lines[index];
      if (line) {
        cols.push({
          accessorKey: dataKey,
          header: line.label || dataKey,
          cell: (info) => {
            const value = info.getValue();
            return value != null ? value.toLocaleString() : '-';
          },
        });
      }
    });

    // Add sum column at the end
    cols.push({
      id: 'rowSum',
      header: 'Sum',
      cell: (info) => {
        const row = info.row.original;
        const sum = visibleDataKeys.reduce((total, key) => {
          const value = row[key];
          const numValue = typeof value === 'number' ? value : parseFloat(value);
          return total + (isNaN(numValue) ? 0 : numValue);
        }, 0);
        return sum.toLocaleString();
      },
    });

    return cols;
  }, [dataKeys, lines, hidden, visibleDataKeys]);

  // Transform data for table (data is already in the right format)
  const tableData = useMemo(() => {
    return data || [];
  }, [data]);

  // Calculate summary (totals) for each numeric column
  const summary = useMemo(() => {
    if (!data || data.length === 0) return {};
    
    const summaryObj = {};
    
    // Get all numeric column keys (excluding 'date' and 'rowSum')
    const numericKeys = columns
      .filter(col => col.accessorKey && col.accessorKey !== 'date' && col.id !== 'rowSum')
      .map(col => col.accessorKey);
    
    // Calculate totals for each numeric column
    numericKeys.forEach(key => {
      const total = data.reduce((sum, row) => {
        const value = row[key];
        const numValue = typeof value === 'number' ? value : parseFloat(value);
        return sum + (isNaN(numValue) ? 0 : numValue);
      }, 0);
      summaryObj[key] = total;
    });
    
    // Calculate total for the sum column (sum of all row sums)
    const rowSumTotal = data.reduce((total, row) => {
      const rowSum = visibleDataKeys.reduce((sum, key) => {
        const value = row[key];
        const numValue = typeof value === 'number' ? value : parseFloat(value);
        return sum + (isNaN(numValue) ? 0 : numValue);
      }, 0);
      return total + rowSum;
    }, 0);
    summaryObj.rowSum = rowSumTotal;
    
    return summaryObj;
  }, [data, columns, visibleDataKeys]);

  const table = useReactTable({
    data: tableData,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  if (!data || data.length === 0) {
    return null;
  }

  return (
    <div className={classes.tableContainer}>
      <table className={classes.table}>
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th key={header.id} className={classes.tableHeader}>
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row, index) => (
            <tr 
              key={row.id} 
              className={index % 2 === 0 ? classes.tableRowEven : classes.tableRowOdd}
            >
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className={classes.tableCell}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className={classes.tableFooter}>
            {table.getHeaderGroups()[0]?.headers.map((header, index) => {
              const accessorKey = header.column.columnDef.accessorKey;
              const columnId = header.column.columnDef.id;
              
              // Date column shows "Total" label
              if (accessorKey === 'date') {
                return (
                  <td key={header.id} className={classes.tableFooterCell}>
                    Total
                  </td>
                );
              }
              
              // Sum column or numeric columns show the sum
              const key = columnId === 'rowSum' ? 'rowSum' : accessorKey;
              const total = summary[key];
              return (
                <td key={header.id} className={classes.tableFooterCell}>
                  {total != null ? total.toLocaleString() : '-'}
                </td>
              );
            })}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function ChartWidget() {
  const classes = useStyles();
  const [tbarData, settbarData] = useState({
    period: "last7",
    start: "",
    end: "",
    gb: "day",
    ma: "none",
  });

  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const [run, setRun] = useState(0);
  const [loading, setLoading] = useState(false);
  const [rawData, setRawData] = useState([]);
  const [data, setData] = useState([]);
  const [lines, setLines] = useState([]);
  const [dataKeys, setDataKey] = useState([]);
  const [hidden, setHidden] = useState([]);

  // Detect mobile screen size
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Listen for reset event from sidebar
  useEffect(() => {
    const handleReset = () => {
      // Reset all chart data and clear all lines
      setRawData([]);
      setData([]);
      setLines([]);
      setDataKey([]);
      setHidden([]);
      setRun(0);
      settbarData({
        period: "last7",
        start: "",
        end: "",
        gb: "day",
        ma: "none",
      });
    };

    window.addEventListener('analyticsReset', handleReset);
    return () => window.removeEventListener('analyticsReset', handleReset);
  }, []);

  const fetchData = async (form, run) => {
    setLoading(true);

    const { entities, start, end, metric, compare } = form;
    // Always use day resolution and no moving average when fetching from server
    try {
      const url_ = `/admin/allegro/getData/${run}/${entities.join(",")}/${start}/${end}/${metric}/none/${compare ? 1 : 0}/day`;
      console.log("Fetching data from:", url_);
      const response = await fetch(url_);
      const result = await response.json();
      
      // Ensure we always return an array with [data, names] format
      if (Array.isArray(result) && result.length === 2) {
        const [data, names] = result;
        // Ensure data is an array
        if (Array.isArray(data) && Array.isArray(names)) {
          return [data, names];
        }
      }
      
      // If format is unexpected, return empty arrays
      console.error("Unexpected response format:", result);
      return [[], []];
    } catch (error) {
      console.error("Error fetching data:", error);
      setError(error);
      return [[], []];
    } finally {
      setLoading(false);
    }
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

  const movingAverage = (mergedData, dataKeys, windowSize) => {
    // Validate inputs
    if (!Array.isArray(mergedData) || mergedData.length === 0 || windowSize <= 0) {
      return mergedData;
    }
    
    if (!Array.isArray(dataKeys) || dataKeys.length === 0) {
      return mergedData;
    }

    const windowQueue = {};
    let windowSum = {};
    dataKeys.forEach((key) => {
      windowQueue[key] = [];
      windowSum[key] = 0;
    });

    mergedData.forEach((row, i) => {
      if (!row || typeof row !== 'object') {
        return; // Skip invalid rows
      }
      
      dataKeys.forEach((key) => {
        const value = row[key] || 0;
        windowQueue[key].push(value);
        windowSum[key] += value;

        // Once our window is larger than windowSize, remove the oldest element
        if (windowQueue[key].length > windowSize) {
          windowSum[key] -= windowQueue[key].shift();
        }

        // Only compute the average if we have a full windowSize window
        if (i >= windowSize - 1) {
          const avg = windowSum[key] / windowSize;
          row[key] = parseInt(avg);
        }
        // For rows before we have a full window, keep original values (matching server behavior)
      });
    });

    // Remove rows that don't have a full window (first windowSize - 1 rows)
    // This ensures we only show data points with complete moving averages
    return mergedData.slice(Math.max(0, windowSize - 1));
  };


  const handleChange = (barData, rawDataToUse = null) => {
    settbarData(barData);
    const dataToUse = rawDataToUse !== null ? rawDataToUse : rawData;
    
    // Ensure dataToUse is an array
    if (!Array.isArray(dataToUse)) {
      console.error("rawDataToUse is not an array:", dataToUse);
      setData([]);
      return barData;
    }
    
    let new_data = groupIntoDateMap(getDateMap(barData), dataToUse);
    
    // Ensure new_data is an array
    if (!Array.isArray(new_data)) {
      console.error("groupIntoDateMap returned non-array:", new_data);
      setData([]);
      return barData;
    }
    
    // Apply moving average if specified
    if (barData.ma && barData.ma !== "none" && new_data.length > 0) {
      const moving_average = parseInt(barData.ma);
      // Calculate window size based on groupBy (same logic as server)
      const windowSize = barData.gb === "month" 
        ? parseInt(moving_average / 28) 
        : barData.gb === "week" 
        ? parseInt(moving_average / 7) 
        : moving_average;
      
      if (windowSize > 0) {
        // Extract dataKeys from the data (all keys except 'date' and 'fullDate')
        const keysFromData = new_data.length > 0 && new_data[0] && typeof new_data[0] === 'object'
          ? Object.keys(new_data[0]).filter(k => k !== 'date' && k !== 'fullDate')
          : dataKeys;
        
        if (Array.isArray(keysFromData) && keysFromData.length > 0) {
          new_data = movingAverage(new_data, keysFromData, windowSize);
        }
      }
    }
    
    setData(new_data);
    return barData;
  };

  const calculateMaxTimeRange = (rawDataArray) => {
    if (!rawDataArray || rawDataArray.length === 0) return null;
    
    let minDate = null;
    let maxDate = null;
    
    rawDataArray.forEach((item) => {
      if (item.fullDate) {
        const date = moment(item.fullDate);
        if (date.isValid()) {
          if (!minDate || date.isBefore(minDate)) {
            minDate = date.clone();
          }
          if (!maxDate || date.isAfter(maxDate)) {
            maxDate = date.clone();
          }
        }
      }
    });
    
    if (minDate && maxDate) {
      return {
        start: minDate.format("YYYY-MM-DD"),
        end: maxDate.format("YYYY-MM-DD"),
      };
    }
    return null;
  };

  const handleSubmit = async (form, e) => {
    setLoading(true);
    try {
      setOpen(false);
      // const new_data = await mockFetch(form);
      const [new_data, names] = await fetchData(form, run);
      
      // Validate the response
      if (!Array.isArray(new_data) || !Array.isArray(names)) {
        console.error("Invalid data format received:", { new_data, names });
        alert("Error: Invalid data format received from server");
        return;
      }
      
      let processedData = [...new_data];
      let processedNames = [...names];
      
      setDataKey((prev) => [...prev, ...processedNames]);
      setHidden([...hidden, ...new Array(processedNames.length).fill(false)]);
      setLines((prev) => [
        ...prev,
        ...processedNames.map((n) => ({
          key: n,
          label: n,
          color: `#${Math.floor(Math.random() * 16777215).toString(16)}`, // Random color
          description: `Data for ${n} -${form.description || ""}`,
        })),
      ]);
      
      // Update rawData with new data - ensure it's an array
      const updatedRawData = Array.isArray(rawData) ? [...rawData, ...processedData] : [...processedData];
      setRawData(updatedRawData);
      
      // Calculate max time range from all rawData
      const timeRange = calculateMaxTimeRange(updatedRawData);
      
      if (timeRange) {
        // Update tbarData to use the max time range, preserve MA setting
        const updatedBarData = {
          ...tbarData,
          period: "range",
          start: timeRange.start,
          end: timeRange.end,
          ma: tbarData.ma || "none",
        };
        
        // Update the chart with the new time range and updated rawData
        handleChange(updatedBarData, updatedRawData);
      } else {
        // If no time range could be calculated, just refresh with current tbarData and updated rawData
        handleChange(tbarData, updatedRawData);
      }
      
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
        <div className={classes.topBarContainer}>
          <TopBar barDataChange={handleChange} tbarData={tbarData} />
        </div>
        {data && data.length > 0 && dataKeys.length > 0 && lines.length > 0 ? (
          <>
            <div className={classes.chartContainer}>
              <ResponsiveContainer width="100%" height={isMobile ? "100%" : 400}>
                <LineChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend content={(props) => <CustomLegend {...props} lines={lines} onClick={toggleLine} />} />
                  {dataKeys.map((dk, i) => {
                    if (i >= lines.length) return null;
                    return (
                      <Line key={i} type="monotone" dataKey={dk} name={`${dk}`} stroke={`${lines[i]?.color || '#888'}`} strokeWidth={2} hide={hidden[i]} />
                    );
                  })}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <ChartTable data={data} dataKeys={dataKeys} lines={lines} hidden={hidden} classes={classes} />
          </>
        ) : (
          <p>No data yet. Click + to add a chart.</p>
        )}
        <button className={classes.fab} onClick={() => setOpen(true)}>
          +
        </button>
        <button className={classes.settingsFab} onClick={() => setSettingsOpen(true)} title="Chart Settings">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M12 1v6m0 6v6m9-9h-6m-6 0H3m15.364-6.364l-4.243 4.243M7.879 7.879l-4.243 4.243m0 8.485l4.243-4.243m8.485 0l4.243-4.243M12 1a11 11 0 1 0 0 22 11 11 0 0 0 0-22z"></path>
          </svg>
        </button>
      </Loader>
      {open && <AddChartDialog handleSubmit={handleSubmit} setOpen={setOpen} />}
      {settingsOpen && <SettingsDialog handleSubmit={handleChange} setOpen={setSettingsOpen} tbarData={tbarData} />}
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
