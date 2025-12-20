import React, { useEffect, useRef, useState } from 'react';
import { createUseStyles } from 'react-jss';
import { useTranslation } from 'react-i18next';
import { theme } from '../styles/index.js';

const useStyles = createUseStyles({
  container: {
    position: 'fixed',
    top: theme.spacing.md,
    left: theme.spacing.md,
    right: 'auto',
    zIndex: 100,
    direction: 'ltr',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
  },
  toggleButton: {
    padding: `${theme.spacing.sm} ${theme.spacing.md}`,
    backgroundColor: theme.colors.surface,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.borderRadius.sm,
    cursor: 'pointer',
    fontSize: '1.25rem',
    lineHeight: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '48px',
    height: '48px',
    transition: 'background-color 0.2s, border-color 0.2s',
    boxShadow: '0 6px 16px rgba(0, 0, 0, 0.15)',
    '&:hover': {
      backgroundColor: theme.colors.primary,
      borderColor: theme.colors.primary,
      color: '#ffffff',
    },
  },
  menu: {
    marginBlockStart: theme.spacing.xs,
    backgroundColor: theme.colors.surface,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.borderRadius.md,
    boxShadow: '0 12px 30px rgba(0, 0, 0, 0.2)',
    overflow: 'hidden',
    display: 'none',
    minWidth: '180px',
  },
  menuOpen: {
    display: 'block',
  },
  menuItem: {
    width: '100%',
    padding: `${theme.spacing.sm} ${theme.spacing.md}`,
    background: 'transparent',
    border: 'none',
    textAlign: 'start',
    cursor: 'pointer',
    fontSize: '0.95rem',
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing.sm,
    color: theme.colors.textPrimary,
    transition: 'background-color 0.2s, color 0.2s',
    '&:hover': {
      backgroundColor: theme.colors.primary,
      color: '#ffffff',
    },
  },
  menuItemActive: {
    backgroundColor: theme.colors.primary,
    color: '#ffffff',
  },
  flag: {
    fontSize: '1.25rem',
    lineHeight: 1,
  },
});

export const LangSwitcher = () => {
  const classes = useStyles();
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  const languages = [
    { code: 'he', label: 'עברית', flag: '🇮🇱' },
    { code: 'en', label: 'English', flag: '🇺🇸' },
    { code: 'ar', label: 'العربية', flag: '🇸🇦' },
  ];

  const handleLanguageChange = (lang) => {
    const url = new URL(window.location);
    url.searchParams.set('lang', lang);
    window.location.href = url.toString();
  };

  const toggleMenu = () => {
    setOpen((prev) => !prev);
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [i18n.language]);

  const activeLanguage = languages.find((lang) => lang.code === i18n.language) || languages[0];

  return (
    <div className={classes.container} ref={containerRef}>
      <button
        type="button"
        className={classes.toggleButton}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={toggleMenu}
      >
        <span className={classes.flag}>{activeLanguage.flag}</span>
      </button>
      <div className={`${classes.menu} ${open ? classes.menuOpen : ''}`} role="menu">
        {languages.map((lang) => {
          const isActive = i18n.language === lang.code;
          return (
            <button
              key={lang.code}
              type="button"
              className={`${classes.menuItem} ${isActive ? classes.menuItemActive : ''}`}
              onClick={() => handleLanguageChange(lang.code)}
              role="menuitem"
            >
              <span className={classes.flag} aria-hidden="true">
                {lang.flag}
              </span>
              <span>{lang.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

