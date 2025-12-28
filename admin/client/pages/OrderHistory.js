import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
} from '@tanstack/react-table';
import axios from 'axios';
import { useTheme } from '../context/ThemeContext';

const OrderHistory = () => {
  const { theme } = useTheme();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split('T')[0]
  );
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);

  // Fetch orders when date changes
  useEffect(() => {
    fetchOrders(selectedDate);
  }, [selectedDate]);

  const fetchOrders = async (date) => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get('/admin/orders', {
        params: { date },
        withCredentials: true,
      });
      
      if (response.data.meta?.err) {
        setError(response.data.meta.err);
        setOrders([]);
      } else {
        setOrders(response.data.rows || []);
      }
    } catch (err) {
      setError(err.response?.data?.meta?.err || err.message || 'Failed to fetch orders');
      setOrders([]);
    } finally {
      setLoading(false);
    }
  };

  const handleDateChange = (e) => {
    setSelectedDate(e.target.value);
  };

  const handleStatusChange = (e) => {
    setSelectedStatus(e.target.value);
  };

  const handleStatusUpdate = useCallback(async (orderId, newStatus) => {
    try {
      const response = await axios.put(`/admin/orders/${orderId}/status`, 
        { status: newStatus },
        { withCredentials: true }
      );
      
      if (response.data.meta?.err) {
        setError(response.data.meta.err);
        return false;
      }

      // Update the order in the local state
      setOrders(prevOrders => 
        prevOrders.map(order => 
          order.orderId === orderId 
            ? { ...order, status: newStatus }
            : order
        )
      );
      return true;
    } catch (err) {
      setError(err.response?.data?.meta?.err || err.message || 'Failed to update status');
      return false;
    }
  }, []);

  const handleInfoClick = (order) => {
    setSelectedOrder(order);
    setShowDetailsModal(true);
  };

  const closeModal = () => {
    setShowDetailsModal(false);
    setSelectedOrder(null);
  };

  // Format date for display
  const formatDate = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStyles = () => ({
    container: {
      maxWidth: '1400px',
      margin: '0 auto',
      padding: '20px',
    },
    header: {
      display: 'flex',
      justifyContent: 'flex-end',
      alignItems: 'center',
      marginBottom: '20px',
      flexWrap: 'wrap',
      gap: '20px',
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
    error: {
      backgroundColor: theme.errorBg,
      color: theme.error,
      padding: '12px',
      borderRadius: '4px',
      marginBottom: '20px',
      border: `1px solid ${theme.errorBorder}`,
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
      backgroundColor: theme.surfaceSecondary,
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
      borderBottom: `1px solid ${theme.borderLight}`,
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
    orderIdCell: {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: theme.info,
    },
    statusSelect: {
      padding: '6px 10px',
      border: `1px solid ${theme.border}`,
      borderRadius: '4px',
      fontSize: '14px',
      fontFamily: 'inherit',
      cursor: 'pointer',
      backgroundColor: theme.surface,
      color: theme.text,
      minWidth: '120px',
    },
    infoButton: {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      padding: '4px',
      color: theme.info,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: '4px',
      transition: 'background-color 0.2s',
    },
    infoButtonHover: {
      backgroundColor: theme.activeBg,
    },
    modalOverlay: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: theme.mode === 'dark' ? 'rgba(0, 0, 0, 0.7)' : 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '20px',
    },
    modalContent: {
      backgroundColor: theme.surface,
      borderRadius: '8px',
      boxShadow: `0 4px 20px ${theme.shadow}`,
      maxWidth: '800px',
      width: '100%',
      maxHeight: '90vh',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      border: `1px solid ${theme.border}`,
    },
    modalHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '20px',
      borderBottom: `1px solid ${theme.border}`,
    },
    modalTitle: {
      margin: 0,
      fontSize: '1.5rem',
      fontWeight: '600',
      color: theme.text,
    },
    closeButton: {
      background: 'none',
      border: 'none',
      fontSize: '32px',
      cursor: 'pointer',
      color: theme.textSecondary,
      lineHeight: '1',
      padding: '0',
      width: '32px',
      height: '32px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: '4px',
      transition: 'background-color 0.2s',
    },
    closeButtonHover: {
      backgroundColor: theme.hover,
      color: theme.text,
    },
    modalBody: {
      padding: '20px',
      overflowY: 'auto',
      flex: 1,
    },
    detailsSection: {
      marginBottom: '30px',
    },
    sectionTitle: {
      fontSize: '1.1rem',
      fontWeight: '600',
      color: theme.text,
      marginBottom: '15px',
      paddingBottom: '10px',
      borderBottom: `2px solid ${theme.border}`,
    },
    detailsGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
      gap: '15px',
    },
    detailItem: {
      fontSize: '14px',
      color: theme.textSecondary,
      lineHeight: '1.6',
    },
    orderData: {
      backgroundColor: theme.surfaceSecondary,
      padding: '15px',
      borderRadius: '4px',
      overflow: 'auto',
      fontSize: '12px',
      fontFamily: 'monospace',
      lineHeight: '1.5',
      maxHeight: '400px',
      margin: 0,
      color: theme.text,
      border: `1px solid ${theme.border}`,
    },
  });

  const styles = getStyles();

  // Define columns
  const columns = useMemo(
    () => {
      const handleStatusChangeInCell = (orderId, newStatus) => {
        handleStatusUpdate(orderId, newStatus);
      };
      
      return [
      {
        accessorKey: 'orderId',
        header: 'Order ID',
        cell: (info) => (
          <span style={styles.orderIdCell}>{info.getValue()}</span>
        ),
      },
      {
        accessorKey: 'created_at',
        header: 'Date',
        cell: (info) => formatDate(info.getValue()),
      },
      {
        accessorKey: 'customer_name',
        header: 'Name',
        cell: (info) => info.getValue() || '-',
      },
      {
        accessorKey: 'phone',
        header: 'Phone',
        cell: (info) => info.getValue() || '-',
      },
      {
        accessorKey: 'total',
        header: 'Total',
        cell: (info) => {
          const total = info.getValue();
          const currency = info.row.original.currency || '1';
          return `${total} ${currency === '1' ? '₪' : currency}`;
        },
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: (info) => {
          const order = info.row.original;
          const currentStatus = order.status || 'open';
          
          return (
            <select
              value={currentStatus}
              onChange={(e) => {
                const newStatus = e.target.value;
                handleStatusChangeInCell(order.orderId, newStatus);
              }}
              style={styles.statusSelect}
            >
              <option value="open">Open</option>
              <option value="ready">Ready</option>
              <option value="delivered">Delivered</option>
            </select>
          );
        },
      },
      {
        id: 'actions',
        header: '',
        cell: (info) => (
          <button
            onClick={() => handleInfoClick(info.row.original)}
            onMouseEnter={(e) => {
              e.target.style.backgroundColor = theme.activeBg;
            }}
            onMouseLeave={(e) => {
              e.target.style.backgroundColor = 'transparent';
            }}
            style={styles.infoButton}
            title="View details"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
          </button>
        ),
      },
      ];
    },
    [handleStatusUpdate]
  );

  // Filter orders by status (client-side)
  const filteredOrders = useMemo(() => {
    if (selectedStatus === 'all') {
      return orders;
    }
    return orders.filter(order => order.status === selectedStatus);
  }, [orders, selectedStatus]);

  const table = useReactTable({
    data: filteredOrders,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.filters}>
          <div style={styles.filterGroup}>
            <label htmlFor="date-select" style={styles.filterLabel}>
              Select Date:
            </label>
            <input
              id="date-select"
              type="date"
              value={selectedDate}
              onChange={handleDateChange}
              style={styles.filterInput}
            />
          </div>
          <div style={styles.filterGroup}>
            <label htmlFor="status-select" style={styles.filterLabel}>
              Status:
            </label>
            <select
              id="status-select"
              value={selectedStatus}
              onChange={handleStatusChange}
              style={styles.filterInput}
            >
              <option value="all">All</option>
              <option value="open">Open</option>
              <option value="ready">Ready</option>
              <option value="delivered">Delivered</option>
            </select>
          </div>
        </div>
      </div>

      {error && (
        <div style={styles.error}>
          <strong>Error:</strong> {error}
        </div>
      )}

      <div style={styles.tableContainer}>
        {loading ? (
          <div style={styles.loading}>Loading orders...</div>
        ) : orders.length === 0 ? (
          <div style={styles.empty}>
            {error ? 'Failed to load orders' : 'No orders found for the selected date'}
          </div>
        ) : filteredOrders.length === 0 ? (
          <div style={styles.empty}>
            No orders found with status "{selectedStatus}"
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
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
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
                    e.currentTarget.style.backgroundColor = theme.hover;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} style={styles.tableCell}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Order Details Modal */}
      {showDetailsModal && selectedOrder && (
        <div style={styles.modalOverlay} onClick={closeModal}>
          <div
            style={styles.modalContent}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={styles.modalHeader}>
              <h2 style={styles.modalTitle}>Order Details</h2>
              <button 
                onClick={closeModal} 
                onMouseEnter={(e) => {
                  e.target.style.backgroundColor = theme.hover;
                  e.target.style.color = theme.text;
                }}
                onMouseLeave={(e) => {
                  e.target.style.backgroundColor = 'transparent';
                  e.target.style.color = theme.textSecondary;
                }}
                style={styles.closeButton}
              >
                ×
              </button>
            </div>
            <div style={styles.modalBody}>
              <div style={styles.detailsSection}>
                <h3 style={styles.sectionTitle}>Basic Information</h3>
                <div style={styles.detailsGrid}>
                  <div style={styles.detailItem}>
                    <strong>Order ID:</strong> {selectedOrder.orderId}
                  </div>
                  <div style={styles.detailItem}>
                    <strong>Date:</strong> {formatDate(selectedOrder.created_at)}
                  </div>
                  <div style={styles.detailItem}>
                    <strong>Customer Name:</strong>{' '}
                    {selectedOrder.customer_name || '-'}
                  </div>
                  <div style={styles.detailItem}>
                    <strong>Phone:</strong> {selectedOrder.phone || '-'}
                  </div>
                  <div style={styles.detailItem}>
                    <strong>Total:</strong> {selectedOrder.total}{' '}
                    {selectedOrder.currency === '1' ? '₪' : selectedOrder.currency}
                  </div>
                  <div style={styles.detailItem}>
                    <strong>Language:</strong> {selectedOrder.language || '-'}
                  </div>
                  <div style={styles.detailItem}>
                    <strong>Updated:</strong> {formatDate(selectedOrder.updated_at)}
                  </div>
                </div>
              </div>

              <div style={styles.detailsSection}>
                <h3 style={styles.sectionTitle}>Full Order Data</h3>
                <pre style={styles.orderData}>
                  {JSON.stringify(selectedOrder.orderData, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OrderHistory;

