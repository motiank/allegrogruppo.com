import React from 'react';
import { createRoot } from 'react-dom/client';
import { createUseStyles } from 'react-jss';
import { useTranslation } from 'react-i18next';
import { theme, useGlobalStyles } from '../styles/index.js';
import '../i18n/index.js';

const useStyles = createUseStyles({
  container: {
    minHeight: '100vh',
    padding: theme.spacing.xl,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    marginBlockEnd: theme.spacing.xl,
    objectFit: 'cover',
  },
  title: {
    fontSize: '2rem',
    marginBlockEnd: theme.spacing.xl,
    textAlign: 'center',
  },
  list: {
    listStyle: 'none',
    padding: 0,
  },
  listItem: {
    marginBlockEnd: theme.spacing.md,
  },
  link: {
    display: 'inline-block',
    padding: `${theme.spacing.md} ${theme.spacing.lg}`,
    backgroundColor: theme.colors.primary,
    color: '#ffffff',
    textDecoration: 'none',
    borderRadius: theme.borderRadius.md,
    transition: 'background-color 0.2s',
    '&:hover': {
      backgroundColor: theme.colors.secondary,
    },
  },
});

const IndexPage = () => {
  useGlobalStyles();
  const classes = useStyles();
  const { t } = useTranslation();

  const landingPages = [
    { name: 'Eatalia BSR', path: '/eatalia-bsr.html' },
  ];

  return (
    <div className={classes.container}>
      <img
        fetchPriority="high"
        src="/resources/images/logo.avif"
        alt={t('common.logoAlt')}
        style={{ objectFit: 'cover' }}
        className={classes.logo}
        width="242"
        height="149"
      />
      <h1 className={classes.title}>{t('index.title')}</h1>
      <ul className={classes.list}>
        {landingPages.map((page) => (
          <li key={page.path} className={classes.listItem}>
            <a href={page.path} className={classes.link}>
              {page.name}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<IndexPage />);
}

