import React, { useState, useEffect } from 'react';
import axios from 'axios';

const OrderSystemWidget = () => {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState(null);

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

    try {
      const response = await axios.post(
        '/admin/order-system/state',
        { state: newState },
        { withCredentials: true }
      );

      if (response.data.success !== false) {
        setState(response.data.state || response.data);
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
        return { label: 'Active', color: '#28a745', bgColor: '#d4edda', borderColor: '#c3e6cb' };
      case 'shutdown':
        return { label: 'Shutdown', color: '#dc3545', bgColor: '#f8d7da', borderColor: '#f5c6cb' };
      case 'postponed':
        return { label: 'Postponed', color: '#856404', bgColor: '#fff3cd', borderColor: '#ffeaa7' };
      default:
        return { label: 'Unknown', color: '#6c757d', bgColor: '#e9ecef', borderColor: '#dee2e6' };
    }
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

  if (loading) {
    return (
      <div style={styles.widget}>
        <div style={styles.header}>
          <h2 style={styles.title}>Order System</h2>
        </div>
        <div style={styles.loading}>Loading...</div>
      </div>
    );
  }

  if (error && !state) {
    return (
      <div style={styles.widget}>
        <div style={styles.header}>
          <h2 style={styles.title}>Order System</h2>
        </div>
        <div style={styles.error}>Error: {error}</div>
      </div>
    );
  }

  const stateDisplay = state ? getStateDisplay(state.state) : null;
  const timeRemaining = state?.postponedUntil ? getTimeRemaining(state.postponedUntil) : null;

  return (
    <div style={styles.widget}>
      <div style={styles.header}>
        <h2 style={styles.title}>Order System Control</h2>
      </div>

      {error && (
        <div style={styles.alertError}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {state && (
        <>
          <div style={styles.stateSection}>
            <div
              style={{
                ...styles.stateBadge,
                backgroundColor: stateDisplay.bgColor,
                borderColor: stateDisplay.borderColor,
                color: stateDisplay.color,
              }}
            >
              <span style={styles.stateLabel}>{stateDisplay.label}</span>
            </div>
            {timeRemaining && (
              <div style={styles.timeRemaining}>
                Resumes in: <strong>{timeRemaining}</strong>
              </div>
            )}
          </div>

          <div style={styles.actionsSection}>
            <button
              onClick={() => updateState('active')}
              disabled={updating || state.state === 'active'}
              onMouseEnter={(e) => {
                if (!updating && state.state !== 'active') {
                  e.target.style.backgroundColor = '#28a745';
                  e.target.style.color = '#fff';
                }
              }}
              onMouseLeave={(e) => {
                if (!updating && state.state !== 'active') {
                  e.target.style.backgroundColor = '#fff';
                  e.target.style.color = '#28a745';
                }
              }}
              style={{
                ...styles.actionButton,
                ...styles.buttonActive,
                ...(state.state === 'active' ? styles.buttonCurrent : {}),
                ...(updating ? styles.buttonDisabled : {}),
              }}
            >
              ✓ Turn On
            </button>
            <button
              onClick={() => updateState('postponed')}
              disabled={updating || state.state === 'postponed'}
              onMouseEnter={(e) => {
                if (!updating && state.state !== 'postponed') {
                  e.target.style.backgroundColor = '#ffc107';
                  e.target.style.color = '#000';
                }
              }}
              onMouseLeave={(e) => {
                if (!updating && state.state !== 'postponed') {
                  e.target.style.backgroundColor = '#fff';
                  e.target.style.color = '#856404';
                }
              }}
              style={{
                ...styles.actionButton,
                ...styles.buttonPostpone,
                ...(state.state === 'postponed' ? styles.buttonCurrent : {}),
                ...(updating ? styles.buttonDisabled : {}),
              }}
            >
              ⏸ Postpone
            </button>
            <button
              onClick={() => updateState('shutdown')}
              disabled={updating || state.state === 'shutdown'}
              onMouseEnter={(e) => {
                if (!updating && state.state !== 'shutdown') {
                  e.target.style.backgroundColor = '#dc3545';
                  e.target.style.color = '#fff';
                }
              }}
              onMouseLeave={(e) => {
                if (!updating && state.state !== 'shutdown') {
                  e.target.style.backgroundColor = '#fff';
                  e.target.style.color = '#dc3545';
                }
              }}
              style={{
                ...styles.actionButton,
                ...styles.buttonShutdown,
                ...(state.state === 'shutdown' ? styles.buttonCurrent : {}),
                ...(updating ? styles.buttonDisabled : {}),
              }}
            >
              ✗ Shut Down
            </button>
          </div>
        </>
      )}
    </div>
  );
};

const styles = {
  widget: {
    backgroundColor: '#ffffff',
    borderRadius: '8px',
    padding: '20px',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
    marginBottom: '20px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
    paddingBottom: '12px',
    borderBottom: '1px solid #e0e0e0',
  },
  title: {
    fontSize: '1.25rem',
    fontWeight: '600',
    color: '#333',
    margin: 0,
  },
  loading: {
    textAlign: 'center',
    padding: '20px',
    color: '#666',
  },
  error: {
    textAlign: 'center',
    padding: '20px',
    color: '#dc3545',
  },
  alertError: {
    backgroundColor: '#fee',
    color: '#c33',
    padding: '8px 12px',
    borderRadius: '4px',
    marginBottom: '12px',
    fontSize: '0.875rem',
    border: '1px solid #fcc',
  },
  stateSection: {
    marginBottom: '16px',
  },
  stateBadge: {
    display: 'inline-block',
    padding: '8px 16px',
    borderRadius: '6px',
    border: '2px solid',
    fontWeight: '600',
    fontSize: '1rem',
    marginBottom: '8px',
  },
  stateLabel: {
    fontSize: '1rem',
  },
  timeRemaining: {
    fontSize: '0.875rem',
    color: '#666',
    marginTop: '8px',
  },
  actionsSection: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
  },
  actionButton: {
    flex: '1',
    minWidth: '100px',
    padding: '10px 16px',
    border: '2px solid',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.9rem',
    fontWeight: '500',
    transition: 'all 0.2s',
    whiteSpace: 'nowrap',
  },
  buttonActive: {
    borderColor: '#28a745',
    backgroundColor: '#fff',
    color: '#28a745',
  },
  buttonPostpone: {
    borderColor: '#ffc107',
    backgroundColor: '#fff',
    color: '#856404',
  },
  buttonShutdown: {
    borderColor: '#dc3545',
    backgroundColor: '#fff',
    color: '#dc3545',
  },
  buttonCurrent: {
    backgroundColor: '#f8f9fa',
    cursor: 'default',
    opacity: 0.7,
  },
  buttonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
};

export default OrderSystemWidget;

