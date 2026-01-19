import React, { useState, useEffect, useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  flexRender,
} from '@tanstack/react-table';
import axios from 'axios';
import { useTheme } from '../context/ThemeContext';

const Performance = () => {
  const { theme } = useTheme();
  const [refDate, setRefDate] = useState(() => {
    // Default to yesterday
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return yesterday.toISOString().split('T')[0];
  });
  const [searchTerm, setSearchTerm] = useState('');
  const [performanceData, setPerformanceData] = useState({});
  const [lastYearData, setLastYearData] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Find last year's normalized date (same day of week, closest to refdate - 365 days)
  const findLastYearDate = (refDateStr) => {
    const ref = new Date(refDateStr);
    const lastYear = new Date(ref);
    lastYear.setFullYear(lastYear.getFullYear() - 1);
    
    // Find the same day of week closest to lastYear
    const targetDayOfWeek = ref.getDay();
    const lastYearDayOfWeek = lastYear.getDay();
    const diff = targetDayOfWeek - lastYearDayOfWeek;
    
    lastYear.setDate(lastYear.getDate() + diff);
    return lastYear.toISOString().split('T')[0];
  };

  // Fetch performance data when refDate changes
  useEffect(() => {
    if (refDate) {
      // Fetch current period data (29 days ending at refdate)
      fetchPerformanceData(refDate, 'current');
      // Fetch last year period data (29 days ending at last year's normalized date)
      const lastYearRefDate = findLastYearDate(refDate);
      fetchPerformanceData(lastYearRefDate, 'lastYear');
    }
  }, [refDate]);

  const fetchPerformanceData = async (date, dataType = 'current') => {
    try {
      if (dataType === 'current') {
        setLoading(true);
      }
      setError(null);
      const response = await axios.get(`/admin/analytics/performance/${date}`, {
        withCredentials: true,
      });

      if (dataType === 'current') {
        setPerformanceData(response.data);
      } else if (dataType === 'lastYear') {
        setLastYearData(response.data);
      }
    } catch (err) {
      if (dataType === 'current') {
        setError(err.response?.data?.message || err.message || 'Failed to fetch performance data');
        setPerformanceData({});
      }
    } finally {
      if (dataType === 'current') {
        setLoading(false);
      }
    }
  };

  const handleDateChange = (e) => {
    setRefDate(e.target.value);
  };

  const handleSearchChange = (e) => {
    setSearchTerm(e.target.value);
  };

  // Calculate moving average from a specific range of days
  // Default: days 0-27 (first 28 days) for current period
  // For previous day: days 1-28 (last 28 days)
  const calculateMovingAverage = (incomeArray, startIndex = 0, endIndex = 28) => {
    if (!incomeArray || incomeArray.length < endIndex) return 0;
    const days = endIndex - startIndex;
    if (days <= 0) return 0;
    const sum = incomeArray.slice(startIndex, endIndex).reduce((acc, val) => acc + (parseFloat(val) || 0), 0);
    return sum / days;
  };

  // Calculate average daily income from the start of the month to refDate
  const calculateMonthToDateAverage = (incomeArray, refDateStr) => {
    if (!incomeArray || incomeArray.length !== 29 || !refDateStr) return 0;
    
    const refDate = new Date(refDateStr);
    const monthStart = new Date(refDate.getFullYear(), refDate.getMonth(), 1);
    
    // Calculate days from month start to refDate (inclusive)
    const daysFromMonthStart = Math.floor((refDate - monthStart) / (1000 * 60 * 60 * 24)) + 1;
    
    // The incomeArray index 28 corresponds to refDate
    // Index 0 corresponds to refDate - 28 days
    // So index 28 - daysFromMonthStart + 1 corresponds to month start
    const startIndex = Math.max(0, 29 - daysFromMonthStart);
    const endIndex = 29; // Include refDate (index 28)
    
    // If month start is before our 29-day window, use all available days
    if (startIndex === 0 && daysFromMonthStart > 29) {
      // Use all 29 days if month start is before our window
      const sum = incomeArray.reduce((acc, val) => acc + (parseFloat(val) || 0), 0);
      return sum / 29;
    }
    
    const days = endIndex - startIndex;
    if (days <= 0) return 0;
    const sum = incomeArray.slice(startIndex, endIndex).reduce((acc, val) => acc + (parseFloat(val) || 0), 0);
    return sum / days;
  };

  // Process data for table display
  const tableData = useMemo(() => {
    const processed = [];

    Object.entries(performanceData).forEach(([restaurantName, incomeArray]) => {
      if (!incomeArray || incomeArray.length !== 29) return;

      // Calculate current 28-day moving average (days 1-28) - yesterday's average
      const currentMA = calculateMovingAverage(incomeArray, 1, 29);
      
      // Calculate average daily income from month start to refDate
      const monthToDateAvg = calculateMonthToDateAverage(incomeArray, refDate);

      // Get last year data
      const lastYearIncomeArray = lastYearData[restaurantName];
      let lastYearMA = 0;
      let lastYearMonthToDateAvg = 0;
      let hasLastYearData = false;
      
      if (lastYearIncomeArray && lastYearIncomeArray.length === 29) {
        // Calculate last year 28-day moving average (days 1-28) - yesterday's average
        lastYearMA = calculateMovingAverage(lastYearIncomeArray, 1, 29);
        // Calculate last year month-to-date average
        const lastYearRefDate = findLastYearDate(refDate);
        lastYearMonthToDateAvg = calculateMonthToDateAverage(lastYearIncomeArray, lastYearRefDate);
        hasLastYearData = true;
      }
      
      // Calculate percentage difference
      let percentageDiff = 0;
      if (hasLastYearData && lastYearMA > 0) {
        percentageDiff = ((currentMA - lastYearMA) / lastYearMA) * 100;
      }

      // Calculate daily change in percentage difference
      // Use days 0-27 from the same 29-day datasets to calculate 2 days before metrics
      let dailyChange = null;
      if (hasLastYearData && lastYearIncomeArray && lastYearIncomeArray.length === 29) {
        // Calculate 2 days before current 28-day MA (days 0-27)
        const prevDayCurrentMA = calculateMovingAverage(incomeArray, 0, 28);
        
        // Calculate 2 days before last year 28-day MA (days 0-27)
        const prevDayLastYearMA = calculateMovingAverage(lastYearIncomeArray, 0, 28);
        
        let prevPercentageDiff = 0;
        if (prevDayLastYearMA > 0) {
          prevPercentageDiff = ((prevDayCurrentMA - prevDayLastYearMA) / prevDayLastYearMA) * 100;
        }
        
        // Daily change is the difference in percentage difference
        if (hasLastYearData && lastYearMA > 0) {
          dailyChange = percentageDiff - prevPercentageDiff;
        }
      }

      processed.push({
        restaurantName,
        currentMA,
        monthToDateAvg,
        lastYearMA: hasLastYearData ? lastYearMA : null,
        lastYearMonthToDateAvg: hasLastYearData ? lastYearMonthToDateAvg : null,
        percentageDiff: hasLastYearData ? percentageDiff : null,
        dailyChange,
        rawIncome: incomeArray, // Keep for reference
      });
    });

    return processed.sort((a, b) => a.restaurantName.localeCompare(b.restaurantName));
  }, [performanceData, lastYearData, refDate]);

  // Filter data based on search term
  const filteredData = useMemo(() => {
    if (!searchTerm) return tableData;
    const lowerSearch = searchTerm.toLowerCase();
    return tableData.filter((row) =>
      row.restaurantName.toLowerCase().includes(lowerSearch)
    );
  }, [tableData, searchTerm]);

  // Define columns with dynamic years from actual dates
  const columns = useMemo(() => {
    // Extract years from refDate and last year's date
    const currentYear = refDate ? new Date(refDate).getFullYear() : new Date().getFullYear();
    const lastYearDate = findLastYearDate(refDate);
    const lastYear = lastYearDate ? new Date(lastYearDate).getFullYear() : currentYear - 1;

    return [
      {
        accessorKey: 'restaurantName',
        header: 'rest.',
        cell: (info) => info.getValue(),
      },
      {
        accessorKey: 'currentMA',
        header: String(currentYear),
        cell: (info) => {
          const value = info.getValue();
          if (value === null || value === undefined) return 'N/A';
          const row = info.row.original;
          const monthAvg = row.monthToDateAvg || 0;
          return (
            <span>
              ₪{value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              {monthAvg > 0 && (
                <span style={{ color: theme.textSecondary || '#666', fontSize: '0.9em', marginLeft: '4px' }}>
                  (₪{monthAvg.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                </span>
              )}
            </span>
          );
        },
      },
      {
        accessorKey: 'lastYearMA',
        header: String(lastYear),
        cell: (info) => {
          const value = info.getValue();
          if (value === null || value === undefined) return 'N/A';
          const row = info.row.original;
          const monthAvg = row.lastYearMonthToDateAvg || 0;
          return (
            <span>
              ₪{value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              {monthAvg > 0 ? (
                <span style={{ color: theme.textSecondary || '#666', fontSize: '0.9em', marginLeft: '4px' }}>
                  (₪{monthAvg.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                </span>
              ) : (
                <span style={{ color: theme.textSecondary || '#666', fontSize: '0.9em', marginLeft: '4px' }}>
                  (none till now)
                </span>
              )}
            </span>
          );
        },
      },
      {
        accessorKey: 'percentageDiff',
        header: 'diff.',
        cell: (info) => {
          const value = info.getValue();
          if (value === null || value === undefined) return 'N/A';
          const color = value >= 0 ? theme.success || '#10b981' : theme.error || '#ef4444';
          return (
            <span style={{ color }}>
              {value >= 0 ? '+' : ''}{value.toFixed(2)}%
            </span>
          );
        },
      },
      {
        accessorKey: 'dailyChange',
        header: 'change.',
        cell: (info) => {
          const value = info.getValue();
          if (value === null || value === undefined) return 'N/A';
          const color = value >= 0 ? theme.success || '#10b981' : theme.error || '#ef4444';
          return (
            <span style={{ color }}>
              {value >= 0 ? '+' : ''}{value.toFixed(2)}%
            </span>
          );
        },
      },
    ];
  }, [theme, refDate]);

  const table = useReactTable({
    data: filteredData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const getStyles = () => ({
    container: {
      maxWidth: '1400px',
      margin: '0 auto',
      padding: '20px',
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '20px',
      flexWrap: 'wrap',
      gap: '20px',
    },
    title: {
      fontSize: '1.5rem',
      fontWeight: '600',
      color: theme.text,
      margin: 0,
    },
    filters: {
      display: 'flex',
      alignItems: 'center',
      gap: '20px',
      flexWrap: 'wrap',
    },
    filterGroup: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
    },
    filterLabel: {
      fontWeight: '500',
      color: theme.textSecondary,
      fontSize: '14px',
    },
    filterInput: {
      padding: '8px 12px',
      border: `1px solid ${theme.border}`,
      borderRadius: '4px',
      fontSize: '14px',
      fontFamily: 'inherit',
      backgroundColor: theme.surface,
      color: theme.text,
    },
    searchInput: {
      padding: '8px 12px',
      border: `1px solid ${theme.border}`,
      borderRadius: '4px',
      fontSize: '14px',
      fontFamily: 'inherit',
      backgroundColor: theme.surface,
      color: theme.text,
      minWidth: '200px',
    },
    error: {
      backgroundColor: theme.errorBg || '#fee2e2',
      color: theme.error || '#dc2626',
      padding: '12px',
      borderRadius: '4px',
      marginBottom: '20px',
      border: `1px solid ${theme.errorBorder || '#fecaca'}`,
    },
    tableContainer: {
      backgroundColor: theme.surface,
      borderRadius: '8px',
      boxShadow: `0 2px 4px ${theme.shadow}`,
      overflow: 'hidden',
      border: `1px solid ${theme.border}`,
    },
    loading: {
      padding: '40px',
      textAlign: 'center',
      color: theme.textSecondary,
    },
    empty: {
      padding: '40px',
      textAlign: 'center',
      color: theme.textTertiary,
    },
    table: {
      width: '100%',
      borderCollapse: 'collapse',
    },
    tableHeaderRow: {
      backgroundColor: theme.surfaceSecondary || theme.hover,
      borderBottom: `2px solid ${theme.border}`,
    },
    tableHeader: {
      padding: '12px 16px',
      textAlign: 'left',
      fontWeight: '600',
      color: theme.text,
      fontSize: '14px',
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
    },
    tableRow: {
      borderBottom: `1px solid ${theme.borderLight || theme.border}`,
      transition: 'background-color 0.2s',
    },
    tableRowHover: {
      backgroundColor: theme.hover,
    },
    tableCell: {
      padding: '12px 16px',
      fontSize: '14px',
      color: theme.textSecondary,
    },
  });

  const styles = getStyles();

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Performance</h1>
        <div style={styles.filters}>
          <div style={styles.filterGroup}>
            <label style={styles.filterLabel} htmlFor="search">
              Search:
            </label>
            <input
              id="search"
              type="text"
              placeholder="Filter restaurants..."
              value={searchTerm}
              onChange={handleSearchChange}
              style={styles.searchInput}
            />
          </div>
          <div style={styles.filterGroup}>
            <label style={styles.filterLabel} htmlFor="refDate">
              Reference Date:
            </label>
            <input
              id="refDate"
              type="date"
              value={refDate}
              onChange={handleDateChange}
              style={styles.filterInput}
            />
          </div>
        </div>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      <div style={styles.tableContainer}>
        {loading ? (
          <div style={styles.loading}>Loading performance data...</div>
        ) : filteredData.length === 0 ? (
          <div style={styles.empty}>
            {searchTerm ? 'No restaurants match your search.' : 'No performance data available.'}
          </div>
        ) : (
          <table style={styles.table}>
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id} style={styles.tableHeaderRow}>
                  {headerGroup.headers.map((header) => (
                    <th key={header.id} style={styles.tableHeader}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  style={styles.tableRow}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = styles.tableRowHover.backgroundColor;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} style={styles.tableCell}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default Performance;
