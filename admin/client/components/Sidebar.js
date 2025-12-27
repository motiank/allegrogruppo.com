import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

const Sidebar = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const location = useLocation();

  const menuItems = [
    { path: '/dashboard', label: 'Dashboard' },
    { path: '/orders', label: 'Live Orders' },
    { path: '/analytics', label: 'Analytics' },
    { path: '/order-system', label: 'Order System Control' },
  ];

  const handleNavigation = (path) => {
    navigate(path);
    onClose();
  };

  return (
    <>
      {/* Overlay */}
      {isOpen && (
        <div
          style={styles.overlay}
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <div
        style={{
          ...styles.sidebar,
          transform: isOpen ? 'translateX(0)' : 'translateX(-100%)',
        }}
      >
        <div style={styles.sidebarHeader}>
          <h2 style={styles.sidebarTitle}>Menu</h2>
          <button
            onClick={onClose}
            style={styles.closeButton}
            aria-label="Close menu"
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
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <nav style={styles.nav}>
          <ul style={styles.menuList}>
            {menuItems.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <li key={item.path} style={styles.menuItem}>
                  <button
                    onClick={() => handleNavigation(item.path)}
                    onMouseEnter={(e) => {
                      if (!isActive) {
                        e.target.style.backgroundColor = '#f0f0f0';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) {
                        e.target.style.backgroundColor = 'transparent';
                      }
                    }}
                    style={{
                      ...styles.menuButton,
                      ...(isActive ? styles.menuButtonActive : {}),
                    }}
                  >
                    {item.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </>
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 999,
    transition: 'opacity 0.3s ease',
  },
  sidebar: {
    position: 'fixed',
    top: '60px',
    left: 0,
    width: '250px',
    height: 'calc(100vh - 60px)',
    backgroundColor: '#ffffff',
    boxShadow: '2px 0 8px rgba(0, 0, 0, 0.1)',
    zIndex: 1000,
    transition: 'transform 0.3s ease',
    overflowY: 'auto',
  },
  sidebarHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px',
    borderBottom: '1px solid #e0e0e0',
  },
  sidebarTitle: {
    margin: 0,
    fontSize: '1.25rem',
    fontWeight: '600',
    color: '#333',
  },
  closeButton: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#666',
    borderRadius: '4px',
    transition: 'background-color 0.2s',
  },
  nav: {
    padding: '10px 0',
  },
  menuList: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
  },
  menuItem: {
    margin: 0,
  },
  menuButton: {
    width: '100%',
    padding: '12px 20px',
    background: 'none',
    border: 'none',
    textAlign: 'left',
    fontSize: '1rem',
    color: '#333',
    cursor: 'pointer',
    transition: 'background-color 0.2s, color 0.2s',
  },
  menuButtonActive: {
    backgroundColor: '#007bff',
    color: '#ffffff',
  },
  menuButtonHover: {
    backgroundColor: '#f0f0f0',
  },
};

export default Sidebar;

