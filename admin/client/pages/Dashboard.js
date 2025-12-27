import React from 'react';
import OrderSystemWidget from '../components/OrderSystemWidget';

const Dashboard = () => {
  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Dashboard</h1>
      <div style={styles.content}>
        <div style={styles.grid}>
          <div style={styles.widgetColumn}>
            <OrderSystemWidget />
          </div>
          <div style={styles.infoColumn}>
            <div style={styles.infoCard}>
              <h2 style={styles.infoTitle}>Welcome</h2>
              <p>Welcome to the Admin Dashboard. Here you can manage your order system and view system overview.</p>
              <p>Use the Order System Control widget to manage the order system state, or navigate to the full control panel for more options.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const styles = {
  container: {
    maxWidth: '1200px',
    margin: '0 auto',
  },
  title: {
    fontSize: '2rem',
    fontWeight: '600',
    color: '#333',
    marginBottom: '20px',
  },
  content: {
    padding: '0',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
    gap: '20px',
  },
  widgetColumn: {
    minWidth: 0,
  },
  infoColumn: {
    minWidth: 0,
  },
  infoCard: {
    backgroundColor: '#ffffff',
    padding: '30px',
    borderRadius: '8px',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
  },
  infoTitle: {
    fontSize: '1.5rem',
    fontWeight: '600',
    color: '#333',
    marginTop: 0,
    marginBottom: '16px',
  },
};

export default Dashboard;

