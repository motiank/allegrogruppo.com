# Styles System

This directory contains the multi-style system for the order_sys application. Each style is contained in its own folder and can be selected via the `STYLE_FLDR` environment variable.

## Structure

```
styles/
├── index.js          # Style loader that selects the active style
├── default/          # Default style (current style)
│   ├── theme.js      # Theme configuration (colors, spacing, etc.)
│   └── global.js     # Global styles (fonts, base styles)
└── [style-name]/     # Additional styles (create as needed)
    ├── theme.js
    └── global.js
```

## Usage

### Setting the Style

Set the `VITE_STYLE_FLDR` environment variable to the name of the style folder you want to use. In Vite, environment variables must be prefixed with `VITE_` to be accessible in client-side code.

**Option 1: Using environment variable in command:**
```bash
# For development
VITE_STYLE_FLDR=modern npm run dev

# For production build
VITE_STYLE_FLDR=modern npm run build
```

**Option 2: Using .env file:**
Create or update `.env` file in the project root:
```
VITE_STYLE_FLDR=modern
```

**Note:** The system also checks `STYLE_FLDR` (without VITE_ prefix) for server-side usage, but for client-side Vite builds, you must use `VITE_STYLE_FLDR`.

If `VITE_STYLE_FLDR` is not set or the specified style doesn't exist, the system will fall back to the `default` style.

### Using Styles in Components

Import theme and global styles from the styles index:

```javascript
import { theme, useGlobalStyles } from '../styles/index.js';

// Use theme values
const color = theme.colors.primary;

// Apply global styles
useGlobalStyles();
```

## Creating a New Style

1. Create a new folder under `styles/` with your style name (e.g., `modern`, `dark`, `corporate`)

2. Create `theme.js` in your style folder with the following structure:

```javascript
export const theme = {
  colors: {
    primary: '#your-color',
    secondary: '#your-color',
    // ... other colors
  },
  spacing: {
    xs: '4px',
    sm: '8px',
    // ... other spacing values
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
  fonts: {
    primary: 'Your Font Family',
    secondary: null, // Optional
    monospace: 'Monaco, "Courier New", monospace',
  },
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
```

3. Create `global.js` in your style folder:

```javascript
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
  },
});
```

4. Register your style in `styles/index.js`:

```javascript
import * as yourStyleTheme from './your-style-name/theme.js';
import * as yourStyleGlobal from './your-style-name/global.js';

const styles = {
  default: { ... },
  'your-style-name': {
    theme: yourStyleTheme.theme,
    useGlobalStyles: yourStyleGlobal.useGlobalStyles,
  },
};
```

## Extensibility

The theme structure is designed to be extensible. You can add new properties to the theme object as needed:

- **Colors**: Add new color properties for specific use cases
- **Fonts**: Add font families, sizes, weights
- **Box Styles**: Add shadows, borders, transitions
- **Spacing**: Add custom spacing values
- **Any other styling needs**: The structure can be extended as needed

## Current Styles

- **default**: The original style, used as fallback

