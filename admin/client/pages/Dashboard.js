import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import OrderSystemWidget from '../components/OrderSystemWidget';

const Dashboard = () => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [draggedOrder, setDraggedOrder] = useState(null);
  const [draggedOverColumn, setDraggedOverColumn] = useState(null);

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

  useEffect(() => {
    fetchDashboardData();
    // Refresh every 30 seconds
    const interval = setInterval(fetchDashboardData, 30000);
    return () => clearInterval(interval);
  }, [fetchDashboardData]);

  const handleDragStart = (e, order) => {
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
        `/admin/orders/${draggedOrder.orderId}/status`,
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
            order.orderId === draggedOrder.orderId
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

  const kanbanColumns = [
    { id: 'open', title: 'Orders', color: '#4a90e2' },
    { id: 'in_preparation', title: 'In Preparation', color: '#f5a623' },
    { id: 'in_delivery', title: 'In Delivery', color: '#7ed321' },
    { id: 'closed', title: 'Closed Orders', color: '#9b9b9b' },
  ];

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Dashboard</h1>
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
        </div>
        <OrderSystemWidget />
      </div>

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
                        key={order.orderId}
                        draggable
                        onDragStart={(e) => handleDragStart(e, order)}
                        style={{
                          ...styles.kanbanCard,
                          ...(draggedOrder?.orderId === order.orderId ? styles.kanbanCardDragging : {}),
                        }}
                      >
                        <div style={styles.kanbanCardName}>
                          {order.customerName || 'N/A'}
                        </div>
                        <div style={styles.kanbanCardOrderNumber}>
                          #{order.beecomOrderNumber || order.orderId.substring(0, 8)}
                        </div>
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
    </div>
  );
};

const styles = {
  container: {
    maxWidth: '1600px',
    margin: '0 auto',
    padding: '20px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '30px',
    flexWrap: 'wrap',
    gap: '20px',
  },
  title: {
    fontSize: '2rem',
    fontWeight: '600',
    color: '#333',
    margin: 0,
    marginBottom: '8px',
  },
  dateInfo: {
    fontSize: '0.9rem',
    color: '#666',
    fontStyle: 'italic',
  },
  error: {
    backgroundColor: '#fee',
    color: '#c33',
    padding: '12px',
    borderRadius: '4px',
    marginBottom: '20px',
    border: '1px solid #fcc',
  },
  loading: {
    padding: '40px',
    textAlign: 'center',
    color: '#666',
    fontSize: '1.1rem',
  },
  empty: {
    padding: '40px',
    textAlign: 'center',
    color: '#999',
  },
  statsContainer: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '20px',
    marginBottom: '30px',
  },
  statCard: {
    backgroundColor: '#ffffff',
    padding: '24px',
    borderRadius: '8px',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
    textAlign: 'center',
  },
  statValue: {
    fontSize: '2rem',
    fontWeight: '600',
    color: '#333',
    marginBottom: '8px',
  },
  statLabel: {
    fontSize: '0.9rem',
    color: '#666',
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
    backgroundColor: '#f8f9fa',
    borderRadius: '8px',
    display: 'flex',
    flexDirection: 'column',
    minHeight: '400px',
    border: '2px solid transparent',
    transition: 'border-color 0.2s, background-color 0.2s',
  },
  kanbanColumnDraggedOver: {
    borderColor: '#4a90e2',
    backgroundColor: '#e8f4fd',
  },
  kanbanColumnHeader: {
    padding: '16px',
    borderTop: '4px solid #4a90e2',
    borderRadius: '8px 8px 0 0',
    backgroundColor: '#ffffff',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  kanbanColumnTitle: {
    margin: 0,
    fontSize: '1.1rem',
    fontWeight: '600',
    color: '#333',
  },
  kanbanColumnCount: {
    fontSize: '0.9rem',
    color: '#666',
    backgroundColor: '#f0f0f0',
    padding: '4px 8px',
    borderRadius: '12px',
  },
  kanbanColumnContent: {
    flex: 1,
    padding: '12px',
    overflowY: 'auto',
  },
  kanbanCard: {
    backgroundColor: '#ffffff',
    padding: '12px',
    borderRadius: '6px',
    marginBottom: '10px',
    cursor: 'move',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
    transition: 'transform 0.2s, box-shadow 0.2s',
    userSelect: 'none',
  },
  kanbanCardDragging: {
    opacity: 0.5,
    transform: 'rotate(5deg)',
  },
  kanbanCardName: {
    fontSize: '0.95rem',
    fontWeight: '500',
    color: '#333',
    marginBottom: '4px',
  },
  kanbanCardOrderNumber: {
    fontSize: '0.85rem',
    color: '#666',
    fontFamily: 'monospace',
  },
  kanbanEmpty: {
    textAlign: 'center',
    color: '#999',
    padding: '20px',
    fontSize: '0.9rem',
  },
};

export default Dashboard;
