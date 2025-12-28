import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useTheme } from '../context/ThemeContext';

const OrderSystemWidget = () => {
  const { theme } = useTheme();
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
      case 'suspend':
        return { label: 'Suspend', color: '#856404', bgColor: '#fff3cd', borderColor: '#ffeaa7' };
      default:
        return { label: 'Unknown', color: '#6c757d', bgColor: '#e9ecef', borderColor: '#dee2e6' };
    }
  };

  const getTimeRemaining = (suspendedUntil) => {
    if (!suspendedUntil) return null;
    const now = new Date();
    const until = new Date(suspendedUntil);
    const diff = until - now;
    
    if (diff <= 0) return 'Expired';
    
    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  };

  const getStyles = () => ({
    widget: {
      backgroundColor: theme.surface,
      borderRadius: '8px',
      padding: '20px',
      boxShadow: `0 2px 4px ${theme.shadow}`,
      marginBottom: '20px',
      border: `1px solid ${theme.border}`,
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '16px',
      paddingBottom: '12px',
      borderBottom: `1px solid ${theme.border}`,
    },
    title: {
      fontSize: '1.25rem',
      fontWeight: '600',
      color: theme.text,
      margin: 0,
    },
    loading: {
      textAlign: 'center',
      padding: '20px',
      color: theme.textSecondary,
    },
    error: {
      textAlign: 'center',
      padding: '20px',
      color: theme.error,
    },
    alertError: {
      backgroundColor: theme.errorBg,
      color: theme.error,
      padding: '8px 12px',
      borderRadius: '4px',
      marginBottom: '12px',
      fontSize: '0.875rem',
      border: `1px solid ${theme.errorBorder}`,
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
      color: theme.textSecondary,
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
      borderColor: theme.success,
      backgroundColor: theme.surface,
      color: theme.success,
    },
    buttonPostpone: {
      borderColor: theme.warning,
      backgroundColor: theme.surface,
      color: theme.warningText,
    },
    buttonShutdown: {
      borderColor: theme.error,
      backgroundColor: theme.surface,
      color: theme.error,
    },
    buttonCurrent: {
      backgroundColor: theme.surfaceSecondary,
      cursor: 'default',
      opacity: 0.7,
    },
    buttonDisabled: {
      opacity: 0.5,
      cursor: 'not-allowed',
    },
  });

  const styles = getStyles();

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
  const timeRemaining = state?.suspendedUntil ? getTimeRemaining(state.suspendedUntil) : null;

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
                  e.target.style.backgroundColor = theme.success;
                  e.target.style.color = '#fff';
                }
              }}
              onMouseLeave={(e) => {
                if (!updating && state.state !== 'active') {
                  e.target.style.backgroundColor = theme.surface;
                  e.target.style.color = theme.success;
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
              onClick={() => updateState('suspend')}
              disabled={updating || state.state === 'suspend'}
              onMouseEnter={(e) => {
                if (!updating && state.state !== 'suspend') {
                  e.target.style.backgroundColor = theme.warning;
                  e.target.style.color = theme.mode === 'dark' ? '#fff' : '#000';
                }
              }}
              onMouseLeave={(e) => {
                if (!updating && state.state !== 'suspend') {
                  e.target.style.backgroundColor = theme.surface;
                  e.target.style.color = theme.warningText;
                }
              }}
              style={{
                ...styles.actionButton,
                ...styles.buttonPostpone,
                ...(state.state === 'suspend' ? styles.buttonCurrent : {}),
                ...(updating ? styles.buttonDisabled : {}),
              }}
            >
              ⏸ Suspend
            </button>
            <button
              onClick={() => updateState('shutdown')}
              disabled={updating || state.state === 'shutdown'}
              onMouseEnter={(e) => {
                if (!updating && state.state !== 'shutdown') {
                  e.target.style.backgroundColor = theme.error;
                  e.target.style.color = '#fff';
                }
              }}
              onMouseLeave={(e) => {
                if (!updating && state.state !== 'shutdown') {
                  e.target.style.backgroundColor = theme.surface;
                  e.target.style.color = theme.error;
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

export default OrderSystemWidget;

