import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useTheme } from '../context/ThemeContext';

const Dashboard = () => {
  const { theme } = useTheme();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [draggedOrder, setDraggedOrder] = useState(null);
  const [draggedOverColumn, setDraggedOverColumn] = useState(null);
  const [openDropdownOrderId, setOpenDropdownOrderId] = useState(null);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [eventCounts, setEventCounts] = useState({
    welcome_started: 0,
    meal_added_to_cart: 0,
    payment_step_opened: 0,
  });
  const [eventCountsLoading, setEventCountsLoading] = useState(true);

  const fetchDashboardData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Don't pass date parameter - let backend use DASHBOARD_DATE_PERIOD env var
      const response = await axios.get('/admin/orders/dashboard/stats', {
        withCredentials: true,
      });
      
      if (response.data.meta?.err) {
        setError(response.data.meta.err);
        setStats(null);
      } else {
        const statsData = response.data.rows?.[0] || null;
        if (statsData && response.data.date) {
          // Include date from response so we can display it
          statsData.date = response.data.date;
        }
        setStats(statsData);
      }
    } catch (err) {
      setError(err.response?.data?.meta?.err || err.message || 'Failed to fetch dashboard data');
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchEventCounts = useCallback(async (date) => {
    try {
      setEventCountsLoading(true);
      const params = new URLSearchParams();
      if (date) {
        params.append('start', date);
        params.append('end', date);
      }
      
      const response = await axios.get(`/admin/analytics/event-counts?${params.toString()}`, {
        withCredentials: true,
      });
      
      setEventCounts({
        welcome_started: response.data.welcome_started || 0,
        meal_added_to_cart: response.data.meal_added_to_cart || 0,
        payment_step_opened: response.data.payment_step_opened || 0,
      });
    } catch (error) {
      console.error('Error fetching event counts:', error);
      setEventCounts({
        welcome_started: 0,
        meal_added_to_cart: 0,
        payment_step_opened: 0,
      });
    } finally {
      setEventCountsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
    // Refresh every 30 seconds
    const interval = setInterval(fetchDashboardData, 30000);
    return () => clearInterval(interval);
  }, [fetchDashboardData]);

  useEffect(() => {
    // Fetch event counts when stats date changes - only for the displayed date
    if (stats && stats.date) {
      // Fetch event counts for the same date that's displayed on the dashboard
      fetchEventCounts(stats.date);
    } else {
      // Reset counts if no date
      setEventCounts({
        welcome_started: 0,
        meal_added_to_cart: 0,
        payment_step_opened: 0,
      });
      setEventCountsLoading(false);
    }
  }, [stats?.date, fetchEventCounts]);

  const handleDragStart = (e, order) => {
    setOpenDropdownOrderId(null); // Close dropdown when dragging starts
    setDraggedOrder(order);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', e.target);
  };

  const handleDragOver = (e, status) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDraggedOverColumn(status);
  };

  const handleDragLeave = () => {
    setDraggedOverColumn(null);
  };

  const handleDrop = async (e, targetStatus) => {
    e.preventDefault();
    setDraggedOverColumn(null);

    if (!draggedOrder || draggedOrder.status === targetStatus) {
      setDraggedOrder(null);
      return;
    }

    // Update order status
    try {
      const response = await axios.put(
        `/admin/orders/${draggedOrder.id}/status`,
        { status: targetStatus },
        { withCredentials: true }
      );

      if (response.data.meta?.err) {
        setError(response.data.meta.err);
      } else {
        // Update local state
        setStats(prevStats => {
          if (!prevStats) return prevStats;
          const updatedOrders = prevStats.orders.map(order =>
            order.id === draggedOrder.id
              ? { ...order, status: targetStatus }
              : order
          );
          return {
            ...prevStats,
            orders: updatedOrders,
            ordersByStatus: {
              open: updatedOrders.filter(o => o.status === 'open').length,
              in_preparation: updatedOrders.filter(o => o.status === 'in_preparation').length,
              in_delivery: updatedOrders.filter(o => o.status === 'in_delivery').length,
              closed: updatedOrders.filter(o => o.status === 'closed').length,
            }
          };
        });
      }
    } catch (err) {
      setError(err.response?.data?.meta?.err || err.message || 'Failed to update order status');
    } finally {
      setDraggedOrder(null);
    }
  };

  const getOrdersByStatus = (status) => {
    if (!stats || !stats.orders) return [];
    return stats.orders.filter(order => order.status === status);
  };

  const calculateOrderAge = (createdAt) => {
    if (!createdAt) return '00:00';
    try {
      const now = new Date();
      const created = new Date(createdAt);
      if (isNaN(created.getTime())) return '00:00';
      const diffMs = now - created;
      if (diffMs < 0) return '00:00'; // Handle future dates
      const diffMins = Math.floor(diffMs / 60000);
      const hours = Math.floor(diffMins / 60);
      const minutes = diffMins % 60;
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    } catch (e) {
      return '00:00';
    }
  };

  const kanbanColumns = [
    { id: 'open', title: 'New Orders', color: '#4a90e2' },
    { id: 'in_preparation', title: 'In Preparation', color: '#f5a623' },
    { id: 'in_delivery', title: 'In Delivery', color: '#7ed321' },
    { id: 'closed', title: 'Closed Orders', color: '#9b9b9b' },
  ];

  const handleOrderClick = (e, order) => {
    e.stopPropagation();
    setOpenDropdownOrderId(openDropdownOrderId === order.id ? null : order.id);
  };

  const handleStatusChange = async (order, newStatus) => {
    setOpenDropdownOrderId(null);
    if (order.status === newStatus) return;

    try {
      const response = await axios.put(
        `/admin/orders/${order.id}/status`,
        { status: newStatus },
        { withCredentials: true }
      );

      if (response.data.meta?.err) {
        setError(response.data.meta.err);
      } else {
        setStats(prevStats => {
          if (!prevStats) return prevStats;
          const updatedOrders = prevStats.orders.map(o =>
            o.id === order.id ? { ...o, status: newStatus } : o
          );
          return {
            ...prevStats,
            orders: updatedOrders,
            ordersByStatus: {
              open: updatedOrders.filter(o => o.status === 'open').length,
              in_preparation: updatedOrders.filter(o => o.status === 'in_preparation').length,
              in_delivery: updatedOrders.filter(o => o.status === 'in_delivery').length,
              closed: updatedOrders.filter(o => o.status === 'closed').length,
            }
          };
        });
      }
    } catch (err) {
      setError(err.response?.data?.meta?.err || err.message || 'Failed to update order status');
    }
  };

  const handleInfoClick = (order) => {
    setOpenDropdownOrderId(null);
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
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${month}/${day}/${year} ${hours}:${minutes}`;
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      setOpenDropdownOrderId(null);
    };
    if (openDropdownOrderId) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [openDropdownOrderId]);

  const getStyles = () => ({
    container: {
      maxWidth: '1600px',
      margin: '0 auto',
      padding: '20px',
    },
    dateInfo: {
      fontSize: '0.9rem',
      color: theme.textSecondary,
      fontStyle: 'italic',
      marginBottom: '20px',
    },
    error: {
      backgroundColor: theme.errorBg,
      color: theme.error,
      padding: '12px',
      borderRadius: '4px',
      marginBottom: '20px',
      border: `1px solid ${theme.errorBorder}`,
    },
    loading: {
      padding: '40px',
      textAlign: 'center',
      color: theme.textSecondary,
      fontSize: '1.1rem',
    },
    empty: {
      padding: '40px',
      textAlign: 'center',
      color: theme.textTertiary,
    },
    statsContainer: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: '20px',
      marginBottom: '30px',
    },
    statCard: {
      backgroundColor: theme.surface,
      padding: '24px',
      borderRadius: '8px',
      boxShadow: `0 2px 4px ${theme.shadow}`,
      textAlign: 'center',
      border: `1px solid ${theme.border}`,
    },
    statValue: {
      fontSize: '2rem',
      fontWeight: '600',
      color: theme.text,
      marginBottom: '8px',
    },
    statLabel: {
      fontSize: '0.9rem',
      color: theme.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
    },
    kanbanContainer: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
      gap: '20px',
      marginTop: '20px',
    },
    kanbanColumn: {
      backgroundColor: theme.surfaceSecondary,
      borderRadius: '8px',
      display: 'flex',
      flexDirection: 'column',
      minHeight: '400px',
      border: `2px solid ${theme.border}`,
      transition: 'border-color 0.2s, background-color 0.2s',
    },
    kanbanColumnDraggedOver: {
      borderColor: theme.primary,
      backgroundColor: theme.mode === 'dark' ? '#1a237e' : '#e8f4fd',
    },
    kanbanColumnHeader: {
      padding: '16px',
      borderTop: '4px solid #4a90e2',
      borderRadius: '8px 8px 0 0',
      backgroundColor: theme.surface,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderBottom: `1px solid ${theme.border}`,
    },
    kanbanColumnTitle: {
      margin: 0,
      fontSize: '1.1rem',
      fontWeight: '600',
      color: theme.text,
    },
    kanbanColumnCount: {
      fontSize: '0.9rem',
      color: theme.textSecondary,
      backgroundColor: theme.hover,
      padding: '4px 8px',
      borderRadius: '12px',
    },
    kanbanColumnContent: {
      flex: 1,
      padding: '12px',
      overflowY: 'auto',
    },
    kanbanCard: {
      backgroundColor: theme.surface,
      padding: '12px',
      borderRadius: '6px',
      marginBottom: '10px',
      cursor: 'move',
      boxShadow: `0 1px 3px ${theme.shadow}`,
      transition: 'transform 0.2s, box-shadow 0.2s',
      userSelect: 'none',
      border: `1px solid ${theme.border}`,
    },
    kanbanCardDragging: {
      opacity: 0.5,
      transform: 'rotate(5deg)',
    },
    kanbanCardName: {
      fontSize: '0.95rem',
      fontWeight: '500',
      color: theme.text,
      marginBottom: '4px',
    },
    kanbanCardOrderNumber: {
      fontSize: '0.85rem',
      color: theme.textSecondary,
      fontFamily: 'monospace',
    },
    kanbanCardDetails: {
      fontSize: '0.85rem',
      color: theme.textSecondary,
      display: 'flex',
      justifyContent: 'space-between',
      marginTop: '4px',
    },
    kanbanCardPrice: {
      fontSize: '0.85rem',
      color: theme.text,
      fontWeight: '500',
    },
    kanbanCardAge: {
      fontSize: '0.85rem',
      color: theme.textSecondary,
    },
    kanbanCardContainer: {
      position: 'relative',
    },
    dropdownMenu: {
      position: 'absolute',
      top: '100%',
      left: 0,
      right: 0,
      backgroundColor: theme.surface,
      border: `1px solid ${theme.border}`,
      borderRadius: '4px',
      boxShadow: `0 4px 12px ${theme.shadow}`,
      zIndex: 1000,
      marginTop: '4px',
      overflow: 'hidden',
    },
    dropdownItem: {
      padding: '10px 12px',
      cursor: 'pointer',
      fontSize: '0.9rem',
      color: theme.text,
      borderBottom: `1px solid ${theme.borderLight}`,
      transition: 'background-color 0.2s',
    },
    dropdownItemLast: {
      borderBottom: 'none',
    },
    dropdownItemHover: {
      backgroundColor: theme.hover,
    },
    kanbanEmpty: {
      textAlign: 'center',
      color: theme.textTertiary,
      padding: '20px',
      fontSize: '0.9rem',
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
      zIndex: 2000,
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
    eventStatsContainer: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: '20px',
      marginBottom: '30px',
    },
    eventBox: {
      backgroundColor: theme.surface,
      border: `1px solid ${theme.border}`,
      borderRadius: '8px',
      padding: '24px',
      textAlign: 'center',
      boxShadow: `0 2px 4px ${theme.shadow}`,
    },
    eventLabel: {
      fontSize: '0.75rem',
      color: theme.textSecondary,
      textTransform: 'uppercase',
      marginBottom: '8px',
      fontWeight: 600,
      letterSpacing: '0.5px',
    },
    eventCount: {
      fontSize: '2rem',
      fontWeight: 'bold',
      color: theme.success,
    },
    conversionRate: {
      fontSize: '1.125rem',
      fontWeight: 'bold',
      color: theme.info,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
  });

  const styles = getStyles();

  return (
    <div style={styles.container}>
      {stats && stats.date && (
        <div style={styles.dateInfo}>
          Showing orders for: {new Date(stats.date + 'T00:00:00').toLocaleDateString('en-US', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
          })}
        </div>
      )}

      {stats && stats.date && !eventCountsLoading && (
        <div style={styles.eventStatsContainer}>
          <div style={styles.eventBox}>
            <div style={styles.eventLabel}>Welcome</div>
            <div style={styles.eventCount}>{eventCounts.welcome_started}</div>
          </div>
          
          <div style={styles.conversionRate}>
            {eventCounts.welcome_started > 0 
              ? ((eventCounts.meal_added_to_cart / eventCounts.welcome_started) * 100).toFixed(1)
              : '0.0'}%
          </div>
          
          <div style={styles.eventBox}>
            <div style={styles.eventLabel}>Cart Add</div>
            <div style={styles.eventCount}>{eventCounts.meal_added_to_cart}</div>
          </div>
          
          <div style={styles.conversionRate}>
            {eventCounts.meal_added_to_cart > 0
              ? ((eventCounts.payment_step_opened / eventCounts.meal_added_to_cart) * 100).toFixed(1)
              : '0.0'}%
          </div>
          
          <div style={styles.eventBox}>
            <div style={styles.eventLabel}>Payment Step Opened</div>
            <div style={styles.eventCount}>{eventCounts.payment_step_opened}</div>
          </div>
        </div>
      )}

      {error && (
        <div style={styles.error}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {loading ? (
        <div style={styles.loading}>Loading dashboard data...</div>
      ) : stats ? (
        <>
          {/* Statistics Cards */}
          <div style={styles.statsContainer}>
            <div style={styles.statCard}>
              <div style={styles.statValue}>{stats.totalOrders}</div>
              <div style={styles.statLabel}>Total Orders</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statValue}>
                {stats.totalIncome.toFixed(2)} ₪
              </div>
              <div style={styles.statLabel}>Total Income</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statValue}>
                {stats.averageOrderPrice.toFixed(2)} ₪
              </div>
              <div style={styles.statLabel}>Average Order Price</div>
            </div>
          </div>

          {/* Kanban Board */}
          <div style={styles.kanbanContainer}>
            {kanbanColumns.map(column => {
              const columnOrders = getOrdersByStatus(column.id);
              const isDraggedOver = draggedOverColumn === column.id;
              
              return (
                <div
                  key={column.id}
                  style={{
                    ...styles.kanbanColumn,
                    ...(isDraggedOver ? styles.kanbanColumnDraggedOver : {}),
                  }}
                  onDragOver={(e) => handleDragOver(e, column.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, column.id)}
                >
                  <div style={{ ...styles.kanbanColumnHeader, borderTopColor: column.color }}>
                    <h3 style={styles.kanbanColumnTitle}>{column.title}</h3>
                    <span style={styles.kanbanColumnCount}>({columnOrders.length})</span>
                  </div>
                  <div style={styles.kanbanColumnContent}>
                    {columnOrders.map(order => (
                      <div
                        key={order.id}
                        style={styles.kanbanCardContainer}
                      >
                        <div
                          draggable
                          onDragStart={(e) => handleDragStart(e, order)}
                          onClick={(e) => handleOrderClick(e, order)}
                          style={{
                            ...styles.kanbanCard,
                            ...(draggedOrder?.id === order.id ? styles.kanbanCardDragging : {}),
                            cursor: 'pointer',
                          }}
                        >
                          <div style={styles.kanbanCardName}>
                            {order.customerName || 'N/A'}
                          </div>
                          <div style={styles.kanbanCardOrderNumber}>
                            #{order.id}
                          </div>
                          <div style={styles.kanbanCardDetails}>
                            <span style={styles.kanbanCardAge}>
                              {calculateOrderAge(order.created_at)}
                            </span>
                            <span style={styles.kanbanCardPrice}>
                              {parseFloat(order.total || 0).toFixed(2)} ₪
                            </span>
                          </div>
                        </div>
                        {openDropdownOrderId === order.id && (
                          <div
                            style={styles.dropdownMenu}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {kanbanColumns
                              .filter(col => col.id !== order.status)
                              .map((col, index, filtered) => (
                                <div
                                  key={col.id}
                                  onClick={() => handleStatusChange(order, col.id)}
                                  style={{
                                    ...styles.dropdownItem,
                                    ...(index === filtered.length - 1 ? styles.dropdownItemLast : {}),
                                  }}
                                  onMouseEnter={(e) => {
                                    e.target.style.backgroundColor = theme.hover;
                                  }}
                                  onMouseLeave={(e) => {
                                    e.target.style.backgroundColor = 'transparent';
                                  }}
                                >
                                  Move to {col.title}
                                </div>
                              ))}
                            <div
                              onClick={() => handleInfoClick(order)}
                              style={{
                                ...styles.dropdownItem,
                                ...styles.dropdownItemLast,
                              }}
                              onMouseEnter={(e) => {
                                e.target.style.backgroundColor = theme.hover;
                              }}
                              onMouseLeave={(e) => {
                                e.target.style.backgroundColor = 'transparent';
                              }}
                            >
                              Info
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                    {columnOrders.length === 0 && (
                      <div style={styles.kanbanEmpty}>No orders</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div style={styles.empty}>No data available</div>
      )}

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
                    <strong>Order ID:</strong> #{selectedOrder.id}
                  </div>
                  <div style={styles.detailItem}>
                    <strong>Date:</strong> {formatDate(selectedOrder.created_at)}
                  </div>
                  <div style={styles.detailItem}>
                    <strong>Customer Name:</strong>{' '}
                    {selectedOrder.customer_name || selectedOrder.customerName || '-'}
                  </div>
                  <div style={styles.detailItem}>
                    <strong>Phone:</strong> {selectedOrder.phone || '-'}
                  </div>
                  <div style={styles.detailItem}>
                    <strong>Total:</strong> {selectedOrder.total}{' '}
                    {selectedOrder.currency === '1' ? '₪' : selectedOrder.currency || '₪'}
                  </div>
                  <div style={styles.detailItem}>
                    <strong>Language:</strong> {selectedOrder.language || '-'}
                  </div>
                  <div style={styles.detailItem}>
                    <strong>Status:</strong> {selectedOrder.status || '-'}
                  </div>
                  {selectedOrder.updated_at && (
                    <div style={styles.detailItem}>
                      <strong>Updated:</strong> {formatDate(selectedOrder.updated_at)}
                    </div>
                  )}
                </div>
              </div>

              {selectedOrder.orderData && (
                <div style={styles.detailsSection}>
                  <h3 style={styles.sectionTitle}>Full Order Data</h3>
                  <pre style={styles.orderData}>
                    {JSON.stringify(
                      typeof selectedOrder.orderData === 'string' 
                        ? JSON.parse(selectedOrder.orderData) 
                        : selectedOrder.orderData, 
                      null, 
                      2
                    )}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
