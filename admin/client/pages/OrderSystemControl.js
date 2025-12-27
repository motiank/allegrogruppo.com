import React, { useState, useEffect } from 'react';
import axios from 'axios';

const OrderSystemControl = () => {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Fetch current state on mount
  useEffect(() => {
    fetchState();
    // Poll for state changes every 5 seconds
    const interval = setInterval(fetchState, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchState = async () => {
    try {
      const response = await axios.get('/admin/order-system/state', {
        withCredentials: true,
      });
      setState(response.data);
      setError(null);
    } catch (err) {
      console.error('Error fetching state:', err);
      setError(err.response?.data?.error || err.message || 'Failed to fetch order system state');
    } finally {
      setLoading(false);
    }
  };

  const updateState = async (newState) => {
    setUpdating(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await axios.post(
        '/admin/order-system/state',
        { state: newState },
        { withCredentials: true }
      );

      if (response.data.success !== false) {
        setState(response.data.state || response.data);
        setSuccess(`Order system ${newState} successfully`);
        // Clear success message after 3 seconds
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError(response.data.error || 'Failed to update state');
      }
    } catch (err) {
      console.error('Error updating state:', err);
      setError(err.response?.data?.error || err.message || 'Failed to update order system state');
    } finally {
      setUpdating(false);
    }
  };

  const getStateDisplay = (stateValue) => {
    switch (stateValue) {
      case 'active':
        return { label: 'Active', color: '#28a745', icon: '✓' };
      case 'shutdown':
        return { label: 'Shutdown', color: '#dc3545', icon: '✗' };
      case 'postponed':
        return { label: 'Postponed', color: '#ffc107', icon: '⏸' };
      default:
        return { label: 'Unknown', color: '#6c757d', icon: '?' };
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const getTimeRemaining = (postponedUntil) => {
    if (!postponedUntil) return null;
    const now = new Date();
    const until = new Date(postponedUntil);
    const diff = until - now;
    
    if (diff <= 0) return 'Expired';
    
    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  };

  const stateDisplay = state ? getStateDisplay(state.state) : null;
  const timeRemaining = state?.postponedUntil ? getTimeRemaining(state.postponedUntil) : null;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>Order System Control</h1>
        <p style={styles.subtitle}>Manage the order system state and availability</p>
      </div>

      {error && (
        <div style={styles.alert} className="error">
          <strong>Error:</strong> {error}
        </div>
      )}

      {success && (
        <div style={styles.alert} className="success">
          <strong>Success:</strong> {success}
        </div>
      )}

      {loading ? (
        <div style={styles.loading}>
          <div style={styles.spinner}></div>
          <p>Loading order system state...</p>
        </div>
      ) : state ? (
        <div style={styles.content}>
          {/* Current State Card */}
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Current State</h2>
            <div style={styles.stateDisplay}>
              <div
                style={{
                  ...styles.stateBadge,
                  backgroundColor: stateDisplay.color,
                }}
              >
                <span style={styles.stateIcon}>{stateDisplay.icon}</span>
                <span style={styles.stateLabel}>{stateDisplay.label}</span>
              </div>
            </div>

            {state.state === 'postponed' && timeRemaining && (
              <div style={styles.timeRemaining}>
                <strong>Time remaining:</strong> {timeRemaining}
                {timeRemaining !== 'Expired' && (
                  <span style={styles.autoResumeNote}>
                    (Will auto-resume to Active when expired)
                  </span>
                )}
              </div>
            )}

            <div style={styles.stateInfo}>
              <div style={styles.infoRow}>
                <strong>Last updated:</strong> {formatDate(state.lastUpdated)}
              </div>
              {state.lastUpdatedBy && (
                <div style={styles.infoRow}>
                  <strong>Updated by:</strong> {state.lastUpdatedBy}
                </div>
              )}
              {state.postponedUntil && (
                <div style={styles.infoRow}>
                  <strong>Postponed until:</strong> {formatDate(state.postponedUntil)}
                </div>
              )}
            </div>
          </div>

          {/* Control Actions Card */}
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Actions</h2>
            <p style={styles.cardDescription}>
              Change the order system state. When shutdown or postponed, new customers will see
              appropriate messages and orders will be blocked.
            </p>

            <div style={styles.actionsGrid}>
              <button
                onClick={() => updateState('active')}
                disabled={updating || state.state === 'active'}
                onMouseEnter={(e) => {
                  if (!updating && state.state !== 'active') {
                    e.target.style.backgroundColor = '#e7f3ff';
                    e.target.style.borderColor = '#007bff';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!updating && state.state !== 'active') {
                    e.target.style.backgroundColor = '#fff';
                    e.target.style.borderColor = '#ddd';
                  }
                }}
                style={{
                  ...styles.actionButton,
                  ...(state.state === 'active' ? styles.actionButtonActive : {}),
                  ...(updating ? styles.actionButtonDisabled : {}),
                }}
              >
                <div style={styles.actionIcon}>✓</div>
                <div style={styles.actionContent}>
                  <div style={styles.actionTitle}>Turn On</div>
                  <div style={styles.actionDescription}>
                    Enable order system - customers can place orders
                  </div>
                </div>
              </button>

              <button
                onClick={() => updateState('postponed')}
                disabled={updating || state.state === 'postponed'}
                onMouseEnter={(e) => {
                  if (!updating && state.state !== 'postponed') {
                    e.target.style.backgroundColor = '#fffbf0';
                    e.target.style.borderColor = '#ffc107';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!updating && state.state !== 'postponed') {
                    e.target.style.backgroundColor = '#fff';
                    e.target.style.borderColor = '#ddd';
                  }
                }}
                style={{
                  ...styles.actionButton,
                  ...(state.state === 'postponed' ? styles.actionButtonActive : {}),
                  ...(updating ? styles.actionButtonDisabled : {}),
                }}
              >
                <div style={styles.actionIcon}>⏸</div>
                <div style={styles.actionContent}>
                  <div style={styles.actionTitle}>Postpone (15 min)</div>
                  <div style={styles.actionDescription}>
                    Temporarily disable orders for 15 minutes
                  </div>
                </div>
              </button>

              <button
                onClick={() => updateState('shutdown')}
                disabled={updating || state.state === 'shutdown'}
                onMouseEnter={(e) => {
                  if (!updating && state.state !== 'shutdown') {
                    e.target.style.backgroundColor = '#ffe7e7';
                    e.target.style.borderColor = '#dc3545';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!updating && state.state !== 'shutdown') {
                    e.target.style.backgroundColor = '#fff';
                    e.target.style.borderColor = '#ddd';
                  }
                }}
                style={{
                  ...styles.actionButton,
                  ...(state.state === 'shutdown' ? styles.actionButtonActive : {}),
                  ...(updating ? styles.actionButtonDisabled : {}),
                }}
              >
                <div style={styles.actionIcon}>✗</div>
                <div style={styles.actionContent}>
                  <div style={styles.actionTitle}>Shut Down</div>
                  <div style={styles.actionDescription}>
                    Disable order system - no new orders accepted
                  </div>
                </div>
              </button>
            </div>

            {updating && (
              <div style={styles.updatingIndicator}>
                <div style={styles.spinnerSmall}></div>
                <span>Updating state...</span>
              </div>
            )}
          </div>

          {/* Information Card */}
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Information</h2>
            <div style={styles.infoList}>
              <div style={styles.infoItem}>
                <strong>Active:</strong> Order system is running normally. Customers can place orders.
              </div>
              <div style={styles.infoItem}>
                <strong>Postponed:</strong> Order system is temporarily disabled for 15 minutes. It will
                automatically resume to Active state after the time expires. Customers see a message
                indicating the system will be back soon.
              </div>
              <div style={styles.infoItem}>
                <strong>Shutdown:</strong> Order system is completely disabled. No new orders are
                accepted. Customers see a message that orders are temporarily unavailable. You must
                manually turn it back on.
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div style={styles.error}>
          <p>Failed to load order system state. Please try refreshing the page.</p>
          <button onClick={fetchState} style={styles.retryButton}>
            Retry
          </button>
        </div>
      )}
    </div>
  );
};

const styles = {
  container: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '20px',
  },
  header: {
    marginBottom: '30px',
  },
  title: {
    fontSize: '2rem',
    fontWeight: '600',
    color: '#333',
    margin: '0 0 8px 0',
  },
  subtitle: {
    fontSize: '1rem',
    color: '#666',
    margin: 0,
  },
  alert: {
    padding: '12px 16px',
    borderRadius: '4px',
    marginBottom: '20px',
    border: '1px solid',
  },
  error: {
    backgroundColor: '#fee',
    color: '#c33',
    borderColor: '#fcc',
  },
  success: {
    backgroundColor: '#efe',
    color: '#3c3',
    borderColor: '#cfc',
  },
  loading: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '60px 20px',
    color: '#666',
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '4px solid #f3f3f3',
    borderTop: '4px solid #007bff',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    marginBottom: '20px',
  },
  spinnerSmall: {
    width: '16px',
    height: '16px',
    border: '2px solid #f3f3f3',
    borderTop: '2px solid #007bff',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    marginRight: '8px',
  },
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: '8px',
    padding: '24px',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
  },
  cardTitle: {
    fontSize: '1.5rem',
    fontWeight: '600',
    color: '#333',
    margin: '0 0 16px 0',
  },
  cardDescription: {
    color: '#666',
    marginBottom: '20px',
    lineHeight: '1.6',
  },
  stateDisplay: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: '20px',
  },
  stateBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 24px',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '1.25rem',
    fontWeight: '600',
  },
  stateIcon: {
    fontSize: '1.5rem',
  },
  stateLabel: {
    fontSize: '1.1rem',
  },
  timeRemaining: {
    textAlign: 'center',
    padding: '12px',
    backgroundColor: '#fff3cd',
    borderRadius: '4px',
    marginBottom: '16px',
    color: '#856404',
  },
  autoResumeNote: {
    display: 'block',
    fontSize: '0.875rem',
    marginTop: '4px',
    opacity: 0.8,
  },
  stateInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    paddingTop: '16px',
    borderTop: '1px solid #eee',
  },
  infoRow: {
    fontSize: '0.9rem',
    color: '#666',
  },
  actionsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '16px',
    marginBottom: '20px',
  },
  actionButton: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '16px',
    padding: '20px',
    border: '2px solid #ddd',
    borderRadius: '8px',
    backgroundColor: '#fff',
    cursor: 'pointer',
    transition: 'all 0.2s',
    textAlign: 'left',
  },
  actionButtonActive: {
    borderColor: '#007bff',
    backgroundColor: '#e7f3ff',
    cursor: 'default',
  },
  actionButtonDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed',
  },
  actionIcon: {
    fontSize: '2rem',
    lineHeight: '1',
  },
  actionContent: {
    flex: 1,
  },
  actionTitle: {
    fontSize: '1.1rem',
    fontWeight: '600',
    color: '#333',
    marginBottom: '4px',
  },
  actionDescription: {
    fontSize: '0.875rem',
    color: '#666',
    lineHeight: '1.5',
  },
  updatingIndicator: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '12px',
    color: '#666',
    fontSize: '0.9rem',
  },
  infoList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  infoItem: {
    padding: '12px',
    backgroundColor: '#f8f9fa',
    borderRadius: '4px',
    fontSize: '0.9rem',
    color: '#555',
    lineHeight: '1.6',
  },
  retryButton: {
    padding: '10px 20px',
    backgroundColor: '#007bff',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '1rem',
    marginTop: '12px',
  },
};

// Add CSS animation for spinner
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
}

export default OrderSystemControl;

