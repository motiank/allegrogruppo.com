# allegrogruppo.com

A multi-page landing page project built with Node.js, Express, React, and Vite.

## Tech Stack

- **Node.js + Express** - Backend server
- **React** - Frontend framework
- **JSS (react-jss)** - CSS-in-JS styling
- **Vite** - Build tool with esbuild/SWC (NO Babel)
- **JavaScript ONLY** - No TypeScript, no Babel config
- **JSX in `.js` files** - All components use JSX syntax inside `.js` files

## Features

- Multi-language support (Hebrew RTL, English LTR, Arabic RTL) using i18next
- Multiple HTML entry points (index.html, eatalia-bsr.html)
- Analytics tracking with `/api/track` endpoint
- CSP headers for iframe embedding from `https://www.eatalia-market.co.il/`
- Responsive design with JSS logical properties for RTL/LTR support

## Installation

```bash
npm install
```

## Development

Start the Vite development server:

```bash
npm run dev
```

This will start the Vite dev server on `http://localhost:5173`

## Production Build

Build the project:

```bash
npm run build
```

Start the Express server:

```bash
npm start
```

The server will run on `http://localhost:3000`

## Project Structure

```
/server/server.js                  # Express server, serves dist + /api/track
/src
  /pages
    index.js                       # Index page listing landing pages
    eatalia-bsr.js                # Eatalia BSR landing page
  /components
    MealCard.js                    # Meal selection card component
    OfficeForm.js                  # Location form component
    ThankYou.js                    # Thank you page component
    VideoOverlay.js                # Video overlay component
    LangSwitcher.js                # Language switcher component
  /i18n
    index.js                       # i18next configuration
    /locales
       he/common.json              # Hebrew translations
       en/common.json              # English translations
       ar/common.json              # Arabic translations
  /styles
    theme.js                       # Theme configuration
    global.js                      # Global styles
  /utils
    analytics.js                   # Analytics tracking utilities
    validations.js                 # Form validation utilities
    dir.js                         # RTL/LTR direction utilities
index.html                         # Index page entry point
eatalia-bsr.html                   # Eatalia BSR page entry point
vite.config.js                     # Vite configuration
package.json
README.md
```

## Language Selection

Language can be selected via URL parameter: `?lang=he|en|ar`

Default language is Hebrew (he).

## Analytics Events

The following events are tracked:

- `meal_selected` - When a meal is selected
- `video_opened` - When a video overlay is opened
- `location_completed` - When the location form is submitted
- `flow_completed` - When the entire flow is completed

Events are sent to:
- `POST /api/track` endpoint
- `window.parent.postMessage()` for iframe host communication

## License

MIT

