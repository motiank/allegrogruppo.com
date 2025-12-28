import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import { useTheme } from '../context/ThemeContext';
import OrderSystemDropdown from './OrderSystemDropdown';

const Layout = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();

  const menuItems = [
    { path: '/dashboard', label: 'Dashboard' },
    { path: '/orders', label: 'Orders History' },
    { path: '/analytics', label: 'Analytics' },
  ];

  const getCurrentPageTitle = () => {
    const currentItem = menuItems.find(item => item.path === location.pathname);
    return currentItem ? currentItem.label : 'Admin Panel';
  };

  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
  };

  const styles = {
    container: {
      display: 'flex',
      flexDirection: 'column',
      minHeight: '100vh',
      backgroundColor: theme.background,
      color: theme.text,
      transition: 'background-color 0.3s ease, color 0.3s ease',
    },
    topBar: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      height: '60px',
      backgroundColor: theme.surface,
      borderBottom: `1px solid ${theme.border}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 20px',
      zIndex: 1000,
      boxShadow: `0 2px 4px ${theme.shadow}`,
      transition: 'background-color 0.3s ease, border-color 0.3s ease',
    },
    topBarRight: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
    },
    topBarLeft: {
      display: 'flex',
      alignItems: 'center',
    },
    hamburgerButton: {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      padding: '8px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: theme.text,
      borderRadius: '4px',
      transition: 'background-color 0.2s',
    },
    title: {
      margin: 0,
      marginLeft: '16px',
      fontSize: '1.25rem',
      fontWeight: '600',
      color: theme.text,
    },
    themeToggle: {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      padding: '8px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: theme.text,
      borderRadius: '4px',
      transition: 'background-color 0.2s',
    },
    mainContent: {
      marginTop: '60px',
      padding: '20px',
      flex: 1,
      backgroundColor: theme.background,
      transition: 'background-color 0.3s ease',
    },
  };

  return (
    <div style={styles.container}>
      {/* Top Bar */}
      <div style={styles.topBar}>
        <div style={styles.topBarLeft}>
          <button
            onClick={toggleSidebar}
            onMouseEnter={(e) => {
              e.target.style.backgroundColor = theme.hover;
            }}
            onMouseLeave={(e) => {
              e.target.style.backgroundColor = 'transparent';
            }}
            style={styles.hamburgerButton}
            aria-label="Toggle menu"
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="3" y1="12" x2="21" y2="12"></line>
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
          </button>
          <h1 style={styles.title}>{getCurrentPageTitle()}</h1>
        </div>
        <div style={styles.topBarRight}>
          <OrderSystemDropdown />
          <button
            onClick={toggleTheme}
          onMouseEnter={(e) => {
            e.target.style.backgroundColor = theme.hover;
          }}
          onMouseLeave={(e) => {
            e.target.style.backgroundColor = 'transparent';
          }}
          style={styles.themeToggle}
          aria-label="Toggle dark mode"
          title={theme.mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme.mode === 'dark' ? (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5"></circle>
              <line x1="12" y1="1" x2="12" y2="3"></line>
              <line x1="12" y1="21" x2="12" y2="23"></line>
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
              <line x1="1" y1="12" x2="3" y2="12"></line>
              <line x1="21" y1="12" x2="23" y2="12"></line>
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
            </svg>
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
            </svg>
          )}
          </button>
        </div>
      </div>

      {/* Sidebar */}
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Main Content */}
      <div style={styles.mainContent}>
        {children}
      </div>
    </div>
  );
};

export default Layout;

