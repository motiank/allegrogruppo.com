import { createUseStyles } from 'react-jss';
import { theme } from './theme.js';

export const useGlobalStyles = createUseStyles({
  '@global': {
    '*': {
      margin: 0,
      padding: 0,
      boxSizing: 'border-box',
    },
    html: {
      fontSize: '16px',
      // Smooth scrolling
      scrollBehavior: 'smooth',
    },
    body: {
      fontFamily: theme.fonts.primary,
      lineHeight: 1.5,
      color: theme.colors.text,
      backgroundColor: theme.colors.background,
      // Better font rendering on dark backgrounds
      WebkitFontSmoothing: 'antialiased',
      MozOsxFontSmoothing: 'grayscale',
      // Prevent text selection on mobile (optional, can be removed if needed)
      userSelect: 'none',
    },
    '#root': {
      minHeight: '100vh',
      backgroundColor: theme.colors.background,
    },
    // Link styles
    a: {
      color: theme.colors.primary,
      textDecoration: 'none',
      transition: 'opacity 0.2s',
      '&:hover': {
        opacity: 0.8,
      },
    },
    // Button base styles
    button: {
      fontFamily: 'inherit',
      cursor: 'pointer',
      border: 'none',
      outline: 'none',
      transition: 'all 0.2s ease',
      '&:disabled': {
        cursor: 'not-allowed',
        opacity: 0.5,
      },
    },
    // Input base styles
    input: {
      fontFamily: 'inherit',
      outline: 'none',
      color: theme.colors.text,
      backgroundColor: theme.colors.card || theme.colors.surface || theme.colors.background,
      '&:focus': {
        outline: 'none',
      },
    },
    // Select and textarea should also inherit theme colors
    select: {
      fontFamily: 'inherit',
      color: theme.colors.text,
      backgroundColor: theme.colors.card || theme.colors.surface || theme.colors.background,
    },
    textarea: {
      fontFamily: 'inherit',
      color: theme.colors.text,
      backgroundColor: theme.colors.card || theme.colors.surface || theme.colors.background,
    },
    // Scrollbar styling for dark theme
    '::-webkit-scrollbar': {
      width: '8px',
      height: '8px',
    },
    '::-webkit-scrollbar-track': {
      background: theme.colors.surface,
    },
    '::-webkit-scrollbar-thumb': {
      background: theme.colors.border,
      borderRadius: '4px',
      '&:hover': {
        background: theme.colors.textTertiary,
      },
    },
    'a[href="#rearrange-with-drag-and-drop"]': {
      color: 'red !important',
    },
    'nav#contents a[href="#rearrange-with-drag-and-drop"]': {
      color: 'red !important',
    },
  },
});

