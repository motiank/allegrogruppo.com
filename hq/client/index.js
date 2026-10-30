import React from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider } from 'react-jss';
import { BrowserRouter } from 'react-router-dom';
import App from './App.js';
import theme from './theme.js';
import { LangProvider } from './i18n/index.js';

ReactDOM.createRoot(document.getElementById('root')).render(
  <ThemeProvider theme={theme}>
    <LangProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </LangProvider>
  </ThemeProvider>,
);

// installable app (public/manifest.json): the browser offers "Install" only with a service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
