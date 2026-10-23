import React, { useState } from 'react';
import { createUseStyles, useTheme } from 'react-jss';
import { useT, LangSelect } from './i18n/index.js';

const useStyles = createUseStyles((theme) => ({
  container: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '100vh',
    background: theme.background,
  },
  form: {
    width: '100%',
    maxWidth: 320,
    padding: '2rem',
    border: `1px solid ${theme.border}`,
    borderRadius: 8,
    background: theme.surface,
    boxSizing: 'border-box',
  },
  titleRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0 0 1.5rem' },
  title: {
    margin: 0,
    fontSize: '1.25rem',
    fontWeight: 600,
    color: theme.text,
  },
  label: {
    display: 'block',
    marginBottom: '0.35rem',
    fontSize: '0.8rem',
    color: theme.textSecondary,
  },
  input: {
    width: '100%',
    padding: '0.6rem 0.7rem',
    marginBottom: '1rem',
    border: `1px solid ${theme.border}`,
    borderRadius: 4,
    background: theme.background,
    color: theme.text,
    fontSize: '0.95rem',
    boxSizing: 'border-box',
    '&:focus': { outline: 'none', borderColor: theme.primary },
  },
  button: {
    width: '100%',
    padding: '0.65rem',
    border: 'none',
    borderRadius: 4,
    background: theme.primary,
    color: '#fff',
    fontSize: '0.95rem',
    fontWeight: 500,
    cursor: 'pointer',
    '&:disabled': { opacity: 0.6, cursor: 'not-allowed' },
    '&:hover:not(:disabled)': { background: theme.primaryHover },
  },
  error: {
    marginBottom: '1rem',
    padding: '0.5rem 0.7rem',
    borderRadius: 4,
    background: theme.errorBg,
    border: `1px solid ${theme.errorBorder}`,
    color: theme.errorText,
    fontSize: '0.85rem',
  },
}));

function Login({ onLoginSuccess }) {
  const theme = useTheme();
  const classes = useStyles(theme);
  const { t } = useT();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        onLoginSuccess();
      } else {
        setError(data.error || t('login.failed'));
      }
    } catch (err) {
      setError(t('login.network'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={classes.container}>
      <form className={classes.form} onSubmit={handleSubmit}>
        <div className={classes.titleRow}>
          <h1 className={classes.title}>
            <bdi dir="ltr">{t('login.title')}</bdi>
          </h1>
          <LangSelect />
        </div>
        {error && <div className={classes.error}>{error}</div>}
        <label className={classes.label} htmlFor="username">
          {t('login.username')}
        </label>
        <input
          id="username"
          className={classes.input}
          type="text"
          dir="ltr"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
        <label className={classes.label} htmlFor="password">
          {t('login.password')}
        </label>
        <input
          id="password"
          className={classes.input}
          type="password"
          dir="ltr"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button className={classes.button} type="submit" disabled={loading}>
          {loading ? t('login.signingIn') : t('login.signIn')}
        </button>
      </form>
    </div>
  );
}

export default Login;
