/**
 * Style loader that dynamically loads styles based on STYLE_FLDR environment variable
 * Falls back to 'default' if STYLE_FLDR is not set or invalid
 * 
 * Usage: Set VITE_STYLE_FLDR environment variable to the name of the style folder
 * Example: VITE_STYLE_FLDR=modern npm run dev
 * 
 * To add a new style:
 * 1. Create a new folder under order_sys/src/styles/ with your style name
 * 2. Add theme.js and global.js files in that folder
 * 3. Import them below and add to the styles map
 */

// Import all available styles (add new styles here as you create them)
import * as defaultTheme from './default/theme.js';
import * as defaultGlobal from './default/global.js';
import * as vltTheme from './vlt/theme.js';
import * as vltGlobal from './vlt/global.js';

// Map of available styles
const styles = {
  default: {
    theme: defaultTheme.theme,
    useGlobalStyles: defaultGlobal.useGlobalStyles,
  },
  vlt: {
    theme: vltTheme.theme,
    useGlobalStyles: vltGlobal.useGlobalStyles,
  },
  // Add more styles here as they are created:
  // modern: { theme: modernTheme.theme, useGlobalStyles: modernGlobal.useGlobalStyles },
};

// Get style folder from environment variable, default to 'default'
// In Vite, environment variables prefixed with VITE_ are available via import.meta.env
// For server-side, we can also check process.env
const STYLE_FOLDER = 
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_STYLE_FLDR) ||
  (typeof process !== 'undefined' && process.env?.STYLE_FLDR) ||
  'default';

// Validate style folder name (prevent directory traversal and invalid names)
const sanitizedStyleFolder = STYLE_FOLDER.replace(/[^a-zA-Z0-9_-]/g, '') || 'default';

// Select the style, fallback to default if not found
const selectedStyle = styles[sanitizedStyleFolder] || styles.default;
const activeStyleFolder = styles[sanitizedStyleFolder] ? sanitizedStyleFolder : 'default';

if (sanitizedStyleFolder !== 'default' && !styles[sanitizedStyleFolder]) {
  console.warn(`Style folder "${sanitizedStyleFolder}" not found, using default style`);
}

// Export the selected theme and global styles
export const theme = selectedStyle.theme;
export const useGlobalStyles = selectedStyle.useGlobalStyles;
export { activeStyleFolder as currentStyleFolder };

