import React, { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext();

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

const lightTheme = {
  mode: 'light',
  background: '#f5f5f5',
  surface: '#ffffff',
  surfaceSecondary: '#f8f9fa',
  text: '#333',
  textSecondary: '#666',
  textTertiary: '#999',
  border: '#e0e0e0',
  borderLight: '#eee',
  shadow: 'rgba(0, 0, 0, 0.1)',
  shadowHover: 'rgba(0, 0, 0, 0.15)',
  primary: '#007bff',
  primaryHover: '#0056b3',
  success: '#28a745',
  successBg: '#d4edda',
  successBorder: '#c3e6cb',
  warning: '#ffc107',
  warningBg: '#fff3cd',
  warningBorder: '#ffeaa7',
  warningText: '#856404',
  error: '#dc3545',
  errorBg: '#f8d7da',
  errorBorder: '#f5c6cb',
  info: '#0066cc',
  hover: '#f0f0f0',
  active: '#007bff',
  activeBg: '#e6f2ff',
  disabled: '#ccc',
};

const darkTheme = {
  mode: 'dark',
  background: '#121212',
  surface: '#1e1e1e',
  surfaceSecondary: '#2a2a2a',
  text: '#e0e0e0',
  textSecondary: '#b0b0b0',
  textTertiary: '#888',
  border: '#333',
  borderLight: '#2a2a2a',
  shadow: 'rgba(0, 0, 0, 0.3)',
  shadowHover: 'rgba(0, 0, 0, 0.5)',
  primary: '#4a9eff',
  primaryHover: '#6bb0ff',
  success: '#4caf50',
  successBg: '#1b5e20',
  successBorder: '#2e7d32',
  warning: '#ff9800',
  warningBg: '#e65100',
  warningBorder: '#ff6f00',
  warningText: '#fff3e0',
  error: '#f44336',
  errorBg: '#b71c1c',
  errorBorder: '#c62828',
  info: '#42a5f5',
  hover: '#2a2a2a',
  active: '#4a9eff',
  activeBg: '#1a237e',
  disabled: '#555',
};

export const ThemeProvider = ({ children }) => {
  const [isDark, setIsDark] = useState(() => {
    // Check localStorage first
    const saved = localStorage.getItem('adminTheme');
    if (saved) {
      return saved === 'dark';
    }
    // Check system preference
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    localStorage.setItem('adminTheme', isDark ? 'dark' : 'light');
  }, [isDark]);

  const toggleTheme = () => {
    setIsDark(!isDark);
  };

  const theme = isDark ? darkTheme : lightTheme;

  return (
    <ThemeContext.Provider value={{ theme, isDark, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

