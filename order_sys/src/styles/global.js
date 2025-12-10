import { createUseStyles } from 'react-jss';

export const useGlobalStyles = createUseStyles({
  '@global': {
    '*': {
      margin: 0,
      padding: 0,
      boxSizing: 'border-box',
    },
    html: {
      fontSize: '16px',
    },
    body: {
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      lineHeight: 1.6,
      color: '#2c3e50',
      backgroundColor: '#ffffff',
    },
    '#root': {
      minHeight: '100vh',
    },
  },
});

