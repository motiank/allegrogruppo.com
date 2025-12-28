import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useTheme } from '../context/ThemeContext';

const OrderSystemDropdown = () => {
  const { theme } = useTheme();
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState(null);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Fetch current state on mount
  useEffect(() => {
    fetchState();
    // Poll for state changes every 5 seconds
    const interval = setInterval(fetchState, 5000);
    return () => clearInterval(interval);
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

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
        setIsOpen(false);
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
        return { label: 'Active', color: theme.success, bgColor: theme.successBg, borderColor: theme.successBorder };
      case 'shutdown':
        return { label: 'Shutdown', color: theme.error, bgColor: theme.errorBg, borderColor: theme.errorBorder };
      case 'suspend':
        return { label: 'Suspend', color: theme.warningText, bgColor: theme.warningBg, borderColor: theme.warningBorder };
      default:
        return { label: 'Unknown', color: theme.textSecondary, bgColor: theme.surfaceSecondary, borderColor: theme.border };
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

  const statuses = [
    { value: 'active', label: 'Active', color: theme.success },
    { value: 'suspend', label: 'Suspend', color: theme.warning },
    { value: 'shutdown', label: 'Shutdown', color: theme.error },
  ];

  const currentState = state?.state || 'unknown';
  const stateDisplay = getStateDisplay(currentState);
  const timeRemaining = state?.suspendedUntil ? getTimeRemaining(state.suspendedUntil) : null;

  const styles = {
    container: {
      position: 'relative',
      display: 'inline-block',
    },
    button: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '8px 12px',
      backgroundColor: 'transparent',
      border: `1px solid ${theme.border}`,
      borderRadius: '4px',
      cursor: 'pointer',
      color: theme.text,
      fontSize: '0.875rem',
      fontWeight: '500',
      transition: 'background-color 0.2s, border-color 0.2s',
      whiteSpace: 'nowrap',
    },
    statusBadge: {
      display: 'inline-flex',
      alignItems: 'center',
      padding: '4px 8px',
      borderRadius: '4px',
      border: `2px solid ${stateDisplay.borderColor}`,
      backgroundColor: stateDisplay.bgColor,
      color: stateDisplay.color,
      fontSize: '0.75rem',
      fontWeight: '600',
      minWidth: '70px',
      justifyContent: 'center',
    },
    dropdownIcon: {
      fontSize: '0.75rem',
      transition: 'transform 0.2s',
      transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
    },
    dropdownMenu: {
      position: 'absolute',
      top: '100%',
      right: 0,
      marginTop: '4px',
      backgroundColor: theme.surface,
      border: `1px solid ${theme.border}`,
      borderRadius: '6px',
      boxShadow: `0 4px 12px ${theme.shadow}`,
      minWidth: '200px',
      zIndex: 1001,
      overflow: 'hidden',
    },
    dropdownHeader: {
      padding: '12px 16px',
      borderBottom: `1px solid ${theme.border}`,
      backgroundColor: theme.surfaceSecondary,
    },
    dropdownTitle: {
      fontSize: '0.875rem',
      fontWeight: '600',
      color: theme.text,
      margin: 0,
    },
    timeRemainingText: {
      fontSize: '0.75rem',
      color: theme.textSecondary,
      marginTop: '4px',
    },
    dropdownItem: {
      display: 'flex',
      alignItems: 'center',
      padding: '12px 16px',
      cursor: updating ? 'not-allowed' : 'pointer',
      transition: 'background-color 0.2s',
      border: 'none',
      backgroundColor: 'transparent',
      width: '100%',
      textAlign: 'left',
      color: theme.text,
      fontSize: '0.875rem',
    },
    dropdownItemActive: {
      backgroundColor: theme.activeBg,
    },
    dropdownItemCurrent: {
      backgroundColor: theme.surfaceSecondary,
      opacity: 0.7,
      cursor: 'default',
    },
    statusLabel: {
      flex: 1,
      fontWeight: '500',
    },
    statusIndicator: {
      width: '12px',
      height: '12px',
      borderRadius: '50%',
      marginRight: '8px',
    },
    errorMessage: {
      padding: '8px 16px',
      fontSize: '0.75rem',
      color: theme.error,
      backgroundColor: theme.errorBg,
      borderTop: `1px solid ${theme.errorBorder}`,
    },
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <button style={styles.button} disabled>
          <span>Order System</span>
          <span>Loading...</span>
        </button>
      </div>
    );
  }

  return (
    <div style={styles.container} ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={styles.button}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = theme.hover;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent';
        }}
      >
        <span>Order System</span>
        <span style={styles.statusBadge}>{stateDisplay.label}</span>
        <span style={styles.dropdownIcon}>▼</span>
      </button>

      {isOpen && (
        <div style={styles.dropdownMenu}>
          <div style={styles.dropdownHeader}>
            <div style={styles.dropdownTitle}>Order System Status</div>
            {timeRemaining && (
              <div style={styles.timeRemainingText}>
                Resumes in: <strong>{timeRemaining}</strong>
              </div>
            )}
          </div>
          {statuses.map((status) => {
            const isCurrent = currentState === status.value;
            return (
              <button
                key={status.value}
                onClick={() => !isCurrent && !updating && updateState(status.value)}
                disabled={updating || isCurrent}
                style={{
                  ...styles.dropdownItem,
                  ...(isCurrent ? styles.dropdownItemCurrent : {}),
                }}
                onMouseEnter={(e) => {
                  if (!isCurrent && !updating) {
                    e.currentTarget.style.backgroundColor = theme.hover;
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isCurrent && !updating) {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }
                }}
              >
                <div
                  style={{
                    ...styles.statusIndicator,
                    backgroundColor: status.color,
                  }}
                />
                <span style={styles.statusLabel}>{status.label}</span>
                {isCurrent && <span>✓</span>}
              </button>
            );
          })}
          {error && (
            <div style={styles.errorMessage}>
              <strong>Error:</strong> {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default OrderSystemDropdown;

