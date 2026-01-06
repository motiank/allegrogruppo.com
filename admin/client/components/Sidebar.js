import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import axios from 'axios';

const Sidebar = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme } = useTheme();
  const [isMobile, setIsMobile] = useState(false);

  // Detect mobile screen size
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  const menuItems = [
    { path: '/dashboard', label: 'Dashboard' },
    { path: '/orders', label: 'Orders History' },
    { 
      path: '/analytics', 
      label: 'Analytics',
      subItems: [
        { path: '/analytics?reset=true', label: 'Chart Reset', isAction: true },
        { path: '/analytics?update=true', label: 'Update Data', isAction: true, actionType: 'update' }
      ]
    },
    { path: '/performance', label: 'Performance' },
  ];

  const handleNavigation = (path) => {
    navigate(path);
    onClose();
  };

  const handleLogout = async () => {
    try {
      await axios.get('/auth/logout', {
        withCredentials: true,
      });
      // Navigate to login screen after successful logout
      navigate('/login', { replace: true });
      onClose();
    } catch (error) {
      console.error('Logout error:', error);
      // Even if logout fails, redirect to login
      navigate('/login', { replace: true });
      onClose();
    }
  };

  const styles = {
    overlay: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: theme.mode === 'dark' ? 'rgba(0, 0, 0, 0.7)' : 'rgba(0, 0, 0, 0.5)',
      zIndex: 999,
      transition: 'opacity 0.3s ease',
    },
    sidebar: {
      position: 'fixed',
      top: '60px',
      left: 0,
      width: '250px',
      height: 'calc(100vh - 60px)',
      backgroundColor: theme.surface,
      boxShadow: `2px 0 8px ${theme.shadow}`,
      zIndex: 1000,
      transition: 'transform 0.3s ease, background-color 0.3s ease',
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column',
    },
    sidebarHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '20px',
      borderBottom: `1px solid ${theme.border}`,
    },
    sidebarTitle: {
      margin: 0,
      fontSize: '1.25rem',
      fontWeight: '600',
      color: theme.text,
    },
    closeButton: {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      padding: '4px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: theme.textSecondary,
      borderRadius: '4px',
      transition: 'background-color 0.2s',
    },
    nav: {
      padding: '10px 0',
      flex: 1,
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
      color: theme.text,
      cursor: 'pointer',
      transition: 'background-color 0.2s, color 0.2s',
    },
    subMenuButton: {
      width: '100%',
      padding: '10px 20px 10px 40px',
      background: 'none',
      border: 'none',
      textAlign: 'left',
      fontSize: '0.9rem',
      color: theme.textSecondary,
      cursor: 'pointer',
      transition: 'background-color 0.2s, color 0.2s',
    },
    menuButtonActive: {
      backgroundColor: theme.active,
      color: '#ffffff',
    },
    logoutButton: {
      width: '100%',
      padding: '12px 20px',
      background: 'none',
      border: 'none',
      textAlign: 'left',
      fontSize: '1rem',
      color: theme.text,
      cursor: 'pointer',
      transition: 'background-color 0.2s, color 0.2s',
      borderTop: `1px solid ${theme.border}`,
      marginTop: '10px',
    },
    logoutSection: {
      marginTop: 'auto',
      paddingTop: '10px',
    },
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
          top: isMobile ? 0 : '60px',
          height: isMobile ? '100vh' : 'calc(100vh - 60px)',
          transform: isOpen ? 'translateX(0)' : 'translateX(-100%)',
        }}
      >
        <div style={styles.sidebarHeader}>
          <h2 style={styles.sidebarTitle}>Menu</h2>
          <button
            onClick={onClose}
            onMouseEnter={(e) => {
              e.target.style.backgroundColor = theme.hover;
            }}
            onMouseLeave={(e) => {
              e.target.style.backgroundColor = 'transparent';
            }}
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
              const isActive = location.pathname === item.path || location.pathname.startsWith(item.path + '/');
              return (
                <React.Fragment key={item.path}>
                  <li style={styles.menuItem}>
                    <button
                      onClick={() => handleNavigation(item.path)}
                      onMouseEnter={(e) => {
                        if (!isActive) {
                          e.target.style.backgroundColor = theme.hover;
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
                  {item.subItems && isActive && item.subItems.map((subItem) => (
                    <li key={subItem.path} style={styles.menuItem}>
                      <button
                        onClick={async () => {
                          if (subItem.isAction) {
                            if (subItem.actionType === 'update') {
                              // Handle update data action
                              try {
                                const response = await axios.post('/admin/analytics/update-data', {}, {
                                  withCredentials: true,
                                });
                                if (response.data.success) {
                                  alert('Data update process started successfully');
                                } else {
                                  alert(`Update failed: ${response.data.message || 'Unknown error'}`);
                                }
                              } catch (error) {
                                console.error('Update data error:', error);
                                alert(`Error starting update: ${error.response?.data?.message || error.message}`);
                              }
                            } else {
                              // Handle reset action
                              const event = new CustomEvent('analyticsReset');
                              window.dispatchEvent(event);
                              handleNavigation('/analytics');
                            }
                          } else {
                            handleNavigation(subItem.path);
                          }
                        }}
                        onMouseEnter={(e) => {
                          e.target.style.backgroundColor = theme.hover;
                          e.target.style.color = theme.text;
                        }}
                        onMouseLeave={(e) => {
                          e.target.style.backgroundColor = 'transparent';
                          e.target.style.color = theme.textSecondary;
                        }}
                        style={styles.subMenuButton}
                      >
                        {subItem.label}
                      </button>
                    </li>
                  ))}
                </React.Fragment>
              );
            })}
          </ul>
        </nav>

        {/* Logout Section */}
        <div style={styles.logoutSection}>
          <button
            onClick={handleLogout}
            onMouseEnter={(e) => {
              e.target.style.backgroundColor = theme.hover;
            }}
            onMouseLeave={(e) => {
              e.target.style.backgroundColor = 'transparent';
            }}
            style={styles.logoutButton}
          >
            Logout
          </button>
        </div>
      </div>
    </>
  );
};

export default Sidebar;

