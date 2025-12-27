import React from 'react';
import { useTheme } from '../context/ThemeContext';

const Analytics = () => {
  const { theme } = useTheme();

  const styles = {
    container: {
      maxWidth: '1200px',
      margin: '0 auto',
    },
    title: {
      fontSize: '2rem',
      fontWeight: '600',
      color: theme.text,
      marginBottom: '20px',
    },
    content: {
      backgroundColor: theme.surface,
      padding: '30px',
      borderRadius: '8px',
      boxShadow: `0 2px 4px ${theme.shadow}`,
      border: `1px solid ${theme.border}`,
      color: theme.text,
    },
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Analytics</h1>
      <div style={styles.content}>
        <p>Welcome to the Analytics page.</p>
        <p>This is where you can view analytics and reports.</p>
      </div>
    </div>
  );
};

export default Analytics;

