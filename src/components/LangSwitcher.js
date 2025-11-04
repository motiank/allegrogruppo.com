import React from 'react';
import { createUseStyles } from 'react-jss';
import { useTranslation } from 'react-i18next';
import { theme } from '../styles/theme.js';

const useStyles = createUseStyles({
  container: {
    position: 'fixed',
    top: theme.spacing.md,
    insetInlineEnd: theme.spacing.md,
    zIndex: 100,
  },
  button: {
    padding: `${theme.spacing.sm} ${theme.spacing.md}`,
    marginInlineStart: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.borderRadius.sm,
    cursor: 'pointer',
    fontSize: '0.875rem',
    transition: 'background-color 0.2s',
    '&:hover': {
      backgroundColor: theme.colors.primary,
      color: '#ffffff',
    },
  },
  active: {
    backgroundColor: theme.colors.primary,
    color: '#ffffff',
  },
});

export const LangSwitcher = () => {
  const classes = useStyles();
  const { i18n } = useTranslation();

  const languages = [
    { code: 'he', label: 'עברית' },
    { code: 'en', label: 'English' },
    { code: 'ar', label: 'العربية' },
  ];

  const handleLanguageChange = (lang) => {
    const url = new URL(window.location);
    url.searchParams.set('lang', lang);
    window.location.href = url.toString();
  };

  return (
    <div className={classes.container}>
      {languages.map((lang) => (
        <button
          key={lang.code}
          className={`${classes.button} ${i18n.language === lang.code ? classes.active : ''}`}
          onClick={() => handleLanguageChange(lang.code)}
        >
          {lang.label}
        </button>
      ))}
    </div>
  );
};

