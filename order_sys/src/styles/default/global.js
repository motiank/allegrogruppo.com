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
    },
    body: {
      fontFamily: theme.fonts.primary,
      lineHeight: 1.6,
      color: theme.colors.text,
      backgroundColor: theme.colors.background,
    },
    '#root': {
      minHeight: '100vh',
    },
    'a[href="#rearrange-with-drag-and-drop"]': {
      color: 'red !important',
    },
    'nav#contents a[href="#rearrange-with-drag-and-drop"]': {
      color: 'red !important',
    },
  },
});

