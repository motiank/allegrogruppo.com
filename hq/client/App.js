import React, { useCallback, useEffect, useState } from 'react';
import { useTheme } from 'react-jss';
import Login from './Login.js';
import JoyaApp from './JoyaApp.js';

// GET /api/session decides: the login page, or the app (JoyaApp holds the routes).
export default function App() {
  const theme = useTheme();
  const [status, setStatus] = useState('loading'); // 'loading' | 'anon' | 'authed'

  const refreshSession = useCallback(() => {
    return fetch('/api/session', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((data) => setStatus(data.authenticated ? 'authed' : 'anon'))
      .catch(() => setStatus('anon'));
  }, []);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  if (status === 'loading') return <div style={{ minHeight: '100vh', background: theme.background }} />;
  if (status === 'anon') return <Login onLoginSuccess={refreshSession} />;
  return <JoyaApp />;
}
