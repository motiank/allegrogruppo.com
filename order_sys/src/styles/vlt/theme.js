export const theme = {
  colors: {
    // Primary blue - Wolt's signature blue for buttons and accents
    primary: '#0070F3',
    // Secondary blue - slightly lighter for hover states
    secondary: '#3291FF',
    // Success green
    success: '#00D9A5',
    // Error red
    error: '#FF3B3B',
    // Warning orange/yellow
    warning: '#FFA500',
    // Dark background - Wolt's dark theme
    background: '#000000',
    // Surface/card background - slightly lighter than main background
    surface: '#1A1A1A',
    // Card surface - for elevated elements
    card: '#242424',
    // Primary text - white for dark theme
    text: '#FFFFFF',
    // Secondary text - light gray
    textSecondary: '#B3B3B3',
    // Tertiary text - darker gray
    textTertiary: '#808080',
    // Border color - subtle gray
    border: '#333333',
    // Disabled state
    disabled: '#4A4A4A',
    // Price color - orange/yellow as seen in Wolt
    price: '#FFA500',
    // Accent blue for highlights
    accent: '#0070F3',
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
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '20px',
    full: '9999px',
  },
  breakpoints: {
    sm: '576px',
    md: '768px',
    lg: '992px',
    xl: '1200px',
  },
  // Fonts configuration - Wolt uses modern sans-serif
  fonts: {
    primary: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    secondary: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif',
    monospace: 'Monaco, "Courier New", monospace',
  },
  // Box styles - Wolt's modern shadows and borders
  boxStyles: {
    shadow: {
      sm: '0 1px 3px rgba(0, 0, 0, 0.3)',
      md: '0 4px 12px rgba(0, 0, 0, 0.4)',
      lg: '0 8px 24px rgba(0, 0, 0, 0.5)',
      xl: '0 12px 32px rgba(0, 0, 0, 0.6)',
      // Glow effect for primary buttons
      glow: '0 0 20px rgba(0, 112, 243, 0.4)',
    },
    border: {
      default: '1px solid',
      thick: '2px solid',
      dashed: '1px dashed',
    },
  },
};

