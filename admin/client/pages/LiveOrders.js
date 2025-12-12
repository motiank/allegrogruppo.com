import React from 'react';

const LiveOrders = () => {
  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Live Orders</h1>
      <div style={styles.content}>
        <p>Welcome to the Live Orders page.</p>
        <p>This is where you can view and manage live orders in real-time.</p>
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
    backgroundColor: '#ffffff',
    padding: '30px',
    borderRadius: '8px',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
  },
};

export default LiveOrders;

