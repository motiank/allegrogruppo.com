export const theme = {
  colors: {
    primary: '#2c3e50',
    secondary: '#3498db',
    success: '#27ae60',
    error: '#e74c3c',
    warning: '#f39c12',
    background: '#ffffff',
    surface: '#f8f9fa',
    text: '#2c3e50',
    textSecondary: '#7f8c8d',
    border: '#e0e0e0',
    disabled: '#bdc3c7',
  },
  spacing: {
    xs: '4px',
    sm: '8px',
    md: '16px',
    lg: '24px',
    xl: '32px',
    xxl: '48px',
  },
  borderRadius: {
    sm: '4px',
    md: '8px',
    lg: '12px',
  },
  breakpoints: {
    sm: '576px',
    md: '768px',
    lg: '992px',
    xl: '1200px',
  },
  // Fonts configuration - extensible for future additions
  fonts: {
    primary: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    secondary: null, // Can be added per style
    monospace: 'Monaco, "Courier New", monospace',
  },
  // Box styles - extensible for future additions
  boxStyles: {
    shadow: {
      sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
      md: '0 4px 6px rgba(0, 0, 0, 0.1)',
      lg: '0 10px 15px rgba(0, 0, 0, 0.1)',
      xl: '0 20px 25px rgba(0, 0, 0, 0.1)',
    },
    border: {
      default: '1px solid',
      thick: '2px solid',
      dashed: '1px dashed',
    },
  },
};

